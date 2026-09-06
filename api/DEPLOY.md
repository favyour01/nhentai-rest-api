# 🚀 Deployment Guide

## Deploy ke Vercel

### Via Vercel Dashboard (Recommended)

1. **Buat repo GitHub baru** dan push project ini:
   ```bash
   cd /path/to/unofficial-nhentai-api
   git init
   git add .
   git commit -m "Initial commit: nhentai REST API v2"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/nhentai-rest-api.git
   git push -u origin main
   ```

2. **Import ke Vercel**:
   - Buka [vercel.com/new](https://vercel.com/new)
   - Pilih repo `nhentai-rest-api`
   - Framework: **Other** (atau otomatis detect Node.js)
   - Root Directory: `api`
   - Build Command: `npm run build-db`
   - Output Directory: (kosongkan, biarkan default)
   - Klik **Deploy**

3. **Selesai!** API akan live di `https://api-lkj0pl4nd-akatsuki.vercel.app`

### Via Vercel CLI

```bash
cd api
vercel --prod
```

## Endpoints setelah deploy

| Endpoint | URL |
|----------|-----|
| Landing | `https://api-lkj0pl4nd-akatsuki.vercel.app/` |
| Docs | `https://api-lkj0pl4nd-akatsuki.vercel.app/docs` |
| API | `https://api-lkj0pl4nd-akatsuki.vercel.app/api/v2/...` |
| Health | `https://api-lkj0pl4nd-akatsuki.vercel.app/api/health` |

## Catatan Penting

- Database SQLite (~273MB setelah merge) akan ada di Vercel filesystem
- Vercel free tier punya limit 5GB file storage — cukup untuk database ini
- First request setelah deploy mungkin lambat (~5-10 detik) karena cold start + merge DB
- Database bersifat **read-only** (tidak ada write endpoint)
- Rate limit: 300 requests per 15 menit per IP
