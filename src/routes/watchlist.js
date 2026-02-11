const express = require('express');
const watchlistController = require('../controllers/watchlistController');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

router.get('/', watchlistController.getWatchlist);
router.post('/', watchlistController.addToWatchlist);
router.delete('/:symbol', watchlistController.removeFromWatchlist);

module.exports = router;
