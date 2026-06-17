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

type SilentPathKey = string;

interface SilentEntry {
  key: SilentPathKey;
  expiresAt: number;
  remainingSkips: number;
}

export class FileWatcher extends EventEmitter {
  private sourceWatcher: FSWatcher | null = null;
  private targetWatcher: FSWatcher | null = null;
  private isWatching = false;
  private silentPaths: Map<SilentPathKey, SilentEntry> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private sourceDir: string = '';
  private targetDir: string = '';
  private ignoredPatterns: string[] = [];

  private static SILENT_TIMEOUT_MS = 30000;
  private static DEFAULT_SKIPS = 3;

  async start(): Promise<void> {
    if (this.isWatching) return;

    const config = await getConfig();
    this.sourceDir = config.sourceDir;
    this.targetDir = config.targetDir;
    this.ignoredPatterns = config.ignoredPatterns;

    this.sourceWatcher = this.createWatcher(config.sourceDir, 'source');
    this.targetWatcher = this.createWatcher(config.targetDir, 'target');

    this.startSilentCleanup();

    this.isWatching = true;
    console.log(`[FileWatcher] Started watching ${config.sourceDir} and ${config.targetDir}`);
  }

  private createWatcher(dir: string, source: 'source' | 'target'): FSWatcher {
    const watcher = chokidar.watch(dir, {
      ignoreInitial: true,
      persistent: true,
      usePolling: true,
      interval: 1000,
      binaryInterval: 2000,
      depth: 99
    });

    watcher.on('all', (event, filePath) => {
      if (isIgnored(filePath, dir, this.ignoredPatterns)) {
        return;
      }

      const relativePath = path.relative(dir, filePath).replace(/\\/g, '/');

      if (this.isPathSilent(relativePath, source)) {
        console.log(`[FileWatcher] Skipping silent change: ${source}/${relativePath}`);
        this.decrementSilentSkip(relativePath, source);
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
          path: relativePath,
          source
        } as FileChangeEvent);
      }
    });

    watcher.on('error', (error) => {
      console.error(`[FileWatcher] Error watching ${source}:`, error);
    });

    return watcher;
  }

  private makeKey(relativePath: string, source: 'source' | 'target'): SilentPathKey {
    return `${source}:${relativePath}`;
  }

  addSilentPath(relativePath: string, source: 'source' | 'target', skips: number = FileWatcher.DEFAULT_SKIPS): void {
    const key = this.makeKey(relativePath, source);
    this.silentPaths.set(key, {
      key,
      expiresAt: Date.now() + FileWatcher.SILENT_TIMEOUT_MS,
      remainingSkips: skips
    });
    console.log(`[FileWatcher] Added silent path: ${key} (skips: ${skips})`);
  }

  addSilentPathBoth(relativePath: string, skips: number = FileWatcher.DEFAULT_SKIPS): void {
    this.addSilentPath(relativePath, 'source', skips);
    this.addSilentPath(relativePath, 'target', skips);
  }

  removeSilentPath(relativePath: string, source: 'source' | 'target'): void {
    const key = this.makeKey(relativePath, source);
    this.silentPaths.delete(key);
  }

  clearSilentPaths(): void {
    this.silentPaths.clear();
    console.log('[FileWatcher] Cleared all silent paths');
  }

  private isPathSilent(relativePath: string, source: 'source' | 'target'): boolean {
    const key = this.makeKey(relativePath, source);
    const entry = this.silentPaths.get(key);
    
    if (!entry) return false;
    
    if (Date.now() > entry.expiresAt) {
      this.silentPaths.delete(key);
      return false;
    }
    
    return entry.remainingSkips > 0;
  }

  private decrementSilentSkip(relativePath: string, source: 'source' | 'target'): void {
    const key = this.makeKey(relativePath, source);
    const entry = this.silentPaths.get(key);
    
    if (entry) {
      entry.remainingSkips--;
      if (entry.remainingSkips <= 0) {
        this.silentPaths.delete(key);
        console.log(`[FileWatcher] Silent path expired: ${key}`);
      }
    }
  }

  private startSilentCleanup(): void {
    if (this.cleanupTimer) return;
    
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      let removedCount = 0;
      
      for (const [key, entry] of this.silentPaths.entries()) {
        if (now > entry.expiresAt) {
          this.silentPaths.delete(key);
          removedCount++;
        }
      }
      
      if (removedCount > 0) {
        console.log(`[FileWatcher] Cleaned up ${removedCount} expired silent paths`);
      }
    }, 10000);

    this.cleanupTimer.unref();
  }

  async executeSilent(
    relativePath: string,
    source: 'source' | 'target' | 'both',
    operation: () => Promise<void>
  ): Promise<void> {
    if (source === 'both') {
      this.addSilentPathBoth(relativePath);
    } else {
      this.addSilentPath(relativePath, source);
    }

    try {
      await operation();
    } finally {
    }
  }

  async stop(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.sourceWatcher) {
      await this.sourceWatcher.close();
      this.sourceWatcher = null;
    }
    if (this.targetWatcher) {
      await this.targetWatcher.close();
      this.targetWatcher = null;
    }

    this.silentPaths.clear();
    this.isWatching = false;
    console.log('[FileWatcher] Stopped watching');
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  getStatus(): { 
    isWatching: boolean; 
    sourceDir?: string; 
    targetDir?: string;
    silentPathCount: number;
  } {
    return {
      isWatching: this.isWatching,
      sourceDir: this.sourceDir,
      targetDir: this.targetDir,
      silentPathCount: this.silentPaths.size
    };
  }
}

export const fileWatcher = new FileWatcher();
