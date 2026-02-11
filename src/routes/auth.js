const express = require('express');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const authController = require('../controllers/authController');
const auth = require('../middleware/auth');

const router = express.Router();

router.post('/register', [
  body('username').isLength({ min: 3, max: 20 }).trim().escape(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('fullName').isLength({ min: 2, max: 50 }).trim()
], validate, authController.register);

router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], validate, authController.login);

router.get('/profile', auth, authController.getProfile);
router.post('/reset', auth, authController.resetAccount);

module.exports = router;
