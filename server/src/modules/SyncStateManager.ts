import { SyncState, FileState } from '../types';
import { getSyncState, saveSyncState } from '../utils/storage';

export class SyncStateManager {
  private state: SyncState | null = null;
  private loading = false;

  async getState(): Promise<SyncState> {
    if (!this.state) {
      this.state = await getSyncState();
    }
    return { ...this.state, files: { ...this.state.files } };
  }

  async setState(state: SyncState): Promise<void> {
    this.state = { ...state, files: { ...state.files } };
    await saveSyncState(this.state);
  }

  async getFileState(filePath: string): Promise<FileState | undefined> {
    const state = await this.getState();
    const file = state.files[filePath];
    return file ? { ...file } : undefined;
  }

  async setFileState(filePath: string, fileState: FileState): Promise<void> {
    const state = await this.getState();
    state.files[filePath] = { ...fileState };
    this.state = state;
    await saveSyncState(state);
  }

  async setFileStates(fileStates: FileState[]): Promise<void> {
    const state = await this.getState();
    for (const file of fileStates) {
      state.files[file.path] = { ...file };
    }
    this.state = state;
    await saveSyncState(state);
  }

  async deleteFileState(filePath: string): Promise<void> {
    const state = await this.getState();
    delete state.files[filePath];
    this.state = state;
    await saveSyncState(state);
  }

  async updateLastSyncTime(timestamp: number): Promise<void> {
    const state = await this.getState();
    state.lastSyncTime = timestamp;
    this.state = state;
    await saveSyncState(state);
  }

  async hasState(): Promise<boolean> {
    const diskState = await getSyncState();
    return Object.keys(diskState.files).length > 0 || diskState.lastSyncTime > 0;
  }

  async clear(): Promise<void> {
    this.state = {
      lastSyncTime: 0,
      files: {}
    };
    await saveSyncState(this.state);
  }

  async bulkUpdate(updates: {
    addOrUpdate?: FileState[];
    delete?: string[];
    lastSyncTime?: number;
  }): Promise<void> {
    const state = await this.getState();

    if (updates.addOrUpdate) {
      for (const file of updates.addOrUpdate) {
        state.files[file.path] = { ...file };
      }
    }

    if (updates.delete) {
      for (const filePath of updates.delete) {
        delete state.files[filePath];
      }
    }

    if (updates.lastSyncTime !== undefined) {
      state.lastSyncTime = updates.lastSyncTime;
    }

    this.state = state;
    await saveSyncState(state);
  }

  invalidateCache(): void {
    this.state = null;
  }

  async getFileCount(): Promise<number> {
    const state = await this.getState();
    return Object.keys(state.files).length;
  }

  async getAllPaths(): Promise<string[]> {
    const state = await this.getState();
    return Object.keys(state.files);
  }
}

export const syncStateManager = new SyncStateManager();
