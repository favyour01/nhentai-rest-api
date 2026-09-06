/**
 * Live Search Module - Real-time search from nhentai API
 * Searches directly from nhentai and returns complete data
 */

import https from 'https';

const CF_IPS = [
  '104.21.235.100',
  '104.21.234.100',
  '104.21.233.100',
  '172.67.182.100',
  '172.67.181.100',
];

let ipIndex = 0;
function getNextIp() {
  const ip = CF_IPS[ipIndex % CF_IPS.length];
  ipIndex++;
  return ip;
}

function fetchFromNHentai(path, timeout = 20000) {
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
            reject(new Error('Invalid JSON'));
          }
        } else if (res.statusCode === 429) {
          reject(new Error('RATE_LIMITED'));
        } else if (res.statusCode === 404) {
          resolve(null);
        } else {
          reject(new Error('HTTP ' + res.statusCode));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.end();
  });
}

function parseGallery(g) {
  if (!g || !g.media_id) return null;
  return {
    ID: g.id,
    EN_TITLE: g.english_title || g.title?.english || '',
    JP_TITLE: g.japanese_title || g.title?.japanese || '',
    CLEAN_TITLE: g.title?.pretty || g.english_title || '',
    LANGUAGE: g.language || '',
    ARTIST: g.artist || '',
    GROUP_NAME: g.group || '',
    CATEGORY: g.category || '',
    PARODY: g.parody || '',
    CHARACTER: g.character || '',
    TAGS: Array.isArray(g.tags) ? g.tags.join(', ') : (g.tags || ''),
    PAGES: g.num_pages || 0,
    UPLOAD_DATE: g.upload_date || 0,
    media_id: String(g.media_id),
    cover_path: g.cover?.path || ('galleries/' + g.media_id + '/cover.jpg'),
    thumbnail_path: g.thumbnail?.path || g.thumbnail || ('galleries/' + g.media_id + '/thumb.jpg'),
    _source: 'live',
  };
}

/**
 * Search galleries from nhentai in real-time
 */
export async function liveSearch(query, limit = 20) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const data = await fetchFromNHentai('/api/v2/galleries/search?query=' + encodedQuery + '&page=1');

    if (!data || !data.result || !Array.isArray(data.result)) {
      return [];
    }

    return data.result
      .slice(0, limit)
      .map(parseGallery)
      .filter(Boolean);
  } catch (error) {
    console.error('[LiveSearch] Error:', error.message);
    return [];
  }
}

/**
 * Get a random gallery from nhentai (complete data)
 */
export async function getRandomLive() {
  try {
    // Get a random page from search results
    const randomPage = Math.floor(Math.random() * 100) + 1;
    const data = await fetchFromNHentai('/api/v2/galleries/search?query=language:english&page=' + randomPage);

    if (!data || !data.result || !Array.isArray(data.result) || data.result.length === 0) {
      return null;
    }

    // Pick a random result
    const randomIndex = Math.floor(Math.random() * data.result.length);
    return parseGallery(data.result[randomIndex]);
  } catch (error) {
    console.error('[LiveSearch] Random error:', error.message);
    return null;
  }
}

/**
 * Get gallery by ID from nhentai (complete data)
 */
export async function getGalleryLive(id) {
  try {
    const data = await fetchFromNHentai('/api/v2/galleries/' + id);
    if (!data) return null;
    return parseGallery(data);
  } catch (error) {
    console.error('[LiveSearch] Get error:', error.message);
    return null;
  }
}

/**
 * Get related galleries (no rate limit!)
 */
export async function getRelated(id) {
  try {
    const data = await fetchFromNHentai('/api/v2/galleries/' + id + '/related');
    if (!data || !data.result) return [];
    return data.result.map(parseGallery).filter(Boolean);
  } catch (error) {
    console.error('[LiveSearch] Related error:', error.message);
    return [];
  }
}

export default { liveSearch, getRandomLive, getGalleryLive, getRelated };
