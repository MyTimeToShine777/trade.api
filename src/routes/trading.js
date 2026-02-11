const express = require('express');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const tradingController = require('../controllers/tradingController');
const auth = require('../middleware/auth');

const router = express.Router();

// All routes require auth
router.use(auth);

router.post('/order', [
  body('symbol').notEmpty().trim(),
  body('orderType').isIn(['MARKET', 'LIMIT', 'STOP_LOSS', 'STOP_LOSS_LIMIT']),
  body('side').isIn(['BUY', 'SELL']),
  body('quantity').isInt({ min: 1 })
], validate, tradingController.placeOrder);

router.delete('/order/:orderId', tradingController.cancelOrder);
router.get('/orders', tradingController.getOrders);
router.get('/holdings', tradingController.getHoldings);
router.get('/portfolio', tradingController.getPortfolio);
router.get('/transactions', tradingController.getTransactions);

module.exports = router;
