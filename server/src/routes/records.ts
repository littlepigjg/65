import express from 'express';
import { getSyncRecords } from '../utils/storage';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const records = await getSyncRecords();
    res.json(records.slice(0, limit));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const records = await getSyncRecords();
    res.json(records.slice(0, limit));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
