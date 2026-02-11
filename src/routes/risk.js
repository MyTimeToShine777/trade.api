const router = require('express').Router();
const auth = require('../middleware/auth');
const ctrl = require('../controllers/riskController');

router.post('/evaluate', auth, ctrl.evaluateTrade);
router.get('/dashboard', auth, ctrl.getRiskDashboard);

module.exports = router;
