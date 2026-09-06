import { Router } from 'express';
import { getDb } from '../lib/db.js';
import { backfillMediaIds } from '../lib/backfill.js';

const router = Router();

router.get('/status', (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.json({ success: true, data: { message: "Database not available - running in live-only mode" } });
    const total = db.prepare('SELECT COUNT(*) as cnt FROM nh_data').get().cnt;
    const withMediaId = db.prepare("SELECT COUNT(*) as cnt FROM nh_data WHERE media_id IS NOT NULL AND media_id != '0'").get().cnt;
    res.json({ success: true, data: { total, with_media_id: withMediaId, coverage_percent: ((withMediaId / total) * 100).toFixed(2) + '%' } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/start', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.json({ success: false, message: "Database not available" });
    const { batch_size = 50, max_batches = 10 } = req.body;
    backfillMediaIds(batch_size, max_batches).then(stats => console.log('[Backfill] Complete:', stats)).catch(err => console.error('[Backfill] Error:', err));
    res.json({ success: true, message: 'Backfill started', config: { batch_size, max_batches } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

export default router;
