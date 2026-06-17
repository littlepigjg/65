import chokidar, { FSWatcher } from 'chokidar';
import path from 'path';
import { EventEmitter } from 'events';
import { getConfig } from '../utils/storage';
import { isIgnored } from '../utils/file';

export type FileChangeEvent = {
  type: 'add' | 'change' | 'delete';
  path: string;
  source: 'source' | 'target';
};

export class FileWatcher extends EventEmitter {
  private sourceWatcher: FSWatcher | null = null;
  private targetWatcher: FSWatcher | null = null;
  private isWatching = false;

  async start(): Promise<void> {
    if (this.isWatching) return;

    const config = await getConfig();

    this.sourceWatcher = this.createWatcher(config.sourceDir, 'source', config.ignoredPatterns);
    this.targetWatcher = this.createWatcher(config.targetDir, 'target', config.ignoredPatterns);

    this.isWatching = true;
    console.log(`[FileWatcher] Started watching ${config.sourceDir} and ${config.targetDir}`);
  }

  private createWatcher(dir: string, source: 'source' | 'target', ignoredPatterns: string[]): FSWatcher {
    const watcher = chokidar.watch(dir, {
      ignoreInitial: true,
      persistent: true,
      usePolling: true,
      interval: 1000,
      binaryInterval: 2000,
      depth: 99
    });

    watcher.on('all', (event, filePath) => {
      if (isIgnored(filePath, dir, ignoredPatterns)) {
        return;
      }

      let changeType: 'add' | 'change' | 'delete' | null = null;

      switch (event) {
        case 'add':
        case 'addDir':
          changeType = 'add';
          break;
        case 'change':
          changeType = 'change';
          break;
        case 'unlink':
        case 'unlinkDir':
          changeType = 'delete';
          break;
      }

      if (changeType) {
        this.emit('change', {
          type: changeType,
          path: path.relative(dir, filePath).replace(/\\/g, '/'),
          source
        } as FileChangeEvent);
      }
    });

    watcher.on('error', (error) => {
      console.error(`[FileWatcher] Error watching ${source}:`, error);
    });

    return watcher;
  }

  async stop(): Promise<void> {
    if (this.sourceWatcher) {
      await this.sourceWatcher.close();
      this.sourceWatcher = null;
    }
    if (this.targetWatcher) {
      await this.targetWatcher.close();
      this.targetWatcher = null;
    }
    this.isWatching = false;
    console.log('[FileWatcher] Stopped watching');
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  getStatus(): { isWatching: boolean; sourceDir?: string; targetDir?: string } {
    return {
      isWatching: this.isWatching
    };
  }
}

export const fileWatcher = new FileWatcher();
