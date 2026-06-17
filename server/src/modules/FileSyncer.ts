import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { FileState, SyncConfig, SyncRecord } from '../types';
import { copyFileWithDirs, deleteFileIfExists, writeTextFile, getFileState } from '../utils/file';
import { addSyncRecord } from '../utils/storage';

export type SyncAction = 'copy' | 'delete' | 'update' | 'none';
export type SyncDirection = 'source-to-target' | 'target-to-source' | 'none';

export interface SyncDecision {
  action: SyncAction;
  direction: SyncDirection;
  reason: string;
}

export interface SyncResult {
  success: boolean;
  action: SyncAction;
  direction: SyncDirection;
  filePath: string;
  message: string;
  sourceState?: FileState;
  targetState?: FileState;
}

export class FileSyncer {
  static decideSyncAction(
    sourceFile: FileState | undefined,
    targetFile: FileState | undefined,
    lastState: FileState | undefined,
    config: SyncConfig
  ): SyncDecision {
    if (sourceFile && targetFile) {
      if (sourceFile.hash === targetFile.hash) {
        return { action: 'none', direction: 'none', reason: 'Files are identical' };
      }

      if (lastState) {
        const sourceChanged = sourceFile.hash !== lastState.hash;
        const targetChanged = targetFile.hash !== lastState.hash;

        if (sourceChanged && !targetChanged) {
          return {
            action: 'update',
            direction: 'source-to-target',
            reason: 'Source changed, target unchanged - sync from source'
          };
        }

        if (targetChanged && !sourceChanged) {
          return {
            action: 'update',
            direction: 'target-to-source',
            reason: 'Target changed, source unchanged - sync from target'
          };
        }

        if (sourceChanged && targetChanged) {
          return {
            action: 'none',
            direction: 'none',
            reason: 'Both sides changed - conflict detected'
          };
        }

        return { action: 'none', direction: 'none', reason: 'No changes detected' };
      } else {
        return {
          action: 'none',
          direction: 'none',
          reason: 'No history state - need manual resolution'
        };
      }
    }

    if (sourceFile && !targetFile) {
      if (!lastState || lastState.source !== 'source' || lastState.hash !== sourceFile.hash) {
        return {
          action: 'copy',
          direction: 'source-to-target',
          reason: 'New file in source - copy to target'
        };
      } else {
        return {
          action: 'delete',
          direction: 'source-to-target',
          reason: 'File deleted in target - delete from source too'
        };
      }
    }

    if (!sourceFile && targetFile) {
      if (!lastState || lastState.source !== 'target' || lastState.hash !== targetFile.hash) {
        return {
          action: 'copy',
          direction: 'target-to-source',
          reason: 'New file in target - copy to source'
        };
      } else {
        return {
          action: 'delete',
          direction: 'target-to-source',
          reason: 'File deleted in source - delete from target too'
        };
      }
    }

    if (!sourceFile && !targetFile && lastState) {
      return {
        action: 'delete',
        direction: 'none',
        reason: 'File deleted from both sides'
      };
    }

    return { action: 'none', direction: 'none', reason: 'No action needed' };
  }

  static async executeSync(
    relativePath: string,
    sourceFile: FileState | undefined,
    targetFile: FileState | undefined,
    lastState: FileState | undefined,
    config: SyncConfig
  ): Promise<SyncResult> {
    const decision = this.decideSyncAction(sourceFile, targetFile, lastState, config);

    if (decision.action === 'none') {
      return {
        success: true,
        action: 'none',
        direction: 'none',
        filePath: relativePath,
        message: decision.reason
      };
    }

    const sourcePath = path.join(config.sourceDir, relativePath);
    const targetPath = path.join(config.targetDir, relativePath);

    const record: SyncRecord = {
      id: uuidv4(),
      timestamp: Date.now(),
      action: decision.action,
      filePath: relativePath,
      source: decision.direction === 'source-to-target' ? 'source' : 'target',
      status: 'pending',
      message: decision.reason
    };

    try {
      let finalSourceState = sourceFile;
      let finalTargetState = targetFile;

      switch (decision.action) {
        case 'copy':
        case 'update':
          if (decision.direction === 'source-to-target') {
            await copyFileWithDirs(sourcePath, targetPath);
            finalTargetState = await getFileState(targetPath, config.targetDir, 'target') ?? undefined;
          } else if (decision.direction === 'target-to-source') {
            await copyFileWithDirs(targetPath, sourcePath);
            finalSourceState = await getFileState(sourcePath, config.sourceDir, 'source') ?? undefined;
          }
          break;

        case 'delete':
          if (decision.direction === 'source-to-target' || decision.direction === 'none') {
            await deleteFileIfExists(sourcePath);
            finalSourceState = undefined;
          }
          if (decision.direction === 'target-to-source' || decision.direction === 'none') {
            await deleteFileIfExists(targetPath);
            finalTargetState = undefined;
          }
          break;
      }

      record.status = 'success';
      await addSyncRecord(record);

      return {
        success: true,
        action: decision.action,
        direction: decision.direction,
        filePath: relativePath,
        message: decision.reason,
        sourceState: finalSourceState,
        targetState: finalTargetState
      };
    } catch (error: any) {
      record.status = 'failed';
      record.message = error.message;
      await addSyncRecord(record);

      return {
        success: false,
        action: decision.action,
        direction: decision.direction,
        filePath: relativePath,
        message: error.message
      };
    }
  }

  static async writeToBothSides(
    relativePath: string,
    content: string,
    config: SyncConfig
  ): Promise<{ sourceState?: FileState; targetState?: FileState }> {
    const sourcePath = path.join(config.sourceDir, relativePath);
    const targetPath = path.join(config.targetDir, relativePath);

    await writeTextFile(sourcePath, content);
    await writeTextFile(targetPath, content);

    const [sourceState, targetState] = await Promise.all([
      getFileState(sourcePath, config.sourceDir, 'source'),
      getFileState(targetPath, config.targetDir, 'target')
    ]);

    return {
      sourceState: sourceState ?? undefined,
      targetState: targetState ?? undefined
    };
  }

  static async copyFromSourceToTarget(relativePath: string, config: SyncConfig): Promise<FileState | undefined> {
    const sourcePath = path.join(config.sourceDir, relativePath);
    const targetPath = path.join(config.targetDir, relativePath);
    await copyFileWithDirs(sourcePath, targetPath);
    const state = await getFileState(targetPath, config.targetDir, 'target');
    return state ?? undefined;
  }

  static async copyFromTargetToSource(relativePath: string, config: SyncConfig): Promise<FileState | undefined> {
    const sourcePath = path.join(config.sourceDir, relativePath);
    const targetPath = path.join(config.targetDir, relativePath);
    await copyFileWithDirs(targetPath, sourcePath);
    const state = await getFileState(sourcePath, config.sourceDir, 'source');
    return state ?? undefined;
  }
}

export const fileSyncer = new FileSyncer();
