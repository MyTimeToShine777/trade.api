const express = require('express');
const marketController = require('../controllers/marketController');
const auth = require('../middleware/auth');

const router = express.Router();

// Public routes
router.get('/indices', marketController.getIndices);
router.get('/search', marketController.search);
router.get('/trending', marketController.getTrending);
router.get('/gainers-losers', marketController.getGainersLosers);
router.get('/sectors', marketController.getSectors);
router.get('/sectors/:sector', marketController.getStocksBySector);
router.get('/all-stocks', marketController.getAllStocks);
router.get('/quote/:symbol', marketController.getQuote);
router.get('/historical/:symbol', marketController.getHistorical);
router.get('/chart/:symbol', marketController.getHistoricalWithIndicators);
router.get('/fundamentals/:symbol', marketController.getFundamentals);

// Protected routes
router.post('/quotes', auth, marketController.getMultipleQuotes);
router.post('/screener', auth, marketController.screener);

module.exports = router;
