import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '..', '..', 'data');
const DB_PATH = join(DATA_DIR, 'database.db');

// Check if database already exists
if (existsSync(DB_PATH)) {
  console.log('✅ Database already exists, skipping merge.');
  process.exit(0);
}

// Check for part files
const partFiles = readdirSync(DATA_DIR)
  .filter(f => f.startsWith('database.part'))
  .sort((a, b) => parseInt(a.split('part')[-1]) - parseInt(b.split('part')[-1]));

if (partFiles.length === 0) {
  console.log('⚠️ No database parts found. Database needs to be provided separately.');
  process.exit(0);
}

console.log(`🔧 Merging ${partFiles.length} database parts...`);

const chunks = partFiles.map(f => readFileSync(join(DATA_DIR, f)));
const merged = Buffer.concat(chunks);
writeFileSync(DB_PATH, merged);

console.log(`✅ Database merged: ${(merged.length / 1024 / 1024).toFixed(1)} MB`);
