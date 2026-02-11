const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const config = require('../config');

const generateToken = (userId) => {
  return jwt.sign({ userId }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
};

exports.register = async (req, res) => {
  try {
    const { username, email, password, fullName } = req.body;

    // Check existing
    const existing = await db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
    if (existing) {
      return res.status(409).json({ error: 'Username or email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    await db
      .prepare('INSERT INTO users (id, username, email, password, full_name, balance, initial_balance) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(userId, username, email, hashedPassword, fullName, config.initialBalance, config.initialBalance);

    const token = generateToken(userId);

    res.status(201).json({
      message: 'Registration successful',
      user: {
        id: userId,
        username,
        email,
        fullName,
        balance: config.initialBalance,
        initialBalance: config.initialBalance
      },
      token
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken(user.id);

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.full_name,
        balance: user.balance,
        initialBalance: user.initial_balance,
        avatarUrl: user.avatar_url,
        createdAt: user.created_at
      },
      token
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getProfile = (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      fullName: req.user.full_name,
      balance: req.user.balance,
      initialBalance: req.user.initial_balance,
      avatarUrl: req.user.avatar_url,
      createdAt: req.user.created_at
    }
  });
};

exports.resetAccount = async (req, res) => {
  try {
    const userId = req.user.id;

    // Reset balance
    await db
      .prepare('UPDATE users SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(config.initialBalance, userId);

    // Clear all trading data
    await db.prepare('DELETE FROM holdings WHERE user_id = ?').run(userId);
    await db.prepare('DELETE FROM orders WHERE user_id = ?').run(userId);
    await db.prepare('DELETE FROM transactions WHERE user_id = ?').run(userId);
    await db.prepare('DELETE FROM portfolio_snapshots WHERE user_id = ?').run(userId);

    res.json({ message: 'Account reset successfully. Balance restored to ₹' + config.initialBalance.toLocaleString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
