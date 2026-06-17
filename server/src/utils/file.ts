import fs from 'fs-extra';
import crypto from 'crypto';
import path from 'path';
import { FileState } from '../types';

export async function getFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function getFileState(filePath: string, baseDir: string, source: 'source' | 'target'): Promise<FileState | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    
    const relativePath = path.relative(baseDir, filePath).replace(/\\/g, '/');
    const hash = await getFileHash(filePath);
    
    return {
      path: relativePath,
      hash,
      size: stat.size,
      mtime: stat.mtime.getTime(),
      source
    };
  } catch (error) {
    return null;
  }
}

export async function walkDirectory(dir: string): Promise<string[]> {
  const files: string[] = [];
  
  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }
  
  await walk(dir);
  return files;
}

export function isIgnored(filePath: string, baseDir: string, patterns: string[]): boolean {
  const relativePath = path.relative(baseDir, filePath).replace(/\\/g, '/');
  
  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      if (regex.test(relativePath) || regex.test(path.basename(relativePath))) {
        return true;
      }
    } else {
      if (relativePath.includes(pattern) || path.basename(relativePath) === pattern) {
        return true;
      }
    }
  }
  
  return false;
}

export async function copyFileWithDirs(src: string, dest: string): Promise<void> {
  await fs.ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
}

export async function deleteFileIfExists(filePath: string): Promise<void> {
  if (await fs.pathExists(filePath)) {
    await fs.remove(filePath);
  }
}

export async function readTextFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, 'utf-8');
}
