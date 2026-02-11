const express = require('express');
const sipController = require('../controllers/sipController');
const auth = require('../middleware/auth');

const router = express.Router();

// All SIP routes require authentication
router.use(auth);

router.post('/create', sipController.createSIP);
router.get('/list', sipController.getSIPs);
router.put('/toggle/:id', sipController.toggleSIP);
router.delete('/cancel/:id', sipController.cancelSIP);
router.post('/execute/:id', sipController.executeSIP);
router.get('/transactions', sipController.getSIPTransactions);
router.get('/transactions/:id', sipController.getSIPTransactions);
router.post('/calculate', sipController.calculateSIP);

module.exports = router;
