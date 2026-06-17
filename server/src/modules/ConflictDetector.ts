import { v4 as uuidv4 } from 'uuid';
import { ConflictFile, FileState, SyncState } from '../types';
import { getConfig, addConflict, getConflicts } from '../utils/storage';

export class ConflictDetector {
  static detectConflicts(
    sourceFiles: FileState[],
    targetFiles: FileState[],
    syncState: SyncState
  ): ConflictFile[] {
    const conflicts: ConflictFile[] = [];
    const sourceFileMap = new Map(sourceFiles.map(f => [f.path, f]));
    const targetFileMap = new Map(targetFiles.map(f => [f.path, f]));

    const allPaths = new Set([
      ...sourceFiles.map(f => f.path),
      ...targetFiles.map(f => f.path)
    ]);

    for (const filePath of allPaths) {
      const sourceFile = sourceFileMap.get(filePath);
      const targetFile = targetFileMap.get(filePath);
      const lastKnownState = syncState.files[filePath];

      const conflict = this.checkConflict(filePath, sourceFile, targetFile, lastKnownState);
      if (conflict) {
        conflicts.push(conflict);
      }
    }

    return conflicts;
  }

  private static checkConflict(
    filePath: string,
    sourceFile: FileState | undefined,
    targetFile: FileState | undefined,
    lastKnownState: FileState | undefined
  ): ConflictFile | null {
    if (!sourceFile || !targetFile) {
      return null;
    }

    if (sourceFile.hash === targetFile.hash) {
      return null;
    }

    const sourceChanged = !lastKnownState || sourceFile.hash !== lastKnownState.hash;
    const targetChanged = !lastKnownState || targetFile.hash !== lastKnownState.hash;

    if (sourceChanged && targetChanged) {
      return {
        id: uuidv4(),
        filePath,
        sourceVersion: sourceFile,
        targetVersion: targetFile,
        detectedAt: Date.now(),
        resolved: false
      };
    }

    return null;
  }

  static async saveConflicts(conflicts: ConflictFile[]): Promise<void> {
    for (const conflict of conflicts) {
      await addConflict(conflict);
    }
  }

  static async getUnresolvedConflicts(): Promise<ConflictFile[]> {
    const conflicts = await getConflicts();
    return conflicts.filter(c => !c.resolved);
  }

  static async getAllConflictPaths(): Promise<Set<string>> {
    const conflicts = await this.getUnresolvedConflicts();
    return new Set(conflicts.map(c => c.filePath));
  }

  static async isPathInConflict(filePath: string): Promise<boolean> {
    const paths = await this.getAllConflictPaths();
    return paths.has(filePath);
  }

  static async getConflictById(conflictId: string): Promise<ConflictFile | undefined> {
    const conflicts = await getConflicts();
    return conflicts.find(c => c.id === conflictId);
  }
}
