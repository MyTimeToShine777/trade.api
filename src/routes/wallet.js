const router = require('express').Router();
const auth = require('../middleware/auth');
const ctrl = require('../controllers/walletController');

router.get('/', auth, ctrl.getWallet);
router.post('/deposit', auth, ctrl.deposit);
router.post('/withdraw', auth, ctrl.withdraw);
router.get('/transactions', auth, ctrl.getTransactions);
router.post('/reset', auth, ctrl.resetWallet);

module.exports = router;
