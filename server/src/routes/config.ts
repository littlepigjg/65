import express from 'express';
import { getConfig, saveConfig } from '../utils/storage';
import { SyncConfig } from '../types';
import { syncEngine } from '../modules/SyncEngine';
import { fileWatcher } from '../modules/FileWatcher';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const config = await getConfig();
    res.json(config);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/', async (req, res) => {
  try {
    const newConfig: SyncConfig = req.body;
    await saveConfig(newConfig);
    
    if (syncEngine['isRunning']) {
      await syncEngine.stop();
      await syncEngine.start();
    }
    
    res.json(newConfig);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/restart', async (req, res) => {
  try {
    await fileWatcher.restart();
    res.json({ message: 'Watcher restarted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
