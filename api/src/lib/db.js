import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database path - di Vercel, file ada di root project
const DB_PATH = process.env.VERCEL
  ? join(process.cwd(), '..', 'data', 'database.db')
  : join(__dirname, '..', '..', 'data', 'database.db');

let db;

export function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
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
