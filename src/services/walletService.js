const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class WalletService {
  // Get wallet summary
  async getWallet(userId) {
    const user = await db.prepare('SELECT balance, initial_balance FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('User not found');

    const totalDeposits = await db.prepare(
      `SELECT COALESCE(SUM(amount), 0) as total FROM wallet_transactions WHERE user_id = ? AND type = 'DEPOSIT'`
    ).get(userId);

    const totalWithdrawals = await db.prepare(
      `SELECT COALESCE(SUM(amount), 0) as total FROM wallet_transactions WHERE user_id = ? AND type = 'WITHDRAW'`
    ).get(userId);

    const recentTxns = await db.prepare(
      `SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
    ).all(userId);

    return {
      balance: parseFloat(user.balance.toFixed(2)),
      initialBalance: user.initial_balance,
      totalDeposits: totalDeposits.total || 0,
      totalWithdrawals: totalWithdrawals.total || 0,
      netFlow: (totalDeposits.total || 0) - (totalWithdrawals.total || 0),
      transactions: recentTxns
    };
  }

  // Add virtual money
  async deposit(userId, amount, description = 'Virtual deposit') {
    if (amount <= 0 || amount > 10000000) throw new Error('Invalid amount. Range: ₹1 to ₹1,00,00,000');

    const user = await db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('User not found');

    await db
      .prepare('UPDATE users SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(amount, userId);

    await db
      .prepare(`INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, description) VALUES (?, ?, 'DEPOSIT', ?, ?, ?)`) 
      .run(uuidv4(), userId, amount, user.balance + amount, description);

    return { balance: parseFloat((user.balance + amount).toFixed(2)), message: `₹${amount.toLocaleString()} added to wallet` };
  }

  // Withdraw virtual money
  async withdraw(userId, amount, description = 'Virtual withdrawal') {
    if (amount <= 0) throw new Error('Invalid amount');

    const user = await db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('User not found');
    if (user.balance < amount) throw new Error('Insufficient balance');

    await db
      .prepare('UPDATE users SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(amount, userId);

    await db
      .prepare(`INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, description) VALUES (?, ?, 'WITHDRAW', ?, ?, ?)`) 
      .run(uuidv4(), userId, amount, user.balance - amount, description);

    return { balance: parseFloat((user.balance - amount).toFixed(2)), message: `₹${amount.toLocaleString()} withdrawn` };
  }

  // Transfer between cash and investment
  async transfer(userId, amount, from, to, description) {
    // This is a bookkeeping transfer between conceptual "pots"
    const txnId = uuidv4();
    await db
      .prepare(`INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, description) VALUES (?, ?, 'TRANSFER', ?, ?, ?)`) 
      .run(txnId, userId, amount, 0, description || `Transfer from ${from} to ${to}`);
    return { id: txnId, message: 'Transfer recorded' };
  }

  // Get transaction history with filters
  async getTransactions(userId, options = {}) {
    const { type, limit = 50, offset = 0 } = options;
    if (type) {
      return await db.prepare(
        'SELECT * FROM wallet_transactions WHERE user_id = ? AND type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).all(userId, type, limit, offset);
    }
    return await db.prepare(
      'SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(userId, limit, offset);
  }

  // Reset wallet to initial balance
  async resetWallet(userId) {
    const config = require('../config');
    await db
      .prepare('UPDATE users SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(config.initialBalance, userId);
    await db.prepare('DELETE FROM wallet_transactions WHERE user_id = ?').run(userId);
    return { balance: config.initialBalance, message: 'Wallet reset to initial balance' };
  }
}

module.exports = new WalletService();
