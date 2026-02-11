const express = require('express');
const aiController = require('../controllers/aiController');
const auth = require('../middleware/auth');

const router = express.Router();

// All AI routes require authentication
router.use(auth);

router.get('/analyze/:symbol', aiController.analyzeStock);
router.get('/company-data/:symbol', aiController.getCompanyData);
router.post('/compare', aiController.compareStocks);
router.post('/chat', aiController.chat);
router.get('/sentiment', aiController.marketSentiment);
// Mobile compatibility (older clients call /ai/sentiment/:symbol)
router.get('/sentiment/:symbol', aiController.marketSentiment);
router.get('/explain/:concept', aiController.explainConcept);
router.get('/portfolio-analysis', aiController.analyzePortfolio);

module.exports = router;
