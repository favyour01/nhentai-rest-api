/**
 * Backfill media_id dari nhentai API untuk semua records yang belum punya
 * Menggunakan endpoint /api/v2/galleries/{id}/related yang tidak memiliki rate limit ketimbang /api/v2/galleries/{id}
 *
 * Strategy:
 * 1. Gunakan /api/v2/galleries/{id}/related untuk mendapatkan media_id dari gallery terkait
 * 2. Setiap request menghasilkan 5 gallery dengan media_id
 * 3. Rate limit: ~9 requests per minute (6 detik delay antar request)
 * 4. Update database dengan media_id, cover_path, thumbnail_path
 */

import https from 'https';
import { DatabaseSync } from 'node:sqlite';
import { ensureDb } from './build-db.js';

const CF_IPS = [
  '104.21.235.100',
  '104.21.234.100',
  '104.21.233.100',
  '172.67.182.100',
  '172.67.181.100',
];

let ipIndex = 0;
function getNextIp() {
  const ip = CF_IPS[ipIndex % CF_IPS.length];
  ipIndex++;
  return ip;
}

function fetchRelated(id) {
  return new Promise((resolve, reject) => {
    const ip = getNextIp();
    const options = {
      hostname: ip,
      port: 443,
      path: '/api/v2/galleries/' + id + '/related',
      method: 'GET',
      headers: {
        'Host': 'nhentai.net',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      rejectUnauthorized: false,
      timeout: 15000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            const results = (json.result || []).map(g => ({
              id: g.id,
              media_id: g.media_id,
              thumbnail: g.thumbnail,
            }));
            resolve(results);
          } catch (e) {
            resolve([]);
          }
        } else if (res.statusCode === 404) {
          resolve([]);
        } else if (res.statusCode === 429) {
          reject(new Error('HTTP 429'));
        } else {
          reject(new Error('HTTP ' + res.statusCode));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

export async function backfillMediaIds(batchSize = 100, maxBatches = null) {
  const dbPath = ensureDb();
  if (!dbPath) throw new Error('Database not available');

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = OFF'); // Faster writes
  db.exec('PRAGMA cache_size = 10000');

  // Ensure columns exist
  try { db.exec('ALTER TABLE nh_data ADD COLUMN media_id TEXT'); } catch(e) {}
  try { db.exec('ALTER TABLE nh_data ADD COLUMN cover_path TEXT'); } catch(e) {}
  try { db.exec('ALTER TABLE nh_data ADD COLUMN thumbnail_path TEXT'); } catch(e) {}

  // Prepare statement for batch updates
  const updateStmt = db.prepare(
    'UPDATE nh_data SET media_id = ?, thumbnail_path = ? WHERE ID = ? AND media_id IS NULL'
  );

  const countRow = db.prepare(
    "SELECT COUNT(*) as total FROM nh_data WHERE media_id IS NULL AND EN_TITLE != '404'"
  ).get();
  const totalToProcess = countRow.total;

  console.log('[Backfill] Total records to process: ' + totalToProcess);

  let processed = 0;
  let galleriesUpdated = 0;
  let failed = 0;
  let batches = 0;
  let rateLimitHits = 0;
  const DELAY_MS = 30500; // 30.5 seconds between requests for sustainable rate (no rate limits!)

  // Use a transaction for batch updates
  const updateBatch = (updates) => {
    if (updates.length === 0) return;
    db.exec('BEGIN TRANSACTION');
    for (const u of updates) {
      try {
        updateStmt.run(String(u.media_id), u.thumbnail, u.id);
        galleriesUpdated++;
      } catch (e) {
        // Ignore errors for individual updates
      }
    }
    db.exec('COMMIT');
  };

  while (true) {
    if (maxBatches && batches >= maxBatches) break;

    // Get next batch of IDs that need media_id
    const rows = db.prepare(
      "SELECT ID FROM nh_data WHERE media_id IS NULL AND EN_TITLE != '404' LIMIT ?"
    ).all(batchSize);

    if (rows.length === 0) break;

    batches++;
    const batchUpdates = [];

    for (const row of rows) {
      try {
        const results = await fetchRelated(row.ID);

        // Collect updates from related galleries
        for (const g of results) {
          if (g.media_id) {
            const thumbnailPath = g.thumbnail || ('galleries/' + g.media_id + '/thumb.jpg');
            batchUpdates.push({
              id: g.id,
              media_id: g.media_id,
              thumbnail: thumbnailPath,
            });
          }
        }
      } catch (error) {
        if (error.message === 'HTTP 429') {
          rateLimitHits++;
          // Apply pending updates before waiting
          updateBatch(batchUpdates);
          batchUpdates.length = 0;

          // Wait 60 seconds and retry
          console.log('[Backfill] Rate limited, waiting 60 seconds...');
          await new Promise(resolve => setTimeout(resolve, 60000));
          // Retry this ID
          try {
            const results = await fetchRelated(row.ID);
            for (const g of results) {
              if (g.media_id) {
                const thumbnailPath = g.thumbnail || ('galleries/' + g.media_id + '/thumb.jpg');
                batchUpdates.push({
                  id: g.id,
                  media_id: g.media_id,
                  thumbnail: thumbnailPath,
                });
              }
            }
          } catch (e) {
            failed++;
          }
        } else {
          failed++;
        }
      }

      processed++;

      // Delay between requests to avoid rate limit
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }

    // Apply remaining updates
    updateBatch(batchUpdates);

    console.log('[Backfill] Batch ' + batches + ': ' + processed + ' requests, ' + galleriesUpdated + ' galleries updated, ' + failed + ' failed, ' + rateLimitHits + ' rate limits)');

    // Check current coverage
    const coverage = db.prepare(
      "SELECT COUNT(*) as cnt FROM nh_data WHERE media_id IS NOT NULL AND media_id != '0'"
    ).get();
    const total = db.prepare("SELECT COUNT(*) as c FROM nh_data").get().c;
    console.log('[Backfill] Current coverage: ' + coverage.cnt + '/' + total + ' (' + ((coverage.cnt/total)*100).toFixed(2) + '%)');
  }

  const finalCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM nh_data WHERE media_id IS NOT NULL AND media_id != '0'"
  ).get();
  const total = db.prepare("SELECT COUNT(*) as c FROM nh_data").get().c;

  db.close();

  return {
    total: totalToProcess,
    processed,
    galleriesUpdated,
    failed,
    rateLimitHits,
    withMediaId: finalCount.cnt,
    coverage: ((finalCount.cnt/total)*100).toFixed(2) + '%',
  };
}

// CLI runner
if (import.meta.url === 'file://' + process.argv[1]) {
  const batchSize = parseInt(process.argv[2]) || 100;
  const maxBatches = parseInt(process.argv[3]) || null;

  console.log('[Backfill] Starting with batchSize=' + batchSize + ', maxBatches=' + maxBatches);
  console.log('[Backfill] Using /related endpoint with ' + (DELAY_MS/1000) + 's delay between requests');

  backfillMediaIds(batchSize, maxBatches)
    .then(stats => {
      console.log('[Backfill] Complete:', stats);
      process.exit(0);
    })
    .catch(err => {
      console.error('[Backfill] Fatal error:', err);
      process.exit(1);
    });
}

export default backfillMediaIds;
