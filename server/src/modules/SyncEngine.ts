import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { FileState, SyncRecord, SyncStatus, SyncConfig } from '../types';
import { getConfig, addSyncRecord, resolveConflict as resolveConflictStorage, getSyncRecords } from '../utils/storage';
import { getFileState, walkDirectory, isIgnored, readTextFile } from '../utils/file';
import { ConflictDetector } from './ConflictDetector';
import { FileWatcher, FileChangeEvent, fileWatcher } from './FileWatcher';
import { syncStateManager } from './SyncStateManager';
import { FileSyncer } from './FileSyncer';
import { StateRecovery } from './StateRecovery';

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

    await this.initialSync();

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

  private async initialSync(): Promise<void> {
    const hasState = await syncStateManager.hasState();

    if (hasState) {
      console.log('[SyncEngine] Existing state found, performing full sync...');
      await this.fullSync();
    } else {
      console.log('[SyncEngine] No existing state found, performing SAFE RECOVERY...');
      await this.safeRecoverySync();
    }
  }

  private async safeRecoverySync(): Promise<void> {
    const config = await getConfig();

    const recovery = await StateRecovery.performSafeRecovery(config, {
      autoResolveSameFiles: true,
      flagDifferencesAsConflicts: true
    });

    const { sourceFiles, targetFiles, identicalCount, onlyInSource, onlyInTarget, differentFiles } = recovery;

    console.log(`[SyncEngine] Safe recovery complete:
      - Identical files: ${identicalCount} (will be tracked)
      - Only in source: ${onlyInSource.length} (flagged for review)
      - Only in target: ${onlyInTarget.length} (flagged for review)
      - Different content: ${differentFiles.length} (flagged as conflicts)`);

    const trackedFiles: FileState[] = [];

    for (const file of sourceFiles) {
      const targetFile = targetFiles.find(f => f.path === file.path);
      if (targetFile && targetFile.hash === file.hash) {
        trackedFiles.push(file);
      }
    }

    if (trackedFiles.length > 0) {
      await syncStateManager.setFileStates(trackedFiles);
    }

    await syncStateManager.updateLastSyncTime(Date.now());

    if (recovery.conflicts.length > 0) {
      recovery.conflicts.forEach(c => this.emit('conflict', c));
    }

    this.emit('safeRecoveryComplete', {
      identicalCount,
      onlyInSource: onlyInSource.length,
      onlyInTarget: onlyInTarget.length,
      differentFiles: differentFiles.length,
      conflicts: recovery.conflicts.length
    });
  }

  async fullSync(): Promise<void> {
    console.log('[SyncEngine] Starting full sync...');

    const config = await getConfig();
    const syncState = await syncStateManager.getState();

    const sourceFiles = await this.scanDirectory(config.sourceDir, 'source', config.ignoredPatterns);
    const targetFiles = await this.scanDirectory(config.targetDir, 'target', config.ignoredPatterns);

    const newConflicts = ConflictDetector.detectConflicts(sourceFiles, targetFiles, syncState);
    if (newConflicts.length > 0) {
      await ConflictDetector.saveConflicts(newConflicts);
      console.log(`[SyncEngine] Detected ${newConflicts.length} new conflicts`);
      newConflicts.forEach(c => this.emit('conflict', c));
    }

    const existingConflictPaths = await ConflictDetector.getAllConflictPaths();
    const newConflictPaths = new Set(newConflicts.map(c => c.filePath));
    const conflictPaths = new Set([...existingConflictPaths, ...newConflictPaths]);

    if (existingConflictPaths.size > 0) {
      console.log(`[SyncEngine] Skipping ${existingConflictPaths.size} existing unresolved conflicts`);
    }

    const sourceFileMap = new Map(sourceFiles.map(f => [f.path, f]));
    const targetFileMap = new Map(targetFiles.map(f => [f.path, f]));
    const allPaths = new Set([...sourceFileMap.keys(), ...targetFileMap.keys(), ...Object.keys(syncState.files)]);

    const stateUpdates: {
      addOrUpdate: FileState[];
      delete: string[];
    } = { addOrUpdate: [], delete: [] };

    for (const filePath of allPaths) {
      if (conflictPaths.has(filePath)) continue;

      const sourceFile = sourceFileMap.get(filePath);
      const targetFile = targetFileMap.get(filePath);
      const lastState = syncState.files[filePath];

      const result = await FileSyncer.executeSync(
        filePath,
        sourceFile,
        targetFile,
        lastState,
        config
      );

      if (result.success && result.action !== 'none') {
        if (result.sourceState) {
          stateUpdates.addOrUpdate.push(result.sourceState);
        }
        if (result.targetState) {
          stateUpdates.addOrUpdate.push(result.targetState);
        }
        if (result.action === 'delete' && !sourceFile && !targetFile) {
          stateUpdates.delete.push(filePath);
        }
      }
    }

    for (const file of [...sourceFiles, ...targetFiles]) {
      if (!conflictPaths.has(file.path)) {
        if (!stateUpdates.addOrUpdate.find(f => f.path === file.path)) {
          stateUpdates.addOrUpdate.push(file);
        }
      }
    }

    await syncStateManager.bulkUpdate({
      addOrUpdate: stateUpdates.addOrUpdate,
      delete: stateUpdates.delete,
      lastSyncTime: Date.now()
    });

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
    const syncState = await syncStateManager.getState();
    const unresolvedConflicts = await ConflictDetector.getUnresolvedConflicts();
    const conflictPaths = new Set(unresolvedConflicts.map(f => f.filePath));

    const processedPaths = new Set<string>();
    const stateUpdates: {
      addOrUpdate: FileState[];
      delete: string[];
    } = { addOrUpdate: [], delete: [] };

    for (const change of changes) {
      if (conflictPaths.has(change.path)) continue;
      if (processedPaths.has(change.path)) continue;
      processedPaths.add(change.path);

      const sourceFilePath = path.join(config.sourceDir, change.path);
      const targetFilePath = path.join(config.targetDir, change.path);

      const sourceFile = await getFileState(sourceFilePath, config.sourceDir, 'source');
      const targetFile = await getFileState(targetFilePath, config.targetDir, 'target');
      const lastState = syncState.files[change.path];

      const newConflicts = ConflictDetector.detectConflicts(
        sourceFile ? [sourceFile] : [],
        targetFile ? [targetFile] : [],
        syncState
      );

      if (newConflicts.length > 0) {
        await ConflictDetector.saveConflicts(newConflicts);
        newConflicts.forEach(c => this.emit('conflict', c));
        continue;
      }

      const result = await FileSyncer.executeSync(
        change.path,
        sourceFile ?? undefined,
        targetFile ?? undefined,
        lastState,
        config
      );

      if (result.success) {
        if (result.sourceState) {
          stateUpdates.addOrUpdate.push(result.sourceState);
        }
        if (result.targetState) {
          stateUpdates.addOrUpdate.push(result.targetState);
        }
        if (result.action === 'delete' && !sourceFile && !targetFile) {
          stateUpdates.delete.push(change.path);
        }
      }
    }

    if (stateUpdates.addOrUpdate.length > 0 || stateUpdates.delete.length > 0) {
      await syncStateManager.bulkUpdate({
        addOrUpdate: stateUpdates.addOrUpdate,
        delete: stateUpdates.delete,
        lastSyncTime: Date.now()
      });
    } else {
      await syncStateManager.updateLastSyncTime(Date.now());
    }

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
      this.clearPendingChangesForPath(conflict.filePath);

      fileWatcher.addSilentPathBoth(conflict.filePath, 10);

      let finalSourceState: FileState | undefined;
      let finalTargetState: FileState | undefined;

      if (resolution === 'source') {
        await FileSyncer.copyFromSourceToTarget(conflict.filePath, config);
        finalSourceState = await getFileState(sourcePath, config.sourceDir, 'source') ?? undefined;
        finalTargetState = await getFileState(targetPath, config.targetDir, 'target') ?? undefined;
      } else if (resolution === 'target') {
        await FileSyncer.copyFromTargetToSource(conflict.filePath, config);
        finalSourceState = await getFileState(sourcePath, config.sourceDir, 'source') ?? undefined;
        finalTargetState = await getFileState(targetPath, config.targetDir, 'target') ?? undefined;
      } else if (resolution === 'merge' && mergedContent !== undefined) {
        const result = await FileSyncer.writeToBothSides(conflict.filePath, mergedContent, config);
        finalSourceState = result.sourceState;
        finalTargetState = result.targetState;
        record.message = 'Resolved conflict by manual merge';
      }

      if (finalSourceState && finalTargetState && finalSourceState.hash !== finalTargetState.hash) {
        console.warn(`[SyncEngine] Hash mismatch after conflict resolution for ${conflict.filePath}: source=${finalSourceState.hash}, target=${finalTargetState.hash}`);
        await new Promise(resolve => setTimeout(resolve, 500));
        finalSourceState = await getFileState(sourcePath, config.sourceDir, 'source') ?? undefined;
        finalTargetState = await getFileState(targetPath, config.targetDir, 'target') ?? undefined;
      }

      await resolveConflictStorage(conflictId, resolution, mergedContent);

      const updates: FileState[] = [];
      if (finalSourceState) {
        updates.push(finalSourceState);
      }
      if (finalTargetState) {
        updates.push(finalTargetState);
      }
      if (updates.length > 0) {
        await syncStateManager.setFileStates(updates);
      }

      syncStateManager.invalidateCache();

      this.clearPendingChangesForPath(conflict.filePath);

      record.status = 'success';
      await addSyncRecord(record);

      this.emit('conflictResolved', conflict);
      this.emit('statusChange', await this.getStatus());

      console.log(`[SyncEngine] Conflict resolved: ${conflict.filePath} (${resolution})`);
      if (finalSourceState) {
        console.log(`[SyncEngine] Updated sync state: hash=${finalSourceState.hash}`);
      }
    } catch (error: any) {
      record.status = 'failed';
      record.message = error.message;
      await addSyncRecord(record);
      console.error(`[SyncEngine] Failed to resolve conflict:`, error);
      throw error;
    }
  }

  private clearPendingChangesForPath(filePath: string): void {
    const beforeCount = this.pendingChanges.length;
    this.pendingChanges = this.pendingChanges.filter(c => c.path !== filePath);
    const removed = beforeCount - this.pendingChanges.length;
    if (removed > 0) {
      console.log(`[SyncEngine] Cleared ${removed} pending changes for ${filePath}`);
    }
  }

  async getStatus(): Promise<SyncStatus> {
    const config = await getConfig();
    const state = await syncStateManager.getState();
    const records = await getSyncRecords();
    const conflicts = await ConflictDetector.getUnresolvedConflicts();

    return {
      isRunning: this.isRunning,
      sourceDir: config.sourceDir,
      targetDir: config.targetDir,
      lastSyncTime: state.lastSyncTime,
      pendingSyncCount: this.pendingChanges.length,
      conflictCount: conflicts.length,
      totalFiles: Object.keys(state.files).length,
      recentRecords: records.slice(0, 10)
    };
  }

  async getFileContent(version: 'source' | 'target', filePath: string): Promise<string> {
    const config = await getConfig();
    const fullPath = path.join(version === 'source' ? config.sourceDir : config.targetDir, filePath);
    return readTextFile(fullPath);
  }

  getPendingChangesCount(): number {
    return this.pendingChanges.length;
  }

  clearPendingChanges(): void {
    this.pendingChanges = [];
  }
}

export const syncEngine = new SyncEngine();
