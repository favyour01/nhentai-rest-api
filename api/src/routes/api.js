import { Router } from "express";
import { getDb, parseTags, formatRow } from "../lib/db.js";
import { scrapeGallery, enrichRow, getCacheStats, clearCaches } from "../lib/scraper.js";

const router = Router();

function addImageUrls(row) {
  if (!row) return row;
  const mediaId = row.media_id;
  if (mediaId && mediaId !== "0") {
    row.cover_url = "https://t.nhentai.net/galleries/" + mediaId + "/cover.jpg";
    row.thumbnail_url = "https://t.nhentai.net/galleries/" + mediaId + "/thumb.jpg";
  }
  return row;
}

function ensureColumns(db) {
  if (!db) return;
  try { db.exec("ALTER TABLE nh_data ADD COLUMN media_id TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE nh_data ADD COLUMN cover_path TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE nh_data ADD COLUMN thumbnail_path TEXT"); } catch(e) {}
}

// Save scraped data to database if complete
function saveIfComplete(db, scraped) {
  if (!db || !scraped || !scraped.media_id) return false;

  const existing = db.prepare("SELECT ID FROM nh_data WHERE ID = ?").get(scraped.id);
  if (existing) {
    db.prepare(`
      UPDATE nh_data SET
        EN_TITLE = ?, JP_TITLE = ?, CLEAN_TITLE = ?,
        LANGUAGE = ?, ARTIST = ?, GROUP_NAME = ?,
        CATEGORY = ?, PARODY = ?, CHARACTER = ?,
        TAGS = ?, PAGES = ?, UPLOAD_DATE = ?,
        media_id = ?, cover_path = ?, thumbnail_path = ?
      WHERE ID = ?
    `).run(
      scraped.title_en, scraped.title_jp, scraped.title_pretty,
      scraped.language, scraped.artist, scraped.group_name,
      scraped.category, scraped.parody, scraped.character,
      scraped.tags, scraped.pages, scraped.upload_date,
      scraped.media_id, scraped.cover_path, scraped.thumbnail_path,
      scraped.id
    );
  } else {
    db.prepare(`
      INSERT INTO nh_data (
        ID, EN_TITLE, JP_TITLE, CLEAN_TITLE,
        LANGUAGE, ARTIST, GROUP_NAME,
        CATEGORY, PARODY, CHARACTER,
        TAGS, PAGES, UPLOAD_DATE,
        media_id, cover_path, thumbnail_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      scraped.id, scraped.title_en, scraped.title_jp, scraped.title_pretty,
      scraped.language, scraped.artist, scraped.group_name,
      scraped.category, scraped.parody, scraped.character,
      scraped.tags, scraped.pages, scraped.upload_date,
      scraped.media_id, scraped.cover_path, scraped.thumbnail_path
    );
  }
  return true;
}

// Get DB or null
function getDbSafe() {
  try { return getDb(); } catch(e) { return null; }
}

router.get("/search", async (req, res) => {
  try {
    const { q = "", lang, artist, tags, category, parody, character, page = 1, limit = 20, sort = "relevance", enrich = "true" } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;
    const db = getDbSafe();
    ensureColumns(db);

    // Live search dari nhentai (utama)
    let liveResults = [];
    if (q && q.trim().length > 0) {
      try {
        const { liveSearch } = await import("../lib/live-search.js");
        liveResults = await liveSearch(q, limitNum);
      } catch(e) { console.error('[Search] Live error:', e.message); }
    }

    // Database search (jika ada DB)
    let dbResults = [];
    let dbTotal = 0;
    if (db) {
      const conditions = [];
      const params = [];
      if (q) { conditions.push("(EN_TITLE LIKE ? OR JP_TITLE LIKE ? OR CLEAN_TITLE LIKE ?)"); params.push("%"+q+"%", "%"+q+"%", "%"+q+"%"); }
      if (lang) { conditions.push("LANGUAGE LIKE ?"); params.push("%"+lang+"%"); }
      if (artist) { conditions.push("ARTIST LIKE ?"); params.push("%"+artist+"%"); }
      if (tags) { conditions.push("TAGS LIKE ?"); params.push("%"+tags+"%"); }
      if (category) { conditions.push("CATEGORY LIKE ?"); params.push("%"+category+"%"); }
      if (parody) { conditions.push("PARODY LIKE ?"); params.push("%"+parody+"%"); }
      if (character) { conditions.push("CHARACTER LIKE ?"); params.push("%"+character+"%"); }
      const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
      let orderBy = "ID DESC";
      if (sort === "newest") orderBy = "UPLOAD_DATE DESC";
      else if (sort === "oldest") orderBy = "UPLOAD_DATE ASC";
      else if (sort === "pages_desc") orderBy = "PAGES DESC";
      else if (sort === "pages_asc") orderBy = "PAGES ASC";

      const countRow = db.prepare("SELECT COUNT(*) as total FROM nh_data "+whereClause).get(...params);
      dbTotal = countRow.total;
      const rows = db.prepare("SELECT * FROM nh_data "+whereClause+" ORDER BY "+orderBy+" LIMIT ? OFFSET ?").all(...params, limitNum, offset);
      dbResults = rows;

      if (enrich === "true") {
        for (let i = 0; i < dbResults.length; i++) {
          dbResults[i] = await enrichRow(dbResults[i]);
          if (dbResults[i].media_id) {
            db.prepare("UPDATE nh_data SET media_id = ?, cover_path = ?, thumbnail_path = ? WHERE ID = ?").run(dbResults[i].media_id, dbResults[i].cover_path, dbResults[i].thumbnail_path, dbResults[i].ID);
          }
        }
      }
    }

    // Combine results (live first, then db, deduplicate by ID)
    const seenIds = new Set();
    const combined = [];
    for (const lr of liveResults) {
      if (!seenIds.has(lr.ID)) {
        combined.push(lr);
        seenIds.add(lr.ID);
      }
    }
    for (const dr of dbResults) {
      if (!seenIds.has(dr.ID)) {
        combined.push(dr);
        seenIds.add(dr.ID);
      }
    }

    const data = combined.map(row => parseTags(addImageUrls(row)));
    res.json({
      success: true,
      data: data,
      pagination: { page: pageNum, limit: limitNum, total: liveResults.length + dbTotal, total_pages: Math.ceil((liveResults.length + dbTotal) / limitNum), has_next: pageNum * limitNum < (liveResults.length + dbTotal), has_prev: pageNum > 1 },
      meta: { enriched: enrich === "true", live: true, live_results: liveResults.length, db_results: dbResults.length }
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get("/random", async (req, res) => {
  try {
    const db = getDbSafe();

    // Try database first
    if (db) {
      let row = db.prepare("SELECT * FROM nh_data WHERE media_id IS NOT NULL AND media_id != '0' ORDER BY RANDOM() LIMIT 1").get();
      if (row) {
        row = await enrichRow(row);
        return res.json({ success: true, data: parseTags(addImageUrls(row)), meta: { enriched: true, source: 'database' } });
      }
    }

    // Live random
    try {
      const { getRandomLive } = await import("../lib/live-search.js");
      const liveRow = await getRandomLive();
      if (liveRow && liveRow.media_id) {
        if (db) saveIfComplete(db, liveRow);
        return res.json({ success: true, data: parseTags(addImageUrls(liveRow)), meta: { enriched: true, source: 'live' } });
      }
    } catch(e) {}

    res.status(404).json({ success: false, error: "Could not fetch random doujin" });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get("/tags", async (req, res) => {
  try {
    const { q = "", limit = 50, page = 1 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;

    // Live tags dari nhentai
    const { liveSearch } = await import("../lib/live-search.js");
    const sample = await liveSearch(q || "popular", 50);
    const tagMap = new Map();
    for (const item of sample) {
      if (item.TAGS) {
        for (const tag of item.TAGS.split(',').map(t => t.trim()).filter(Boolean)) {
          tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
        }
      }
    }

    // Also get from DB if available
    const db = getDbSafe();
    if (db) {
      try {
        const rows = db.prepare("SELECT TAGS FROM nh_data WHERE TAGS IS NOT NULL AND TAGS != ''").all();
        for (const row of rows) {
          for (const tag of row.TAGS.split(',').map(t => t.trim()).filter(Boolean)) {
            tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
          }
        }
      } catch(e) {}
    }

    let tagArray = Array.from(tagMap.entries()).map(([name, count]) => ({ name, count }));
    if (q) { tagArray = tagArray.filter(t => t.name.toLowerCase().includes(q.toLowerCase())); }
    tagArray.sort((a, b) => b.count - a.count);
    res.json({ success: true, data: tagArray.slice(offset, offset + limitNum), pagination: { page: pageNum, limit: limitNum, total: tagArray.length, total_pages: Math.ceil(tagArray.length / limitNum) } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get("/artists", async (req, res) => {
  try {
    const { q = "", limit = 50, page = 1 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;

    const db = getDbSafe();
    if (db) {
      try {
        const rows = db.prepare("SELECT ARTIST FROM nh_data WHERE ARTIST IS NOT NULL AND ARTIST != ''").all();
        const artistMap = new Map();
        for (const row of rows) { artistMap.set(row.ARTIST, (artistMap.get(row.ARTIST) || 0) + 1); }
        let artistArray = Array.from(artistMap.entries()).map(([name, count]) => ({ name, count }));
        if (q) { artistArray = artistArray.filter(a => a.name.toLowerCase().includes(q.toLowerCase())); }
        artistArray.sort((a, b) => b.count - a.count);
        return res.json({ success: true, data: artistArray.slice(offset, offset + limitNum), pagination: { page: pageNum, limit: limitNum, total: artistArray.length, total_pages: Math.ceil(artistArray.length / limitNum) } });
      } catch(e) {}
    }

    // Fallback ke live
    res.json({ success: true, data: [], pagination: { page: pageNum, limit: limitNum, total: 0, total_pages: 0 }, meta: { message: "Database not available" } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get("/stats", (req, res) => {
  try {
    const db = getDbSafe();
    let stats = { total_doujins: 0, with_media_id: 0, thumbnail_coverage: "0%", languages: [], categories: [], scraper_cache: getCacheStats() };

    if (db) {
      ensureColumns(db);
      const total = db.prepare("SELECT COUNT(*) as count FROM nh_data").get().count;
      const languages = db.prepare("SELECT LANGUAGE, COUNT(*) as count FROM nh_data GROUP BY LANGUAGE ORDER BY count DESC").all();
      const categories = db.prepare("SELECT CATEGORY, COUNT(*) as count FROM nh_data WHERE CATEGORY IS NOT NULL AND CATEGORY != '' GROUP BY CATEGORY ORDER BY count DESC").all();
      const dateRange = db.prepare("SELECT MIN(UPLOAD_DATE) as min_date, MAX(UPLOAD_DATE) as max_date FROM nh_data").get();
      const withMediaId = db.prepare("SELECT COUNT(*) as count FROM nh_data WHERE media_id IS NOT NULL AND media_id != '0'").get();
      stats = {
        total_doujins: total,
        with_media_id: withMediaId.count,
        thumbnail_coverage: ((withMediaId.count / total) * 100).toFixed(2) + "%",
        languages: languages.slice(0, 20),
        categories,
        date_range: { earliest: dateRange.min_date ? new Date(dateRange.min_date * 1000).toISOString() : null, latest: dateRange.max_date ? new Date(dateRange.max_date * 1000).toISOString() : null },
        scraper_cache: getCacheStats()
      };
    }

    res.json({ success: true, data: stats, meta: { db_available: !!db, live_mode: !db } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get("/scrape/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id < 1) return res.status(400).json({ success: false, error: "Invalid ID" });
    const scraped = await scrapeGallery(id);
    if (!scraped) return res.status(404).json({ success: false, error: "Could not fetch" });
    const db = getDbSafe();
    if (db) saveIfComplete(db, scraped);
    res.json({ success: true, data: scraped, meta: { saved: !!db } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post("/scrape/batch", async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, error: "ids required" });
    if (ids.length > 20) return res.status(400).json({ success: false, error: "Max 20" });
    const db = getDbSafe();
    const results = {};
    for (const id of ids) {
      try {
        const scraped = await scrapeGallery(id);
        if (scraped) {
          if (db) saveIfComplete(db, scraped);
          results[id] = { success: true, media_id: scraped.media_id };
        } else {
          results[id] = { success: false, error: "Not found" };
        }
        await new Promise(r => setTimeout(r, 10000));
      } catch (error) {
        results[id] = { success: false, error: error.message };
        await new Promise(r => setTimeout(r, 30000));
      }
    }
    res.json({ success: true, data: results, stats: getCacheStats() });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get("/cache/stats", (req, res) => { res.json({ success: true, data: getCacheStats() }); });
router.post("/cache/clear", (req, res) => { clearCaches(); res.json({ success: true, message: "Cleared" }); });

// Live fetch and save endpoint
router.get("/fetch/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id < 1) return res.status(400).json({ success: false, error: "Invalid ID" });
    const scraped = await scrapeGallery(id);
    if (!scraped || !scraped.media_id) {
      return res.status(404).json({ success: false, error: "Could not fetch or incomplete data" });
    }
    const db = getDbSafe();
    if (db) saveIfComplete(db, scraped);
    res.json({ success: true, data: parseTags(addImageUrls(scraped)), meta: { saved: !!db, source: 'nhentai' } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Batch fetch and save
router.post("/fetch/batch", async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, error: "ids required" });
    if (ids.length > 20) return res.status(400).json({ success: false, error: "Max 20" });
    const db = getDbSafe();
    const results = {};
    let saved = 0;
    for (const id of ids) {
      try {
        const scraped = await scrapeGallery(id);
        if (scraped && scraped.media_id) {
          if (db) saveIfComplete(db, scraped);
          results[id] = { success: true, saved: !!db, media_id: scraped.media_id };
          saved++;
        } else { results[id] = { success: false, error: "Incomplete or not found" }; }
        await new Promise(r => setTimeout(r, 10000));
      } catch (error) {
        results[id] = { success: false, error: error.message };
        await new Promise(r => setTimeout(r, 30000));
      }
    }
    res.json({ success: true, data: results, meta: { total: ids.length, saved } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Live search dari nhentai
router.get("/live-search", async (req, res) => {
  try {
    const { q = "", limit = 20 } = req.query;
    if (!q.trim()) return res.status(400).json({ success: false, error: "Query required" });
    const { liveSearch } = await import("../lib/live-search.js");
    const results = await liveSearch(q, Math.min(50, parseInt(limit) || 20));
    res.json({ success: true, data: results.map(r => parseTags(addImageUrls(r))), meta: { query: q, count: results.length, source: 'live' } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Get by ID - dengan auto-scrape
router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id < 1) return res.status(400).json({ success: false, error: "Invalid ID" });
    const { enrich = "true", live = "true", save = "true" } = req.query;
    const db = getDbSafe();
    let row = null;

    // Coba dari database dulu
    if (db) {
      row = db.prepare("SELECT * FROM nh_data WHERE ID = ?").get(id);
    }

    if (!row && live === "true") {
      // Scrape live dari nhentai
      const scrapedData = await scrapeGallery(id);
      if (scrapedData) {
        if (db && save === "true" && scrapedData.media_id) {
          saveIfComplete(db, scrapedData);
        }
        return res.json({ success: true, data: parseTags(addImageUrls(scrapedData)), meta: { scraped: true, saved: db && save === "true" && !!scrapedData.media_id, source: 'live' } });
      }
      return res.status(404).json({ success: false, error: "Not found" });
    }

    if (!row) {
      return res.status(404).json({ success: false, error: "Not found" });
    }

    if (enrich === "true") {
      row = await enrichRow(row);
      if (db && save === "true" && row.media_id) {
        db.prepare("UPDATE nh_data SET media_id = ?, cover_path = ?, thumbnail_path = ? WHERE ID = ?").run(row.media_id, row.cover_path, row.thumbnail_path, row.ID);
      }
    }

    res.json({ success: true, data: parseTags(addImageUrls(row)), meta: { enriched: row._scraped === true, source: db ? 'database' : 'live' } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

export default router;
