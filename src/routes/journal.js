const router = require('express').Router();
const auth = require('../middleware/auth');
const ctrl = require('../controllers/journalController');

router.post('/', auth, ctrl.createEntry);
router.get('/', auth, ctrl.getEntries);
router.get('/analytics', auth, ctrl.getAnalytics);
router.get('/strategies', auth, ctrl.getStrategies);
router.get('/:id', auth, ctrl.getEntry);
router.put('/:id', auth, ctrl.updateEntry);
router.delete('/:id', auth, ctrl.deleteEntry);

module.exports = router;
