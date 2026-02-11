const router = require('express').Router();
const ctrl = require('../controllers/mutualFundController');

router.get('/categories', ctrl.getCategories);
router.get('/categories/:category', ctrl.getFundsByCategory);
router.get('/all', ctrl.getAllFunds);
router.get('/detail/:symbol', ctrl.getFundDetail);
router.post('/calculate-sip', ctrl.calculateSIP);

module.exports = router;
