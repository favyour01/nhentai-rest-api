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
  try { db.exec("ALTER TABLE nh_data ADD COLUMN media_id TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE nh_data ADD COLUMN cover_path TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE nh_data ADD COLUMN thumbnail_path TEXT"); } catch(e) {}
}

// Save scraped data to database if complete
function saveIfComplete(db, scraped) {
  if (!scraped || !scraped.media_id) return false;

  const existing = db.prepare("SELECT ID FROM nh_data WHERE ID = ?").get(scraped.id);
  if (existing) {
    // Update existing record
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
    // Insert new record
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

router.get("/search", async (req, res) => {
  try {
    const { q = "", lang, artist, tags, category, parody, character, page = 1, limit = 20, sort = "relevance", enrich = "true", live = "true" } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;
    const db = getDb();
    ensureColumns(db);
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

    // Live search: also search from nhentai if query provided
    let liveResults = [];
    if (live === "true" && q && q.trim().length > 0) {
      try { const { liveSearch } = await import("../lib/live-search.js"); liveResults = await liveSearch(q, limitNum); } catch(e) {}
    }

    const countRow = db.prepare("SELECT COUNT(*) as total FROM nh_data "+whereClause).get(...params);
    const total = countRow.total;
    const rows = db.prepare("SELECT * FROM nh_data "+whereClause+" ORDER BY "+orderBy+" LIMIT ? OFFSET ?").all(...params, limitNum, offset);
    let resultRows = rows;
    if (enrich === "true") {
      for (let i = 0; i < resultRows.length; i++) {
        resultRows[i] = await enrichRow(resultRows[i]);
        // Save enriched data back to database
        if (resultRows[i].media_id) {
          db.prepare("UPDATE nh_data SET media_id = ?, cover_path = ?, thumbnail_path = ? WHERE ID = ?").run(resultRows[i].media_id, resultRows[i].cover_path, resultRows[i].thumbnail_path, resultRows[i].ID);
        }
      }
    }

    // Combine and deduplicate
    const seenIds = new Set(resultRows.map(r => r.ID));
    for (const lr of liveResults) {
      if (!seenIds.has(lr.ID)) {
        resultRows.push(lr);
        seenIds.add(lr.ID);
      }
    }

    const data = resultRows.map(row => parseTags(addImageUrls(row)));
    res.json({ success: true, data: data, pagination: { page: pageNum, limit: limitNum, total: total + liveResults.length, total_pages: Math.ceil((total + liveResults.length) / limitNum), has_next: pageNum * limitNum < (total + liveResults.length), has_prev: pageNum > 1 }, meta: { enriched: enrich === "true", live: live === "true", live_results: liveResults.length } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
router.get("/random", async (req, res) => {
  try {
    const { enrich = "true", live = "true" } = req.query;
    const db = getDb();
    ensureColumns(db);

    // Try database first
    let row = db.prepare("SELECT * FROM nh_data WHERE media_id IS NOT NULL AND media_id != '0' ORDER BY RANDOM() LIMIT 1").get();

    // If no complete record found, try live scrape
    if (!row && live === "true") {
      try {
        const { getRandomLive } = await import("../lib/live-search.js");
        const liveRow = await getRandomLive();
        if (liveRow && liveRow.media_id) {
          saveIfComplete(db, liveRow);
          return res.json({ success: true, data: parseTags(addImageUrls(liveRow)), meta: { enriched: true, live: true } });
        }
      } catch(e) {}
    }

    if (!row) {
      // Fallback: get any record
      row = db.prepare("SELECT * FROM nh_data ORDER BY RANDOM() LIMIT 1").get();
    }

    if (enrich === "true") { row = await enrichRow(row); }
    res.json({ success: true, data: parseTags(addImageUrls(row)), meta: { enriched: enrich === "true", live: false } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get("/tags", (req, res) => {
  try {
    const { q = "", limit = 50, page = 1 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;
    const db = getDb();
    const rows = db.prepare("SELECT TAGS FROM nh_data WHERE TAGS IS NOT NULL AND TAGS != ''").all();
    const tagMap = new Map();
    for (const row of rows) { for (const tag of row.TAGS.split(',').map(t => t.trim()).filter(Boolean)) { tagMap.set(tag, (tagMap.get(tag) || 0) + 1); } }
    let tagArray = Array.from(tagMap.entries()).map(([name, count]) => ({ name, count }));
    if (q) { tagArray = tagArray.filter(t => t.name.toLowerCase().includes(q.toLowerCase())); }
    tagArray.sort((a, b) => b.count - a.count);
    res.json({ success: true, data: tagArray.slice(offset, offset + limitNum), pagination: { page: pageNum, limit: limitNum, total: tagArray.length, total_pages: Math.ceil(tagArray.length / limitNum) } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get("/artists", (req, res) => {
  try {
    const { q = "", limit = 50, page = 1 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;
    const db = getDb();
    const rows = db.prepare("SELECT ARTIST FROM nh_data WHERE ARTIST IS NOT NULL AND ARTIST != ''").all();
    const artistMap = new Map();
    for (const row of rows) { artistMap.set(row.ARTIST, (artistMap.get(row.ARTIST) || 0) + 1); }
    let artistArray = Array.from(artistMap.entries()).map(([name, count]) => ({ name, count }));
    if (q) { artistArray = artistArray.filter(a => a.name.toLowerCase().includes(q.toLowerCase())); }
    artistArray.sort((a, b) => b.count - a.count);
    res.json({ success: true, data: artistArray.slice(offset, offset + limitNum), pagination: { page: pageNum, limit: limitNum, total: artistArray.length, total_pages: Math.ceil(artistArray.length / limitNum) } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
router.get("/stats", (req, res) => {
  try {
    const db = getDb();
    ensureColumns(db);
    const total = db.prepare("SELECT COUNT(*) as count FROM nh_data").get().count;
    const languages = db.prepare("SELECT LANGUAGE, COUNT(*) as count FROM nh_data GROUP BY LANGUAGE ORDER BY count DESC").all();
    const categories = db.prepare("SELECT CATEGORY, COUNT(*) as count FROM nh_data WHERE CATEGORY IS NOT NULL AND CATEGORY != '' GROUP BY CATEGORY ORDER BY count DESC").all();
    const dateRange = db.prepare("SELECT MIN(UPLOAD_DATE) as min_date, MAX(UPLOAD_DATE) as max_date FROM nh_data").get();
    const incomplete = db.prepare("SELECT COUNT(*) as count FROM nh_data WHERE JP_TITLE IS NULL OR TRIM(JP_TITLE)='' OR ARTIST IS NULL OR TRIM(ARTIST)='' OR TAGS IS NULL OR TRIM(TAGS)=''").get();
    let withMediaId = { count: 0 };
    try { withMediaId = db.prepare("SELECT COUNT(*) as count FROM nh_data WHERE media_id IS NOT NULL AND media_id != '0'").get(); } catch(e) {}
    res.json({ success: true, data: { total_doujins: total, incomplete_records: incomplete.count, with_media_id: withMediaId.count, thumbnail_coverage: ((withMediaId.count / total) * 100).toFixed(2) + "%", languages: languages.slice(0, 20), categories, date_range: { earliest: dateRange.min_date ? new Date(dateRange.min_date * 1000).toISOString() : null, latest: dateRange.max_date ? new Date(dateRange.max_date * 1000).toISOString() : null }, scraper_cache: getCacheStats() } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get("/scrape/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id < 1) return res.status(400).json({ success: false, error: "Invalid ID" });
    const db = getDb();
    ensureColumns(db);
    const existingRow = db.prepare("SELECT * FROM nh_data WHERE ID = ?").get(id);
    if (!existingRow) return res.status(404).json({ success: false, error: "Not found" });
    const scraped = await scrapeGallery(id);
    if (!scraped) return res.status(404).json({ success: false, error: "Could not fetch" });
    res.json({ success: true, data: { existing: parseTags(addImageUrls(existingRow)), scraped: scraped } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post("/scrape/batch", async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, error: "ids required" });
    if (ids.length > 50) return res.status(400).json({ success: false, error: "Max 50" });
    const results = {};
    for (const id of ids) {
      try { const scraped = await scrapeGallery(id); results[id] = scraped || { error: "Not found" }; } 
      catch (error) { results[id] = { error: error.message }; }
    }
    res.json({ success: true, data: results, stats: getCacheStats() });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get("/cache/stats", (req, res) => { res.json({ success: true, data: getCacheStats() }); });
router.post("/cache/clear", (req, res) => { clearCaches(); res.json({ success: true, message: "Cleared" }); });

// Live fetch and save endpoint - fetches from nhentai and saves if complete
router.get("/fetch/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id < 1) return res.status(400).json({ success: false, error: "Invalid ID" });
    const db = getDb();
    ensureColumns(db);

    // Try to scrape from nhentai
    const scraped = await scrapeGallery(id);
    if (!scraped || !scraped.media_id) {
      return res.status(404).json({ success: false, error: "Could not fetch or incomplete data" });
    }

    // Save to database
    saveIfComplete(db, scraped);

    res.json({
      success: true,
      data: parseTags(addImageUrls(scraped)),
      meta: { saved: true, source: 'nhentai' }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Batch fetch and save
router.post("/fetch/batch", async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, error: "ids required" });
    if (ids.length > 20) return res.status(400).json({ success: false, error: "Max 20" });

    const db = getDb();
    ensureColumns(db);
    const results = {};
    let saved = 0;

    for (const id of ids) {
      try {
        const scraped = await scrapeGallery(id);
        if (scraped && scraped.media_id) {
          saveIfComplete(db, scraped);
          results[id] = { success: true, saved: true, media_id: scraped.media_id };
          saved++;
        } else {
          results[id] = { success: false, error: "Incomplete or not found" };
        }
        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 10000));
      } catch (error) {
        results[id] = { success: false, error: error.message };
        // Wait longer on error
        await new Promise(r => setTimeout(r, 30000));
      }
    }

    res.json({ success: true, data: results, meta: { total: ids.length, saved } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Live search from nhentai
router.get("/live-search", async (req, res) => {
  try {
    const { q = "", limit = 20 } = req.query;
    if (!q.trim()) return res.status(400).json({ success: false, error: "Query required" });

    const { liveSearch } = await import("../lib/live-search.js");
    const results = await liveSearch(q, Math.min(50, parseInt(limit) || 20));

    res.json({
      success: true,
      data: results.map(r => parseTags(addImageUrls(r))),
      meta: { query: q, count: results.length, source: 'live' }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Database maintenance - delete incomplete records
router.post("/admin/clean", async (req, res) => {
  try {
    const db = getDb();
    ensureColumns(db);

    const before = db.prepare("SELECT COUNT(*) as c FROM nh_data").get().c;

    // Delete records without media_id
    const deleted = db.prepare("DELETE FROM nh_data WHERE media_id IS NULL OR media_id = '0'").run();

    const after = db.prepare("SELECT COUNT(*) as c FROM nh_data").get().c;

    res.json({
      success: true,
      data: {
        before,
        after,
        deleted: deleted.changes,
        message: `Deleted ${deleted.changes} incomplete records. ${after} complete records remaining.`
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Auto-fetch: continuously fetch and save complete data
router.post("/admin/auto-fetch", async (req, res) => {
  try {
    const { start_id = 1, count = 10 } = req.body;
    const db = getDb();
    ensureColumns(db);

    let fetched = 0;
    let saved = 0;
    let errors = 0;
    const results = [];

    for (let id = parseInt(start_id); id < parseInt(start_id) + parseInt(count); id++) {
      fetched++;
      try {
        const scraped = await scrapeGallery(id);
        if (scraped && scraped.media_id) {
          saveIfComplete(db, scraped);
          saved++;
          results.push({ id, status: 'saved', media_id: scraped.media_id });
        } else {
          results.push({ id, status: 'incomplete' });
        }
      } catch (e) {
        errors++;
        results.push({ id, status: 'error', error: e.message });
      }
      // Delay between requests
      await new Promise(r => setTimeout(r, 10000));
    }

    const total = db.prepare("SELECT COUNT(*) as c FROM nh_data").get().c;

    res.json({
      success: true,
      data: {
        fetched,
        saved,
        errors,
        total_in_db: total,
        results
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id < 1) return res.status(400).json({ success: false, error: "Invalid ID" });
    const { enrich = "true", live = "true", save = "true" } = req.query;
    const db = getDb();
    ensureColumns(db);
    let row = db.prepare("SELECT * FROM nh_data WHERE ID = ?").get(id);
    let scraped = false;

    if (!row && live === "true") {
      // Not in database - scrape live from nhentai
      const scrapedData = await scrapeGallery(id);
      if (scrapedData) {
        scraped = true;
        // Save to database if complete and save=true
        if (save === "true" && scrapedData.media_id) {
          saveIfComplete(db, scrapedData);
        }
        return res.json({ success: true, data: parseTags(addImageUrls(scrapedData)), meta: { scraped: true, saved: save === "true" && !!scrapedData.media_id, live: true } });
      }
      return res.status(404).json({ success: false, error: "Not found on nhentai" });
    }

    if (!row) {
      return res.status(404).json({ success: false, error: "Not found" });
    }

    if (enrich === "true") {
      row = await enrichRow(row);
      // Save enriched data
      if (save === "true" && row.media_id) {
        db.prepare("UPDATE nh_data SET media_id = ?, cover_path = ?, thumbnail_path = ? WHERE ID = ?").run(row.media_id, row.cover_path, row.thumbnail_path, row.ID);
      }
    }

    const response = parseTags(addImageUrls(row));
    res.json({ success: true, data: response, meta: { enriched: row._scraped === true, scraped: row._scraped === true, live: false } });
  } catch (err) { res.status(500).json({ success: false, error: err.message });
  }
});

export default router;