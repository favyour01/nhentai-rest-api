import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Di Vercel, simpan merged db di /tmp (writable)
const DATA_DIR = join(__dirname, '..', '..', 'data');
const DB_PATH = process.env.VERCEL
  ? '/tmp/database.db'
  : join(DATA_DIR, 'database.db');

export function ensureDb() {
  // Jika sudah ada, skip
  if (existsSync(DB_PATH)) {
    return DB_PATH;
  }

  // Tentukan sumber parts
  const partsDir = DATA_DIR;
  const partFiles = readdirSync(partsDir)
    .filter(f => f.startsWith('database.part'))
    .sort((a, b) => {
      const numA = parseInt(a.replace('database.part', ''));
      const numB = parseInt(b.replace('database.part', ''));
      return numA - numB;
    });

  if (partFiles.length === 0) {
    console.log('⚠️ No database parts found.');
    return null;
  }

  console.log(`🔧 Merging ${partFiles.length} database parts...`);
  const chunks = partFiles.map(f => readFileSync(join(partsDir, f)));
  const merged = Buffer.concat(chunks);
  writeFileSync(DB_PATH, merged);

  console.log(`✅ Database merged: ${(merged.length / 1024 / 1024).toFixed(1)} MB`);
  return DB_PATH;
}

export { DB_PATH };
