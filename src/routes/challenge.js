const router = require('express').Router();
const auth = require('../middleware/auth');
const ctrl = require('../controllers/challengeController');

router.post('/', auth, ctrl.createChallenge);
router.get('/active', auth, ctrl.getActiveChallenge);
router.post('/snapshot', auth, ctrl.recordSnapshot);
router.get('/history', auth, ctrl.getChallenges);
router.delete('/:id', auth, ctrl.cancelChallenge);
router.get('/leaderboard', ctrl.getLeaderboard);

module.exports = router;
