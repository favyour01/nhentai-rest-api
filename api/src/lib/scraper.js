/**
 * Auto-Scraper Module untuk melengkapi data yang tidak lengkap
 * Menggunakan Cloudflare IP untuk bypass DNS block dari ISP
 *
 * Strategy:
 * 1. Saat ada request untuk data yang tidak lengkap, scrape real-time dari nhentai API v2
 * 2. Cache hasil scrape di memory (LRU cache)
 * 3. Rate limiting untuk tidak overload nhentai servers
 * 4. Simpan media_id ke database untuk penggunaan selanjutnya
 *
 * Note: /api/v2/galleries/{id} has strict rate limit (10 req/min)
 *       /api/v2/galleries/{id}/related has NO rate limit (use for backfill)
 */

import https from 'https';

// Cloudflare IPs untuk bypass DNS block
const CF_IPS = [
  '104.21.235.100',
  '104.21.234.100',
  '104.21.233.100',
  '172.67.182.100',
  '172.67.181.100',
  '104.26.10.100',
  '104.26.11.100',
];

let ipIndex = 0;
function getNextIp() {
  const ip = CF_IPS[ipIndex % CF_IPS.length];
  ipIndex++;
  return ip;
}

// Simple LRU Cache
class LRUCache {
  constructor(maxSize = 5000) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return null;
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  has(key) {
    return this.cache.has(key);
  }

  get size() {
    return this.cache.size;
  }
}

const scrapeCache = new LRUCache(10000);
const notFoundCache = new LRUCache(5000);

let activeRequests = 0;
const MAX_CONCURRENT = 1; // Strict: only 1 concurrent request
const requestQueue = [];

function processQueue() {
  if (requestQueue.length === 0) return;
  if (activeRequests >= MAX_CONCURRENT) return;

  const item = requestQueue.shift();
  activeRequests++;
  item.fn().then(item.resolve).catch(item.reject).finally(() => {
    activeRequests--;
    processQueue();
  });
}

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ resolve, reject, fn });
    processQueue();
  });
}

