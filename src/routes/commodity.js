const router = require('express').Router();
const ctrl = require('../controllers/commodityController');

router.get('/', ctrl.getAllCommodities);
router.get('/:id', ctrl.getCommodityQuote);
router.get('/:id/history', ctrl.getCommodityHistory);

module.exports = router;
