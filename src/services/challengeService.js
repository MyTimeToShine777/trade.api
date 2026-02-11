const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class ChallengeService {
  // Create a 100-day challenge
  async createChallenge(userId, data = {}) {
    const { startingCapital, durationDays = 100, benchmarkIndex = 'NIFTY50' } = data;

    // Check for active challenge
    const active = await db.prepare(
      `SELECT * FROM challenges WHERE user_id = ? AND status = 'ACTIVE'`
    ).get(userId);
    if (active) throw new Error('You already have an active challenge. Complete or cancel it first.');

    const user = await db.prepare('SELECT balance, initial_balance FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('User not found');

    const capital = startingCapital || user.balance;
    const id = uuidv4();
    const startDate = new Date().toISOString().split('T')[0];
    const endDate = new Date(Date.now() + durationDays * 24 * 3600 * 1000).toISOString().split('T')[0];

    await db.prepare(`
      INSERT INTO challenges (id, user_id, starting_capital, current_value, duration_days, start_date, end_date, benchmark_index, benchmark_start)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, capital, capital, durationDays, startDate, endDate, benchmarkIndex, 0);

    return {
      id, startDate, endDate, durationDays,
      startingCapital: capital,
      message: `${durationDays}-day challenge started! Trade wisely.`
    };
  }

  // Get active challenge
  async getActiveChallenge(userId) {
    const challenge = await db.prepare(
      `SELECT * FROM challenges WHERE user_id = ? AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1`
    ).get(userId);

    if (!challenge) return null;

    const snapshots = await db.prepare(
      `SELECT * FROM challenge_snapshots WHERE challenge_id = ? ORDER BY day_number ASC`
    ).all(challenge.id);

    const daysPassed = Math.floor((Date.now() - new Date(challenge.start_date).getTime()) / (24 * 3600 * 1000));
    const daysRemaining = Math.max(0, challenge.duration_days - daysPassed);
    const pnl = challenge.current_value - challenge.starting_capital;
    const pnlPercent = challenge.starting_capital > 0 ? (pnl / challenge.starting_capital * 100) : 0;

    return {
      ...challenge,
      daysPassed: Math.min(daysPassed, challenge.duration_days),
      daysRemaining,
      pnl: parseFloat(pnl.toFixed(2)),
      pnlPercent: parseFloat(pnlPercent.toFixed(2)),
      snapshots,
      isCompleted: daysPassed >= challenge.duration_days
    };
  }

  // Record daily snapshot (should be called daily via cron or manually)
  async recordSnapshot(userId) {
    const challenge = await db.prepare(
      `SELECT * FROM challenges WHERE user_id = ? AND status = 'ACTIVE'`
    ).get(userId);
    if (!challenge) return null;

    const user = await db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
    const investedResult = await db.prepare('SELECT COALESCE(SUM(invested_amount), 0) as total FROM holdings WHERE user_id = ?').get(userId);
    const currentValue = user.balance + (investedResult.total || 0);

    const dayNumber = Math.floor((Date.now() - new Date(challenge.start_date).getTime()) / (24 * 3600 * 1000)) + 1;
    const pnl = currentValue - challenge.starting_capital;
    const pnlPercent = challenge.starting_capital > 0 ? (pnl / challenge.starting_capital * 100) : 0;

    // Trades today
    const todayStats = await db.prepare(
      `SELECT COUNT(*) as trades, COALESCE(SUM(pnl), 0) as pnl FROM transactions WHERE user_id = ? AND DATE(created_at) = CURRENT_DATE`
    ).get(userId);

    try {
      await db.prepare(`DELETE FROM challenge_snapshots WHERE challenge_id = ? AND day_number = ?`).run(challenge.id, dayNumber);

      await db.prepare(`
        INSERT INTO challenge_snapshots (id, challenge_id, day_number, portfolio_value, pnl, pnl_percent, trades_today, benchmark_value)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        uuidv4(), challenge.id, dayNumber, currentValue,
        parseFloat(pnl.toFixed(2)), parseFloat(pnlPercent.toFixed(2)),
        todayStats.trades || 0, 0
      );
    } catch {}

    // Update challenge current value
    await db.prepare(`UPDATE challenges SET current_value = ? WHERE id = ?`).run(currentValue, challenge.id);

    // Check if challenge should end
    if (dayNumber >= challenge.duration_days) {
      await db.prepare(`UPDATE challenges SET status = 'COMPLETED' WHERE id = ?`).run(challenge.id);
    }

    return { dayNumber, currentValue, pnl: parseFloat(pnl.toFixed(2)), pnlPercent: parseFloat(pnlPercent.toFixed(2)) };
  }

  // Get all challenges (history)
  async getChallenges(userId) {
    return await db.prepare('SELECT * FROM challenges WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  }

  // Cancel active challenge
  async cancelChallenge(userId) {
    const result = await db.prepare(
      `UPDATE challenges SET status = 'CANCELLED' WHERE user_id = ? AND status = 'ACTIVE'`
    ).run(userId);
    if (result.changes === 0) throw new Error('No active challenge found');
    return { message: 'Challenge cancelled' };
  }

  // Get leaderboard (compare with other users)
  async getLeaderboard(challengeDays = 100) {
    const challenges = await db.prepare(`
      SELECT c.*, u.username, u.full_name, u.avatar_url
      FROM challenges c JOIN users u ON c.user_id = u.id
      WHERE c.status IN ('ACTIVE', 'COMPLETED') AND c.duration_days = ?
      ORDER BY (c.current_value - c.starting_capital) / c.starting_capital DESC
      LIMIT 20
    `).all(challengeDays);

    return challenges.map((c, i) => ({
      rank: i + 1,
      username: c.username,
      fullName: c.full_name,
      pnlPercent: c.starting_capital > 0 ? parseFloat(((c.current_value - c.starting_capital) / c.starting_capital * 100).toFixed(2)) : 0,
      status: c.status,
      daysCompleted: Math.floor((Date.now() - new Date(c.start_date).getTime()) / (24 * 3600 * 1000))
    }));
  }
}

module.exports = new ChallengeService();
