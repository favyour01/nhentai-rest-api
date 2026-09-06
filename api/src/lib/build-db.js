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

  // Cari parts di beberapa lokasi possible
  const possibleDirs = [
    DATA_DIR,
    join(__dirname, '..', '..', '..', 'data'),
    join(process.cwd(), 'data'),
    '/var/task/api/data',
    '/var/task/data',
  ];

  let partFiles = [];
  let partsDir = null;

  for (const dir of possibleDirs) {
    try {
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir)
        .filter(f => f.match(/^database\.part\d+$/))
        .sort((a, b) => {
          const numA = parseInt(a.replace('database.part', ''));
          const numB = parseInt(b.replace('database.part', ''));
          return numA - numB;
        });
      if (files.length > 0) {
        partFiles = files;
        partsDir = dir;
        break;
      }
    } catch (e) {
      // Ignore errors
    }
  }

  if (partFiles.length === 0) {
    console.log('⚠️ No database parts found. Live-only mode.');
    return null;
  }

  console.log(`🔧 Merging ${partFiles.length} database parts from ${partsDir}...`);
  try {
    const chunks = partFiles.map(f => readFileSync(join(partsDir, f)));
    const merged = Buffer.concat(chunks);

    // Pastikan direktori tujuan ada
    const dbDir = dirname(DB_PATH);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    writeFileSync(DB_PATH, merged);
    console.log(`✅ Database merged: ${(merged.length / 1024 / 1024).toFixed(1)} MB`);
    return DB_PATH;
  } catch (e) {
    console.error('❌ Error merging database:', e.message);
    return null;
  }
}

export { DB_PATH };
