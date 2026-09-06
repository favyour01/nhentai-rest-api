import { Router } from 'express';
import { getDb } from '../lib/db.js';
import { backfillMediaIds } from '../lib/backfill.js';

const router = Router();

/**
 * GET /api/v2/backfill/status
 * Cek status backfill
 */
router.get('/status', (req, res) => {
  try {
    const db = getDb();
    const total = db.prepare('SELECT COUNT(*) as cnt FROM nh_data').get().cnt;
    const withMediaId = db.prepare("SELECT COUNT(*) as cnt FROM nh_data WHERE media_id IS NOT NULL AND media_id != '0'").get().cnt;
    const withoutMediaId = db.prepare("SELECT COUNT(*) as cnt FROM nh_data WHERE media_id IS NULL AND EN_TITLE != '404'").get().cnt;
    const deleted = db.prepare("SELECT COUNT(*) as cnt FROM nh_data WHERE EN_TITLE = '404'").get().cnt;
    const markedInvalid = db.prepare("SELECT COUNT(*) as cnt FROM nh_data WHERE media_id = '0'").get().cnt;

    res.json({
      success: true,
      data: {
        total,
        with_media_id: withMediaId,
        without_media_id: withoutMediaId,
        deleted_404: deleted,
        marked_invalid: markedInvalid,
        coverage_percent: ((withMediaId / total) * 100).toFixed(2) + '%',
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v2/backfill/start
 * Trigger backfill (async - returns immediately)
 */
router.post('/start', async (req, res) => {
  try {
    const { batch_size = 50, max_batches = 10 } = req.body;
    
    // Start backfill in background
    backfillMediaIds(batch_size, max_batches)
      .then(stats => {
        console.log('[Backfill] Background job complete:', stats);
      })
      .catch(err => {
        console.error('[Backfill] Background job error:', err);
      });

    res.json({
      success: true,
      message: 'Backfill started in background',
      config: { batch_size, max_batches },
      note: 'Check /api/v2/backfill/status for progress'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
