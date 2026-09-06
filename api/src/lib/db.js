import { DatabaseSync } from 'node:sqlite';
import { ensureDb } from './build-db.js';

let db;

export function getDb() {
  if (!db) {
    const dbPath = ensureDb();
    if (!dbPath) {
      // Return null jika tidak ada database (live-only mode)
      return null;
    }
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = OFF');
    db.exec('PRAGMA synchronous = OFF');
    db.exec('PRAGMA cache_size = -64000'); // 64MB cache
  }
  return db;
}

// Helper: format timestamp ke ISO date
export function formatRow(row) {
  if (!row) return null;
  return {
    ...row,
    upload_date: row.upload_date ? new Date(row.upload_date * 1000).toISOString() : null,
    formatted_date: row.formatted_date,
    scraped_date: row.scraped_date,
  };
}

// Helper: parse tags string ke array
export function parseTags(row) {
  if (!row) return null;
  const formatted = formatRow(row);
  return {
    ...formatted,
    tags: row.tags ? row.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
  };
}
