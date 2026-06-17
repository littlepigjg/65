import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { FileState, SyncConfig, ConflictFile } from '../types';
import { getFileState, walkDirectory, isIgnored } from '../utils/file';
import { ConflictDetector } from './ConflictDetector';
import { addConflict } from '../utils/storage';

export interface RecoveryResult {
  sourceFiles: FileState[];
  targetFiles: FileState[];
  conflicts: ConflictFile[];
  identicalCount: number;
  onlyInSource: string[];
  onlyInTarget: string[];
  differentFiles: string[];
}

export class StateRecovery {
  static async scanBothSides(config: SyncConfig): Promise<{ sourceFiles: FileState[]; targetFiles: FileState[] }> {
    const [sourceFiles, targetFiles] = await Promise.all([
      this.scanDirectory(config.sourceDir, 'source', config.ignoredPatterns),
      this.scanDirectory(config.targetDir, 'target', config.ignoredPatterns)
    ]);
    return { sourceFiles, targetFiles };
  }

  private static async scanDirectory(
    dir: string,
    source: 'source' | 'target',
    ignoredPatterns: string[]
  ): Promise<FileState[]> {
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

  static async analyze(sourceFiles: FileState[], targetFiles: FileState[]): Promise<RecoveryResult> {
    const sourceMap = new Map(sourceFiles.map(f => [f.path, f]));
    const targetMap = new Map(targetFiles.map(f => [f.path, f]));
    const allPaths = new Set([...sourceMap.keys(), ...targetMap.keys()]);

    const onlyInSource: string[] = [];
    const onlyInTarget: string[] = [];
    const differentFiles: string[] = [];
    let identicalCount = 0;

    for (const filePath of allPaths) {
      const sourceFile = sourceMap.get(filePath);
      const targetFile = targetMap.get(filePath);

      if (sourceFile && targetFile) {
        if (sourceFile.hash === targetFile.hash) {
          identicalCount++;
        } else {
          differentFiles.push(filePath);
        }
      } else if (sourceFile && !targetFile) {
        onlyInSource.push(filePath);
      } else if (!sourceFile && targetFile) {
        onlyInTarget.push(filePath);
      }
    }

    const conflicts = await this.generateConflictsFromDifferences(sourceFiles, targetFiles);

    return {
      sourceFiles,
      targetFiles,
      conflicts,
      identicalCount,
      onlyInSource,
      onlyInTarget,
      differentFiles
    };
  }

  static async generateConflictsFromDifferences(
    sourceFiles: FileState[],
    targetFiles: FileState[]
  ): Promise<ConflictFile[]> {
    const sourceMap = new Map(sourceFiles.map(f => [f.path, f]));
    const targetMap = new Map(targetFiles.map(f => [f.path, f]));
    const allPaths = new Set([...sourceMap.keys(), ...targetMap.keys()]);

    const conflicts: ConflictFile[] = [];

    for (const filePath of allPaths) {
      const sourceFile = sourceMap.get(filePath);
      const targetFile = targetMap.get(filePath);

      if (sourceFile && targetFile && sourceFile.hash !== targetFile.hash) {
        conflicts.push({
          id: uuidv4(),
          filePath,
          sourceVersion: sourceFile,
          targetVersion: targetFile,
          detectedAt: Date.now(),
          resolved: false
        });
      } else if (sourceFile && !targetFile) {
        conflicts.push({
          id: uuidv4(),
          filePath,
          sourceVersion: sourceFile,
          targetVersion: {
            path: filePath,
            hash: '',
            size: 0,
            mtime: 0,
            source: 'target'
          },
          detectedAt: Date.now(),
          resolved: false
        });
      } else if (!sourceFile && targetFile) {
        conflicts.push({
          id: uuidv4(),
          filePath,
          sourceVersion: {
            path: filePath,
            hash: '',
            size: 0,
            mtime: 0,
            source: 'source'
          },
          targetVersion: targetFile,
          detectedAt: Date.now(),
          resolved: false
        });
      }
    }

    return conflicts;
  }

  static async persistConflicts(conflicts: ConflictFile[]): Promise<void> {
    for (const conflict of conflicts) {
      await addConflict(conflict);
    }
  }

  static async performSafeRecovery(
    config: SyncConfig,
    options: {
      autoResolveSameFiles?: boolean;
      flagDifferencesAsConflicts?: boolean;
    } = {}
  ): Promise<RecoveryResult> {
    const opts = {
      autoResolveSameFiles: true,
      flagDifferencesAsConflicts: true,
      ...options
    };

    console.log('[StateRecovery] Performing safe recovery scan...');

    const { sourceFiles, targetFiles } = await this.scanBothSides(config);
    const analysis = await this.analyze(sourceFiles, targetFiles);

    console.log(`[StateRecovery] Scan complete:
      - Source files: ${sourceFiles.length}
      - Target files: ${targetFiles.length}
      - Identical: ${analysis.identicalCount}
      - Only in source: ${analysis.onlyInSource.length}
      - Only in target: ${analysis.onlyInTarget.length}
      - Different content: ${analysis.differentFiles.length}`);

    if (opts.flagDifferencesAsConflicts && analysis.conflicts.length > 0) {
      console.log(`[StateRecovery] Flagging ${analysis.conflicts.length} files as conflicts for manual review`);
      await this.persistConflicts(analysis.conflicts);
    }

    return analysis;
  }
}

export const stateRecovery = new StateRecovery();
