/**
 * Blog API Routes — public reads + authenticated admin endpoints.
 */

const express = require('express');
const router = express.Router();
const blogController = require('../controllers/blogController');

// ─── Simple admin auth middleware ───
function blogAdmin(req, res, next) {
  const pw = process.env.BLOG_ADMIN_PASSWORD;
  if (!pw) return res.status(500).json({ error: 'Admin not configured' });
  const supplied = req.headers['x-admin-password'] || req.body?.adminPassword;
  if (supplied !== pw) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ─── Public read endpoints ───
router.get('/posts/featured', blogController.getFeatured);
router.get('/posts/recent', blogController.getRecent);
router.get('/posts/all-slugs', blogController.getAllSlugs);
router.get('/posts/by-category/:nicheId', blogController.getPostsByCategory);
router.get('/posts/:slug', blogController.getPostBySlug);
router.get('/posts', blogController.listPosts);
router.get('/niches', blogController.listNiches);
router.get('/stats', blogController.getStats);

// ─── Admin login ───
router.post('/admin/login', (req, res) => {
  const pw = process.env.BLOG_ADMIN_PASSWORD;
  if (!pw) return res.status(500).json({ error: 'Admin not configured' });
  if (req.body?.password !== pw) return res.status(401).json({ error: 'Wrong password' });
  res.json({ success: true, message: 'Authenticated' });
});

// ─── Admin endpoints ───
router.post('/admin/generate', blogAdmin, blogController.adminGenerate);
router.post('/admin/generate-batch', blogAdmin, blogController.adminBatchGenerate);
router.post('/admin/posts', blogAdmin, blogController.adminCreatePost);
router.put('/admin/posts/:id', blogAdmin, blogController.adminUpdatePost);
router.delete('/admin/posts/:id', blogAdmin, blogController.adminDeletePost);
router.get('/admin/posts/:id', blogAdmin, blogController.adminGetPost);

module.exports = router;