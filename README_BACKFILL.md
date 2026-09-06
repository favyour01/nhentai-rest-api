# 🔄 Auto-Scraper & Backfill Documentation

## Masalah
Database asli (~678K records) tidak memiliki `media_id` yang diperlukan untuk:
- Thumbnail URL
- Cover URL
- Gambar komik

## Solusi

### 1. Auto-Scraper (Real-time)
API sekarang memiliki fitur auto-scraper yang secara otomatis melengkapi data yang tidak lengkap saat di-request.

**Cara kerja:**
- Saat Anda request `GET /api/v2/:id`, API akan mengecek apakah data lengkap
- Jika ada field yang kosong (media_id, JP_TITLE, ARTIST, TAGS, dll), API akan scrape dari nhentai.net
- Hasil scrape di-cache di memory (LRU cache, max 10.000 entries)

**Endpoints:**
```
GET /api/v2/:id?enrich=true     # Auto-enrich (default)
GET /api/v2/random?enrich=true  # Random dengan auto-enrich
GET /api/v2/search?enrich=true  # Search dengan auto-enrich
GET /api/v2/scrape/:id          # Manual scrape trigger
POST /api/v2/scrape/batch       # Batch scrape (max 50 IDs)
```

### 2. Backfill (Batch Processing)
Script backfill untuk mengisi media_id secara massal di database.

**Jalankan locally:**
```bash
cd api
node --input-type=module -e "import { backfillMediaIds } from './src/lib/backfill.js'; await backfillMediaIds(100, 10);"
```

**Parameters:**
- `batchSize`: Jumlah records per batch (default: 100)
- `maxBatches`: Maksimal batch yang diproses (default: null = unlimited)

### 3. Image URLs
Setelah media_id terisi, API akan mengembalikan URL gambar:
```json
{
  "cover_url": "https://t.nhentai.net/galleries/{media_id}/cover.jpg",
  "thumbnail_url": "https://t.nhentai.net/galleries/{media_id}/thumb.jpg"
}
```

## Progress

Cek status backfill:
```
GET https://api-akatsuki.vercel.app/api/v2/stats
```

Response:
```json
{
  "total_doujins": 678517,
  "with_media_id": 323,
  "thumbnail_coverage": "0.05%"
}
```

## Estimasi Waktu

Untuk 647K records:
- ~5 records/dengan concurrent requests
- ~129,400 detik = ~36 jam untuk semua records

**Rekomendasasi:**
1. Gunakan auto-scraper untuk data yang sering diakses
2. Jalankan backfill di local machine untuk data yang jarang diakses
3. Atau upgrade ke Vercel Pro untuk cron jobs yang lebih sering

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/v2/:id` | Detail doujin (auto-enrich) |
| `GET /api/v2/random` | Random doujin (auto-enrich) |
| `GET /api/v2/search?q=...` | Search doujins |
| `GET /api/v2/tags` | List semua tags |
| `GET /api/v2/artists` | List semua artist |
| `GET /api/v2/stats` | Statistik database |
| `GET /api/v2/scrape/:id` | Manual scrape |
| `POST /api/v2/scrape/batch` | Batch scrape |
| `GET /api/v2/cache/stats` | Cache statistics |
| `POST /api/v2/cache/clear` | Clear caches |

## Base URL
```
https://api-akatsuki.vercel.app
```
