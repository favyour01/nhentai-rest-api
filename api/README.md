# 📚 nhentai REST API v2

> Unofficial nhentai REST API — rombak total dengan landing page & dokumentasi modern.

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![Node.js](https://img.shields.io/badge/node-%3E%2022.5-green)
![License](https://img.shields.io/badge/license-MIT-yellow)

## ✨ Features

- 🔍 **Full-Text Search** — Search by title, tags, artist, category, parody, character
- 🎲 **Random Endpoint** — Get a random doujin instantly
- 📊 **Paginated Results** — Configurable limits up to 100 items/page
- ⚡ **Fast Response** — SQLite with optimized queries, sub-100ms responses
- 🌐 **CORS Enabled** — Works from browser-side apps
- 🔓 **No Auth Required** — No API keys needed
- 📖 **Beautiful Docs** — Interactive documentation with code examples
- 🏠 **Landing Page** — Modern, responsive landing page with live demo

## 🚀 Quick Start

### Prerequisites
- Node.js >= 22.5.0 (for built-in `node:sqlite`)

### Installation

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/nhentai-rest-api.git
cd nhentai-rest-api/api

# Install dependencies
npm install

# Build database (merges split parts)
npm run build-db

# Start server
npm start
```

Server runs at `http://localhost:3000`

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v2/:id` | Get doujin by ID |
| GET | `/api/v2/search` | Search with filters |
| GET | `/api/v2/random` | Random doujin |
| GET | `/api/v2/tags` | List all tags |
| GET | `/api/v2/artists` | List all artists |
| GET | `/api/v2/stats` | Database statistics |
| GET | `/api/health` | Health check |

> All endpoints are also available under `/v2/` alias.

## 🔍 Search Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `q` | string | Search term (matches title fields) |
| `lang` | string | Filter by language |
| `artist` | string | Filter by artist |
| `tags` | string | Filter by tag |
| `category` | string | Filter by category |
| `parody` | string | Filter by parody/source |
| `character` | string | Filter by character |
| `page` | integer | Page number (default: 1) |
| `limit` | integer | Items per page (default: 20, max: 100) |
| `sort` | string | `relevance`, `newest`, `oldest`, `pages_desc`, `pages_asc` |

## 📖 Examples

```bash
# Search for doujins
curl "https://api-lkj0pl4nd-akatsuki.vercel.app/api/v2/search?q=school&lang=english&limit=10"

# Get doujin by ID
curl "https://api-lkj0pl4nd-akatsuki.vercel.app/api/v2/12345"

# Get random doujin
curl "https://api-lkj0pl4nd-akatsuki.vercel.app/api/v2/random"

# Get stats
curl "https://api-lkj0pl4nd-akatsuki.vercel.app/api/v2/stats"
```

```javascript
// JavaScript fetch
const res = await fetch('/api/v2/search?q=girls&limit=5');
const json = await res.json();
console.log(json.data);
```

## 🌐 Deploy to Vercel

1. Fork/clone this repo
2. Import to [Vercel](https://vercel.com)
3. Set build command: `npm run build-db`
4. Deploy!

## ⚠️ Disclaimer

This API is **unofficial** and not affiliated with nhentai.net. Data is provided for educational and research purposes only.

## 📄 License

MIT License
