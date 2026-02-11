const express = require('express');
const autoInvestController = require('../controllers/autoInvestController');
const auth = require('../middleware/auth');

const router = express.Router();

// All auto-invest routes require authentication
router.use(auth);

// Plan management
router.post('/plan', autoInvestController.createPlan);
router.get('/plan', autoInvestController.getPlan);
router.put('/plan', autoInvestController.updatePlan);
router.put('/plan/toggle', autoInvestController.togglePlan);
router.delete('/plan', autoInvestController.cancelPlan);

// AI Research & execution
router.post('/research', autoInvestController.runResearch);
router.post('/execute', autoInvestController.executePicks);

// Data
router.get('/history', autoInvestController.getHistory);
router.get('/research', autoInvestController.getResearch);
router.get('/dashboard', autoInvestController.getDashboard);

module.exports = router;