function fetchFromNHentai(path, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const ip = getNextIp();
    const options = {
      hostname: ip,
      port: 443,
      path: path,
      method: 'GET',
      headers: {
        'Host': 'nhentai.net',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
      rejectUnauthorized: false,
      timeout: timeout,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        } else if (res.statusCode === 404) {
          resolve(null);
        } else if (res.statusCode === 429) {
          reject(new Error('RATE_LIMITED'));
        } else {
          reject(new Error('HTTP ' + res.statusCode));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

function parseGalleryData(apiData) {
  if (!apiData) return null;

  const tags = apiData.tags || [];

  const tagsByType = {};
  for (const tag of tags) {
    if (!tagsByType[tag.type]) tagsByType[tag.type] = [];
    tagsByType[tag.type].push(tag.name);
  }

  const generalTags = tagsByType['tag'] || [];
  const uniqueTags = [...new Set(generalTags)];

  return {
    id: apiData.id,
    title_en: apiData.title?.english || null,
    title_jp: apiData.title?.japanese || null,
    title_pretty: apiData.title?.pretty || null,
    language: (tagsByType['language'] || []).join(', ') || null,
    artist: (tagsByType['artist'] || []).join(', ') || null,
    group_name: (tagsByType['group'] || []).join(', ') || null,
    category: (tagsByType['category'] || [])[0] || null,
    parody: (tagsByType['parody'] || []).join(', ') || null,
    character: (tagsByType['character'] || []).join(', ') || null,
    tags: uniqueTags.join(', ') || null,
    pages: apiData.num_pages || apiData.pages?.length || null,
    upload_date: apiData.upload_date || null,
    media_id: apiData.media_id || null,
    cover_path: apiData.cover?.path || null,
    thumbnail_path: apiData.thumbnail?.path || null,
  };
}

function parseRelatedGallery(g) {
  if (!g || !g.media_id) return null;
  return {
    id: g.id,
    media_id: String(g.media_id),
    thumbnail_path: g.thumbnail || ('galleries/' + g.media_id + '/thumb.jpg'),
    title_en: g.english_title || null,
    title_jp: g.japanese_title || null,
    pages: g.num_pages || null,
  };
}

function needsScraping(row) {
  if (!row) return false;
  if (!row.EN_TITLE || row.EN_TITLE === '404') return false;

  const missingJP = !row.JP_TITLE || row.JP_TITLE.trim() === '';
  const missingArtist = !row.ARTIST || row.ARTIST.trim() === '';
  const missingTags = !row.TAGS || row.TAGS.trim() === '';
  const missingPages = !row.PAGES || row.PAGES === 0;
  const missingUploadDate = !row.UPLOAD_DATE || row.UPLOAD_DATE === 0;
  const missingMediaId = !row.media_id || row.media_id === '0';

  return missingJP || missingArtist || missingTags || missingPages || missingUploadDate || missingMediaId;
}

export async function scrapeGallery(id) {
  if (scrapeCache.has(id)) {
    return scrapeCache.get(id);
  }

  if (notFoundCache.has(id)) {
    return null;
  }

  try {
    const apiData = await enqueue(() => fetchFromNHentai('/api/v2/galleries/' + id));

    if (!apiData) {
      notFoundCache.set(id, true);
      return null;
    }

    const parsed = parseGalleryData(apiData);
    scrapeCache.set(id, parsed);
    return parsed;
  } catch (error) {
    if (error.message === 'RATE_LIMITED') {
      // Try to get at least media_id from related endpoint (no rate limit!)
      try {
        const related = await fetchFromNHentai('/api/v2/galleries/' + id + '/related');
        if (related && related.result && related.result.length > 0) {
          // Find the original gallery in related results
          const original = related.result.find(g => g.id === id);
          if (original && original.media_id) {
            const parsed = {
              id: id,
              media_id: String(original.media_id),
              thumbnail_path: original.thumbnail || ('galleries/' + original.media_id + '/thumb.jpg'),
              title_en: original.english_title || null,
              title_jp: original.japanese_title || null,
              pages: original.num_pages || null,
            };
            scrapeCache.set(id, parsed);
            return parsed;
          }
        }
      } catch (e) {
        // Related also failed
      }
    }
    return null;
  }
}

export async function scrapeRelated(id) {
  try {
    const apiData = await enqueue(() => fetchFromNHentai('/api/v2/galleries/' + id + '/related'));
    if (!apiData || !apiData.result) return [];
    return apiData.result.map(parseRelatedGallery).filter(Boolean);
  } catch (error) {
    console.error('[Scraper] Error fetching related for ID ' + id + ':', error.message);
    return [];
  }
}

export async function enrichRow(row) {
  if (!needsScraping(row)) {
    return row;
  }

  const scraped = await scrapeGallery(row.ID);
  if (!scraped) {
    return row;
  }

  return {
    ...row,
    JP_TITLE: row.JP_TITLE || scraped.title_jp,
    CLEAN_TITLE: row.CLEAN_TITLE || scraped.title_pretty,
    LANGUAGE: row.LANGUAGE || scraped.language,
    ARTIST: row.ARTIST || scraped.artist,
    GROUP_NAME: row.GROUP_NAME || scraped.group_name,
    CATEGORY: row.CATEGORY || scraped.category,
    PARODY: row.PARODY || scraped.parody,
    CHARACTER: row.CHARACTER || scraped.character,
    TAGS: row.TAGS || scraped.tags,
    PAGES: row.PAGES || scraped.pages,
    UPLOAD_DATE: row.UPLOAD_DATE || scraped.upload_date,
    media_id: row.media_id && row.media_id !== '0' ? row.media_id : scraped.media_id,
    cover_path: scraped.cover_path,
    thumbnail_path: scraped.thumbnail_path,
    _scraped: true,
  };
}

export function getCacheStats() {
  return {
    scrapeCache: scrapeCache.size,
    notFoundCache: notFoundCache.size,
    queueLength: requestQueue.length,
    activeRequests: activeRequests,
  };
}

export function clearCaches() {
  scrapeCache.cache.clear();
  notFoundCache.cache.clear();
}

export { scrapeCache, notFoundCache };
