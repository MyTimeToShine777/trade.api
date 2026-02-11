/**
 * Blog Controller — serves blog content from Postgres for the auto-blog frontend.
 */

const db = require('../config/database');

// GET /api/blog/posts — list posts with filters
exports.listPosts = async (req, res) => {
  try {
    await db._ready;
    const { status, market, niche, search, page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    let where = [];
    let countParams = [];
    let queryParams = [];

    // Build WHERE clause — manual param indexing for Postgres placeholders
    if (status && status !== 'all') { where.push(`status = $${where.length + 1}`); countParams.push(status); queryParams.push(status); }
    if (market && market !== 'all') { where.push(`market = $${where.length + 1}`); countParams.push(market); queryParams.push(market); }
    if (niche && niche !== 'all') { where.push(`niche_id = $${where.length + 1}`); countParams.push(niche); queryParams.push(niche); }
    if (search) {
      where.push(`(title ILIKE $${where.length + 1} OR content ILIKE $${where.length + 2})`);
      countParams.push(`%${search}%`, `%${search}%`);
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const totalRow = await db.prepare(`SELECT COUNT(*) as c FROM blog_posts ${whereClause}`).get(...countParams);
    const total = Number(totalRow?.c || 0);

    // For the SELECT query, we need to re-index params because LIMIT/OFFSET add params
    const posts = await db.prepare(
      `SELECT p.*, n.name as niche_name FROM blog_posts p LEFT JOIN blog_niches n ON p.niche_id = n.id ${whereClause} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
    ).all(...queryParams, limitNum, offset);

    res.json({ posts, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) });
  } catch (err) {
    console.error('[Blog] listPosts error:', err.message);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
};

// GET /api/blog/posts/featured — featured post (most views)
exports.getFeatured = async (req, res) => {
  try {
    await db._ready;
    const post = await db.prepare("SELECT * FROM blog_posts WHERE status='published' ORDER BY views DESC, created_at DESC LIMIT 1").get();
    res.json({ post: post || null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch featured post' });
  }
};

// GET /api/blog/posts/recent — recent published posts
exports.getRecent = async (req, res) => {
  try {
    await db._ready;
    const limit = parseInt(req.query.limit || '13');
    const posts = await db.prepare("SELECT * FROM blog_posts WHERE status='published' ORDER BY created_at DESC LIMIT ?").all(limit);
    res.json({ posts });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch recent posts' });
  }
};

// GET /api/blog/posts/:slug — single post by slug
exports.getPostBySlug = async (req, res) => {
  try {
    await db._ready;
    const post = await db.prepare("SELECT * FROM blog_posts WHERE slug=? AND status='published'").get(req.params.slug);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    // Bump view count (fire-and-forget)
    db.prepare("UPDATE blog_posts SET views = views + 1 WHERE id=?").run(post.id).catch(() => {});

    // Related posts
    const related = await db.prepare(
      "SELECT id, slug, title, excerpt, image_url, image_alt, niche_id, reading_time, created_at, views FROM blog_posts WHERE niche_id=? AND id!=? AND status='published' ORDER BY created_at DESC LIMIT 4"
    ).all(post.niche_id, post.id);

    res.json({ post, related });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch post' });
  }
};

// GET /api/blog/posts/by-category/:nicheId — posts by category
exports.getPostsByCategory = async (req, res) => {
  try {
    await db._ready;
    const { nicheId } = req.params;
    const page = parseInt(req.query.page || '1');
    const limit = parseInt(req.query.limit || '20');
    const offset = (page - 1) * limit;

    const niche = await db.prepare('SELECT * FROM blog_niches WHERE id=?').get(nicheId);
    if (!niche) return res.status(404).json({ error: 'Category not found' });

    const totalRow = await db.prepare("SELECT COUNT(*) as c FROM blog_posts WHERE niche_id=? AND status='published'").get(nicheId);
    const total = Number(totalRow?.c || 0);
    const posts = await db.prepare(
      "SELECT * FROM blog_posts WHERE niche_id=? AND status='published' ORDER BY created_at DESC LIMIT ? OFFSET ?"
    ).all(nicheId, limit, offset);

    res.json({ niche, posts, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch category posts' });
  }
};

// GET /api/blog/niches — list all niches with post counts
exports.listNiches = async (req, res) => {
  try {
    await db._ready;
    const niches = await db.prepare(`
      SELECT n.*, COALESCE(c.cnt, 0) as post_count
      FROM blog_niches n
      LEFT JOIN (SELECT niche_id, COUNT(*) as cnt FROM blog_posts GROUP BY niche_id) c ON c.niche_id = n.id
      ORDER BY n.market, n.avg_cpc DESC
    `).all();
    res.json({ niches });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch niches' });
  }
};

// GET /api/blog/stats — dashboard stats
exports.getStats = async (req, res) => {
  try {
    await db._ready;
    const totalPosts = Number((await db.prepare("SELECT COUNT(*) as c FROM blog_posts").get())?.c || 0);
    const publishedPosts = Number((await db.prepare("SELECT COUNT(*) as c FROM blog_posts WHERE status='published'").get())?.c || 0);
    const draftPosts = Number((await db.prepare("SELECT COUNT(*) as c FROM blog_posts WHERE status='draft'").get())?.c || 0);
    const totalViews = Number((await db.prepare("SELECT COALESCE(SUM(views),0) as v FROM blog_posts").get())?.v || 0);

    const niches = await db.prepare(`
      SELECT n.id, n.name, n.market, n.avg_cpc, COALESCE(c.cnt, 0) as post_count, COALESCE(c.total_views, 0) as total_views
      FROM blog_niches n
      LEFT JOIN (SELECT niche_id, COUNT(*) as cnt, COALESCE(SUM(views),0) as total_views FROM blog_posts GROUP BY niche_id) c ON c.niche_id = n.id
      ORDER BY n.market, n.avg_cpc DESC
    `).all();

    const recentLogs = await db.prepare("SELECT * FROM blog_generation_log ORDER BY created_at DESC LIMIT 20").all();

    // Market breakdown
    const marketBreakdown = await db.prepare(`
      SELECT market, COUNT(*) as count, COALESCE(SUM(views),0) as views
      FROM blog_posts WHERE status='published' GROUP BY market
    `).all();

    // Estimated revenue (rough: views * avg_cpc / 1000 * 0.02 CTR)
    const avgCpc = niches.length > 0 ? niches.reduce((s, n) => s + (n.avg_cpc || 0), 0) / niches.length : 3;
    const estimatedRevenue = ((totalViews * avgCpc / 1000) * 0.02).toFixed(2);

    res.json({ totalPosts, publishedPosts, draftPosts, totalViews, nicheBreakdown: niches, marketBreakdown, estimatedRevenue, recentLogs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
};

// GET /api/blog/posts/all-slugs — for static generation / sitemap
exports.getAllSlugs = async (req, res) => {
  try {
    await db._ready;
    const posts = await db.prepare("SELECT slug FROM blog_posts WHERE status='published' ORDER BY created_at DESC LIMIT 1000").all();
    res.json({ slugs: posts.map(p => p.slug) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch slugs' });
  }
};

// ─── ADMIN ENDPOINTS ───

// POST /api/blog/admin/generate — generate a single AI post
exports.adminGenerate = async (req, res) => {
  try {
    const blogService = require('../services/blogGeneratorService');
    const nicheId = req.body?.niche || null;
    const result = await blogService.generatePost(nicheId);
    res.json({ success: true, post: result });
  } catch (err) {
    console.error('[Blog Admin] Generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// POST /api/blog/admin/generate-batch — generate multiple AI posts
exports.adminBatchGenerate = async (req, res) => {
  try {
    const blogService = require('../services/blogGeneratorService');
    const count = parseInt(req.body?.count || '3');
    const results = await blogService.batchGenerate(Math.min(count, 10));
    res.json({ success: true, posts: results, count: results.length });
  } catch (err) {
    console.error('[Blog Admin] Batch generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// POST /api/blog/admin/posts — create a manual post
exports.adminCreatePost = async (req, res) => {
  try {
    await db._ready;
    const { slug, title, excerpt, content, niche_id, tags, image_url, image_alt, status, market } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'title and content are required' });

    const finalSlug = (slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 120)) + '';
    const wordCount = (content || '').split(/\s+/).length;
    const readingTime = Math.max(3, Math.ceil(wordCount / 250));

    await db.prepare(`
      INSERT INTO blog_posts (slug, title, excerpt, content, niche_id, tags, image_url, image_alt, reading_time, meta_title, meta_description, market, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(finalSlug, title, excerpt || '', content, niche_id || 'trending', tags || '', image_url || '', image_alt || title, readingTime, title, excerpt || title, market || 'global', status || 'published');

    res.json({ success: true, slug: finalSlug });
  } catch (err) {
    console.error('[Blog Admin] Create error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/blog/admin/posts/:id — update a post
exports.adminUpdatePost = async (req, res) => {
  try {
    await db._ready;
    const { id } = req.params;
    const { title, excerpt, content, niche_id, tags, image_url, image_alt, status, market } = req.body;

    await db.prepare(`
      UPDATE blog_posts SET title=COALESCE(?,title), excerpt=COALESCE(?,excerpt), content=COALESCE(?,content), niche_id=COALESCE(?,niche_id),
      tags=COALESCE(?,tags), image_url=COALESCE(?,image_url), image_alt=COALESCE(?,image_alt), status=COALESCE(?,status), market=COALESCE(?,market),
      updated_at=NOW() WHERE id=?
    `).run(title||null, excerpt||null, content||null, niche_id||null, tags||null, image_url||null, image_alt||null, status||null, market||null, id);

    res.json({ success: true });
  } catch (err) {
    console.error('[Blog Admin] Update error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/blog/admin/posts/:id — delete a post
exports.adminDeletePost = async (req, res) => {
  try {
    await db._ready;
    await db.prepare('DELETE FROM blog_posts WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/blog/admin/posts/:id — get single post by ID (for editing)
exports.adminGetPost = async (req, res) => {
  try {
    await db._ready;
    const post = await db.prepare('SELECT * FROM blog_posts WHERE id=?').get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Not found' });
    res.json({ post });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
