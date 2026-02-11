const router = require('express').Router();
const auth = require('../middleware/auth');
const ctrl = require('../controllers/fundamentalController');

router.get('/score/:symbol', ctrl.scoreStock);
router.post('/compare', auth, ctrl.compareStocks);

module.exports = router;
