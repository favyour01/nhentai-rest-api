#!/usr/bin/env node
/**
 * Script untuk backfill media_id secara local
 * Jalankan: node backfill-local.js [batch_size] [max_batches]
 * 
 * Contoh:
 *   node backfill-local.js 100 10    # 100 records per batch, max 10 batches
 *   node backfill-local.js 50 100    # 50 records per batch, max 100 batches
 *   node backfill-local.js           # Default: 100 records, unlimited batches
 */

import { backfillMediaIds } from './src/lib/backfill.js';

const batchSize = parseInt(process.argv[2]) || 100;
const maxBatches = parseInt(process.argv[3]) || null;

console.log('='.repeat(60));
console.log('nhentai API - Media ID Backfill Tool');
console.log('='.repeat(60));
console.log(`Batch size: ${batchSize}`);
console.log(`Max batches: ${maxBatches || 'unlimited'}`);
console.log('='.repeat(60));

const startTime = Date.now();

backfillMediaIds(batchSize, maxBatches)
  .then(stats => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('='.repeat(60));
    console.log('BACKFILL COMPLETE');
    console.log('='.repeat(60));
    console.log(`Total processed: ${stats.processed}`);
    console.log(`Success: ${stats.success}`);
    console.log(`Failed: ${stats.failed}`);
    console.log(`With media_id: ${stats.withMediaId}`);
    console.log(`Time elapsed: ${elapsed}s`);
    console.log('='.repeat(60));
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
