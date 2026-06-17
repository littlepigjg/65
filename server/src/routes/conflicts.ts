import express from 'express';
import { getConflicts } from '../utils/storage';
import { syncEngine } from '../modules/SyncEngine';
import { ConflictDetector } from '../modules/ConflictDetector';
import { DiffComparer } from '../modules/DiffComparer';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const all = req.query.all === 'true';
    let conflicts = await getConflicts();
    
    if (!all) {
      conflicts = conflicts.filter(c => !c.resolved);
    }
    
    res.json(conflicts);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const conflict = await ConflictDetector.getConflictById(req.params.id);
    if (conflict) {
      res.json(conflict);
    } else {
      res.status(404).json({ error: 'Conflict not found' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/diff', async (req, res) => {
  try {
    const conflict = await ConflictDetector.getConflictById(req.params.id);
    if (conflict) {
      const sourceContent = await syncEngine.getFileContent('source', conflict.filePath);
      const targetContent = await syncEngine.getFileContent('target', conflict.filePath);
      
      const diff = DiffComparer.compare(sourceContent, targetContent);
      const sideBySide = DiffComparer.getSideBySideDiff(sourceContent, targetContent);
      
      res.json({
        conflict,
        sourceContent,
        targetContent,
        diff,
        sideBySide
      });
    } else {
      res.status(404).json({ error: 'Conflict not found' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/resolve', async (req, res) => {
  try {
    const { resolution, mergedContent } = req.body;
    
    if (!['source', 'target', 'merge'].includes(resolution)) {
      return res.status(400).json({ error: 'Invalid resolution' });
    }
    
    if (resolution === 'merge' && mergedContent === undefined) {
      return res.status(400).json({ error: 'mergedContent is required for merge resolution' });
    }
    
    await syncEngine.resolveConflict(req.params.id, resolution, mergedContent);
    
    const conflict = await ConflictDetector.getConflictById(req.params.id);
    res.json({ message: 'Conflict resolved', conflict });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/content/:version', async (req, res) => {
  try {
    const version = req.params.version as 'source' | 'target';
    if (!['source', 'target'].includes(version)) {
      return res.status(400).json({ error: 'Invalid version' });
    }
    
    const conflict = await ConflictDetector.getConflictById(req.params.id);
    if (conflict) {
      const content = await syncEngine.getFileContent(version, conflict.filePath);
      res.json({ content });
    } else {
      res.status(404).json({ error: 'Conflict not found' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
