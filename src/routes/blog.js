/**
 * Blog API Routes — serves blog content for the auto-blog frontend.
 * No auth required — public endpoints.
 */

const express = require('express');
const router = express.Router();
const blogController = require('../controllers/blogController');

// Public read endpoints (used by auto-blog frontend)
router.get('/posts/featured', blogController.getFeatured);
router.get('/posts/recent', blogController.getRecent);
router.get('/posts/all-slugs', blogController.getAllSlugs);
router.get('/posts/by-category/:nicheId', blogController.getPostsByCategory);
router.get('/posts/:slug', blogController.getPostBySlug);
router.get('/posts', blogController.listPosts);
router.get('/niches', blogController.listNiches);
router.get('/stats', blogController.getStats);

module.exports = router;
