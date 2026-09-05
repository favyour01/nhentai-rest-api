import { Router } from 'express';
import { getDb, parseTags, formatRow } from '../lib/db.js';

const router = Router();

/**
 * GET /api/v2/search
 * Search doujin dengan filter
 * Query: q (search term), lang, artist, tags, category, parody, character, page, limit, sort
 */
router.get('/search', (req, res) => {
  const {
    q = '',
    lang,
    artist,
    tags,
    category,
    parody,
    character,
    page = 1,
    limit = 20,
    sort = 'relevance'
  } = req.query;

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const offset = (pageNum - 1) * limitNum;

  const db = getDb();
  const conditions = [];
  const params = [];

  if (q) {
    conditions.push('(EN_TITLE LIKE ? OR JP_TITLE LIKE ? OR CLEAN_TITLE LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (lang) {
    conditions.push('LANG LIKE ?');
    params.push(`%${lang}%`);
  }
  if (artist) {
    conditions.push('ARTIST LIKE ?');
    params.push(`%${artist}%`);
  }
  if (tags) {
    conditions.push('TAGS LIKE ?');
    params.push(`%${tags}%`);
  }
  if (category) {
    conditions.push('CATEGORY LIKE ?');
    params.push(`%${category}%`);
  }
  if (parody) {
    conditions.push('PARODY LIKE ?');
    params.push(`%${parody}%`);
  }
  if (character) {
    conditions.push('CHARACTER LIKE ?');
    params.push(`%${character}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Sorting
  let orderBy = 'ID DESC';
  if (sort === 'newest') orderBy = 'UPLOAD_DATE DESC';
  else if (sort === 'oldest') orderBy = 'UPLOAD_DATE ASC';
  else if (sort === 'pages_desc') orderBy = 'PAGES DESC';
  else if (sort === 'pages_asc') orderBy = 'PAGES ASC';

  // Count total
  const countRow = db.prepare(`SELECT COUNT(*) as total FROM nh_data ${whereClause}`).get(...params);
  const total = countRow.total;

  // Fetch data
  const rows = db.prepare(
    `SELECT * FROM nh_data ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
  ).all(...params, limitNum, offset);

  res.json({
    success: true,
    data: rows.map(parseTags),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      total_pages: Math.ceil(total / limitNum),
      has_next: pageNum * limitNum < total,
      has_prev: pageNum > 1
    }
  });
});

/**
 * GET /api/v2/random
 * Random doujin
 */
router.get('/random', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM nh_data ORDER BY RANDOM() LIMIT 1').get();

  res.json({ success: true, data: parseTags(row) });
});

/**
 * GET /api/v2/tags
 * List semua unik tags (distinct)
 */
router.get('/tags', (req, res) => {
  const { q = '', limit = 50, page = 1 } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  const db = getDb();

  // Get distinct tags
  const rows = db.prepare("SELECT TAGS FROM nh_data WHERE TAGS IS NOT NULL AND TAGS != ''").all();

  const tagMap = new Map();
  for (const row of rows) {
    const tags = row.TAGS.split(',').map(t => t.trim()).filter(Boolean);
    for (const tag of tags) {
      tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
    }
  }

  let tagArray = Array.from(tagMap.entries()).map(([name, count]) => ({ name, count }));

  if (q) {
    tagArray = tagArray.filter(t => t.name.toLowerCase().includes(q.toLowerCase()));
  }

  tagArray.sort((a, b) => b.count - a.count);

  const total = tagArray.length;
  const paginated = tagArray.slice(offset, offset + limitNum);

  res.json({
    success: true,
    data: paginated,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      total_pages: Math.ceil(total / limitNum)
    }
  });
});

/**
 * GET /api/v2/artists
 * List semua unik artist
 */
router.get('/artists', (req, res) => {
  const { q = '', limit = 50, page = 1 } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  const db = getDb();
  const rows = db.prepare("SELECT ARTIST FROM nh_data WHERE ARTIST IS NOT NULL AND ARTIST != ''").all();

  const artistMap = new Map();
  for (const row of rows) {
    artistMap.set(row.ARTIST, (artistMap.get(row.ARTIST) || 0) + 1);
  }

  let artistArray = Array.from(artistMap.entries()).map(([name, count]) => ({ name, count }));

  if (q) {
    artistArray = artistArray.filter(a => a.name.toLowerCase().includes(q.toLowerCase()));
  }

  artistArray.sort((a, b) => b.count - a.count);

  const total = artistArray.length;
  const paginated = artistArray.slice(offset, offset + limitNum);

  res.json({
    success: true,
    data: paginated,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      total_pages: Math.ceil(total / limitNum)
    }
  });
});

/**
 * GET /api/v2/stats
 * Statistik database
 */
router.get('/stats', (req, res) => {
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) as count FROM nh_data').get().count;
  const languages = db.prepare('SELECT LANGUAGE, COUNT(*) as count FROM nh_data GROUP BY LANGUAGE ORDER BY count DESC').all();
  const categories = db.prepare("SELECT CATEGORY, COUNT(*) as count FROM nh_data WHERE CATEGORY IS NOT NULL AND CATEGORY != '' GROUP BY CATEGORY ORDER BY count DESC").all();
  const dateRange = db.prepare('SELECT MIN(UPLOAD_DATE) as min_date, MAX(UPLOAD_DATE) as max_date FROM nh_data').get();

  res.json({
    success: true,
    data: {
      total_doujins: total,
      languages: languages.slice(0, 20),
      categories,
      date_range: {
        earliest: dateRange.min_date ? new Date(dateRange.min_date * 1000).toISOString() : null,
        latest: dateRange.max_date ? new Date(dateRange.max_date * 1000).toISOString() : null,
      }
    }
  });
});

/**
 * GET /api/v2/:id
 * Detail doujin berdasarkan ID (HARUS DI TERAKHIR - jangan tangkap route lain)
 */
router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id) || id < 1) {
    return res.status(400).json({ success: false, error: 'Invalid ID. Must be a positive integer.' });
  }

  const db = getDb();
  const row = db.prepare('SELECT * FROM nh_data WHERE ID = ?').get(id);

  if (!row) {
    return res.status(404).json({ success: false, error: 'Doujin not found' });
  }

  res.json({ success: true, data: parseTags(row) });
});

export default router;
