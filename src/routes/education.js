const express = require('express');
const educationController = require('../controllers/educationController');
const auth = require('../middleware/auth');

const router = express.Router();

// Public - anyone can read education content
router.get('/modules', educationController.getModules);
router.get('/modules/:moduleId', educationController.getModule);
router.get('/modules/:moduleId/lessons/:lessonId', educationController.getLesson);

// Protected - mark progress
router.post('/modules/:moduleId/lessons/:lessonId/complete', auth, educationController.markComplete);

module.exports = router;
