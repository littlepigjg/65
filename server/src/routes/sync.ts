import express from 'express';
import { syncEngine } from '../modules/SyncEngine';

const router = express.Router();

router.get('/status', async (req, res) => {
  try {
    const status = await syncEngine.getStatus();
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/start', async (req, res) => {
  try {
    await syncEngine.start();
    const status = await syncEngine.getStatus();
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/stop', async (req, res) => {
  try {
    await syncEngine.stop();
    const status = await syncEngine.getStatus();
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/sync', async (req, res) => {
  try {
    await syncEngine.fullSync();
    const status = await syncEngine.getStatus();
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const sendEvent = (type: string, data: any) => {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const onStatusChange = (status: any) => sendEvent('statusChange', status);
  const onFileChange = (change: any) => sendEvent('fileChange', change);
  const onConflict = (conflict: any) => sendEvent('conflict', conflict);
  const onConflictResolved = (conflict: any) => sendEvent('conflictResolved', conflict);
  const onSyncComplete = () => sendEvent('syncComplete', {});

  syncEngine.on('statusChange', onStatusChange);
  syncEngine.on('fileChange', onFileChange);
  syncEngine.on('conflict', onConflict);
  syncEngine.on('conflictResolved', onConflictResolved);
  syncEngine.on('syncComplete', onSyncComplete);

  req.on('close', () => {
    syncEngine.off('statusChange', onStatusChange);
    syncEngine.off('fileChange', onFileChange);
    syncEngine.off('conflict', onConflict);
    syncEngine.off('conflictResolved', onConflictResolved);
    syncEngine.off('syncComplete', onSyncComplete);
  });
});

export default router;
