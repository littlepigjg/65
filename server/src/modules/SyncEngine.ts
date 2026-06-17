import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { FileState, SyncRecord, SyncStatus, SyncConfig } from '../types';
import { getConfig, getSyncState, saveSyncState, addSyncRecord, resolveConflict as resolveConflictStorage } from '../utils/storage';
import { getFileState, walkDirectory, isIgnored, copyFileWithDirs, deleteFileIfExists, readTextFile, writeTextFile } from '../utils/file';
import { ConflictDetector } from './ConflictDetector';
import { FileWatcher, FileChangeEvent, fileWatcher } from './FileWatcher';

export class SyncEngine extends EventEmitter {
  private isRunning = false;
  private syncTimer: NodeJS.Timeout | null = null;
  private pendingChanges: FileChangeEvent[] = [];

  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;

    fileWatcher.on('change', (event: FileChangeEvent) => {
      this.pendingChanges.push(event);
      this.emit('fileChange', event);
    });

    await fileWatcher.start();

    const config = await getConfig();
    this.syncTimer = setInterval(() => {
      if (this.pendingChanges.length > 0) {
        this.sync();
      }
    }, config.syncInterval);

    await this.fullSync();

    console.log('[SyncEngine] Started');
    this.emit('statusChange', await this.getStatus());
  }

  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    await fileWatcher.stop();
    fileWatcher.removeAllListeners('change');

    console.log('[SyncEngine] Stopped');
    this.emit('statusChange', await this.getStatus());
  }

  async fullSync(): Promise<void> {
    console.log('[SyncEngine] Starting full sync...');

    const config = await getConfig();
    const syncState = await getSyncState();

    const sourceFiles = await this.scanDirectory(config.sourceDir, 'source', config.ignoredPatterns);
    const targetFiles = await this.scanDirectory(config.targetDir, 'target', config.ignoredPatterns);

    const conflicts = ConflictDetector.detectConflicts(sourceFiles, targetFiles, syncState);
    if (conflicts.length > 0) {
      await ConflictDetector.saveConflicts(conflicts);
      console.log(`[SyncEngine] Detected ${conflicts.length} conflicts`);
      conflicts.forEach(c => this.emit('conflict', c));
    }

    const conflictPaths = new Set(conflicts.map(c => c.filePath));

    const sourceFileMap = new Map(sourceFiles.map(f => [f.path, f]));
    const targetFileMap = new Map(targetFiles.map(f => [f.path, f]));
    const allPaths = new Set([...sourceFileMap.keys(), ...targetFileMap.keys(), ...Object.keys(syncState.files)]);

    for (const filePath of allPaths) {
      if (conflictPaths.has(filePath)) continue;

      const sourceFile = sourceFileMap.get(filePath);
      const targetFile = targetFileMap.get(filePath);
      const lastState = syncState.files[filePath];

      await this.syncFile(filePath, sourceFile, targetFile, lastState, config);
    }

    syncState.lastSyncTime = Date.now();
    for (const file of [...sourceFiles, ...targetFiles]) {
      if (!conflictPaths.has(file.path)) {
        syncState.files[file.path] = file;
      }
    }
    await saveSyncState(syncState);

    console.log('[SyncEngine] Full sync completed');
    this.emit('syncComplete');
    this.emit('statusChange', await this.getStatus());
  }

  async sync(): Promise<void> {
    if (this.pendingChanges.length === 0) return;

    const changes = [...this.pendingChanges];
    this.pendingChanges = [];

    console.log(`[SyncEngine] Processing ${changes.length} changes...`);

    const config = await getConfig();
    const syncState = await getSyncState();
    const conflictPaths = new Set(await ConflictDetector.getUnresolvedConflicts().then(c => c.map(f => f.filePath)));

    const processedPaths = new Set<string>();

    for (const change of changes) {
      if (conflictPaths.has(change.path)) continue;
      if (processedPaths.has(change.path)) continue;
      processedPaths.add(change.path);

      const sourceFilePath = path.join(config.sourceDir, change.path);
      const targetFilePath = path.join(config.targetDir, change.path);

      const sourceFile = await getFileState(sourceFilePath, config.sourceDir, 'source');
      const targetFile = await getFileState(targetFilePath, config.targetDir, 'target');
      const lastState = syncState.files[change.path];

      const conflict = ConflictDetector.detectConflicts(
        sourceFile ? [sourceFile] : [],
        targetFile ? [targetFile] : [],
        syncState
      );

      if (conflict.length > 0) {
        await ConflictDetector.saveConflicts(conflict);
        conflict.forEach(c => this.emit('conflict', c));
        continue;
      }

      await this.syncFile(change.path, sourceFile ?? undefined, targetFile ?? undefined, lastState, config);

      if (sourceFile && !conflictPaths.has(change.path)) {
        syncState.files[change.path] = sourceFile;
      } else if (targetFile && !conflictPaths.has(change.path)) {
        syncState.files[change.path] = targetFile;
      } else if (!sourceFile && !targetFile) {
        delete syncState.files[change.path];
      }
    }

    syncState.lastSyncTime = Date.now();
    await saveSyncState(syncState);

    console.log('[SyncEngine] Sync completed');
    this.emit('syncComplete');
    this.emit('statusChange', await this.getStatus());
  }

  private async scanDirectory(dir: string, source: 'source' | 'target', ignoredPatterns: string[]): Promise<FileState[]> {
    const files = await walkDirectory(dir);
    const fileStates: FileState[] = [];

    for (const filePath of files) {
      if (isIgnored(filePath, dir, ignoredPatterns)) continue;
      
      const state = await getFileState(filePath, dir, source);
      if (state) {
        fileStates.push(state);
      }
    }

    return fileStates;
  }

  private async syncFile(
    relativePath: string,
    sourceFile: FileState | undefined,
    targetFile: FileState | undefined,
    lastState: FileState | undefined,
    config: SyncConfig
  ): Promise<void> {
    const sourcePath = path.join(config.sourceDir, relativePath);
    const targetPath = path.join(config.targetDir, relativePath);

    const record: SyncRecord = {
      id: uuidv4(),
      timestamp: Date.now(),
      action: 'copy',
      filePath: relativePath,
      source: 'source',
      status: 'pending'
    };

    try {
      if (sourceFile && targetFile) {
        if (sourceFile.hash === targetFile.hash) {
          return;
        }

        if (lastState) {
          const sourceChanged = sourceFile.hash !== lastState.hash;
          const targetChanged = targetFile.hash !== lastState.hash;

          if (sourceChanged && !targetChanged) {
            record.action = 'update';
            record.source = 'source';
            await copyFileWithDirs(sourcePath, targetPath);
            record.status = 'success';
            record.message = 'Synced from source to target';
          } else if (targetChanged && !sourceChanged) {
            record.action = 'update';
            record.source = 'target';
            await copyFileWithDirs(targetPath, sourcePath);
            record.status = 'success';
            record.message = 'Synced from target to source';
          }
        } else {
          if (sourceFile.mtime >= targetFile.mtime) {
            record.action = 'copy';
            record.source = 'source';
            await copyFileWithDirs(sourcePath, targetPath);
            record.status = 'success';
            record.message = 'Copied from source to target';
          } else {
            record.action = 'copy';
            record.source = 'target';
            await copyFileWithDirs(targetPath, sourcePath);
            record.status = 'success';
            record.message = 'Copied from target to source';
          }
        }
      } else if (sourceFile && !targetFile) {
        if (!lastState || lastState.source !== 'source' || lastState.hash !== sourceFile.hash) {
          record.action = 'copy';
          record.source = 'source';
          await copyFileWithDirs(sourcePath, targetPath);
          record.status = 'success';
          record.message = 'Created in target';
        } else {
          record.action = 'delete';
          record.source = 'target';
          await deleteFileIfExists(sourcePath);
          record.status = 'success';
          record.message = 'Deleted from source (matched deletion in target)';
        }
      } else if (!sourceFile && targetFile) {
        if (!lastState || lastState.source !== 'target' || lastState.hash !== targetFile.hash) {
          record.action = 'copy';
          record.source = 'target';
          await copyFileWithDirs(targetPath, sourcePath);
          record.status = 'success';
          record.message = 'Created in source';
        } else {
          record.action = 'delete';
          record.source = 'source';
          await deleteFileIfExists(targetPath);
          record.status = 'success';
          record.message = 'Deleted from target (matched deletion in source)';
        }
      } else if (!sourceFile && !targetFile && lastState) {
        record.action = 'delete';
        record.source = lastState.source;
        record.status = 'success';
        record.message = 'Deleted from both directories';
      }

      await addSyncRecord(record);
    } catch (error: any) {
      record.status = 'failed';
      record.message = error.message;
      await addSyncRecord(record);
      console.error(`[SyncEngine] Failed to sync ${relativePath}:`, error);
    }
  }

  async resolveConflict(conflictId: string, resolution: 'source' | 'target' | 'merge', mergedContent?: string): Promise<void> {
    const conflict = await ConflictDetector.getConflictById(conflictId);
    if (!conflict) {
      throw new Error('Conflict not found');
    }

    const config = await getConfig();
    const sourcePath = path.join(config.sourceDir, conflict.filePath);
    const targetPath = path.join(config.targetDir, conflict.filePath);

    const record: SyncRecord = {
      id: uuidv4(),
      timestamp: Date.now(),
      action: 'conflict',
      filePath: conflict.filePath,
      source: resolution === 'source' ? 'source' : 'target',
      status: 'pending',
      message: `Resolved conflict by choosing ${resolution} version`
    };

    try {
      if (resolution === 'source') {
        await copyFileWithDirs(sourcePath, targetPath);
      } else if (resolution === 'target') {
        await copyFileWithDirs(targetPath, sourcePath);
      } else if (resolution === 'merge' && mergedContent !== undefined) {
        await writeTextFile(sourcePath, mergedContent);
        await writeTextFile(targetPath, mergedContent);
        record.message = 'Resolved conflict by manual merge';
      }

      await resolveConflictStorage(conflictId, resolution, mergedContent);

      const syncState = await getSyncState();
      const updatedSourceState = await getFileState(sourcePath, config.sourceDir, 'source');
      if (updatedSourceState) {
        syncState.files[conflict.filePath] = updatedSourceState;
        await saveSyncState(syncState);
      }

      record.status = 'success';
      await addSyncRecord(record);

      this.emit('conflictResolved', conflict);
      this.emit('statusChange', await this.getStatus());

      console.log(`[SyncEngine] Conflict resolved: ${conflict.filePath} (${resolution})`);
    } catch (error: any) {
      record.status = 'failed';
      record.message = error.message;
      await addSyncRecord(record);
      console.error(`[SyncEngine] Failed to resolve conflict:`, error);
      throw error;
    }
  }

  async getStatus(): Promise<SyncStatus> {
    const config = await getConfig();
    const syncState = await getSyncState();
    const records = await getSyncState().then(async () => {
      const { getSyncRecords } = await import('../utils/storage');
      return getSyncRecords();
    });
    const conflicts = await ConflictDetector.getUnresolvedConflicts();

    return {
      isRunning: this.isRunning,
      sourceDir: config.sourceDir,
      targetDir: config.targetDir,
      lastSyncTime: syncState.lastSyncTime,
      pendingSyncCount: this.pendingChanges.length,
      conflictCount: conflicts.length,
      totalFiles: Object.keys(syncState.files).length,
      recentRecords: (await records).slice(0, 10)
    };
  }

  async getFileContent(version: 'source' | 'target', filePath: string): Promise<string> {
    const config = await getConfig();
    const fullPath = path.join(version === 'source' ? config.sourceDir : config.targetDir, filePath);
    return readTextFile(fullPath);
  }
}

export const syncEngine = new SyncEngine();
