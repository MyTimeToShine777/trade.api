const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class JournalService {
  // Create a trade journal entry
  async createEntry(userId, entryData) {
    const {
      orderId, symbol, side, tradeType, 
      reason, strategy, emotions,
      setupQuality, setup_quality, // accept both camelCase and snake_case
      notes, outcome, pnl,
      tags // Array of tags or comma-separated string
    } = entryData;

    const quality = setupQuality || setup_quality || 3;
    const parsedTags = Array.isArray(tags) ? tags : (typeof tags === 'string' && tags.trim() ? tags.split(',').map(t => t.trim()) : []);

    const id = uuidv4();
    await db.prepare(`
      INSERT INTO trade_journal (id, user_id, order_id, symbol, side, trade_type, reason, strategy, emotions, setup_quality, notes, tags, outcome, pnl)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, userId, orderId || null, symbol, side, tradeType || 'DELIVERY',
      reason, strategy || 'OTHER', emotions || 'CALM',
      quality, notes || '', JSON.stringify(parsedTags),
      outcome || null, pnl || null
    );

    return { id, message: 'Journal entry created' };
  }

  // Get all journal entries
  async getEntries(userId, options = {}) {
    const { limit = 50, offset = 0, symbol, strategy } = options;
    let sql = 'SELECT * FROM trade_journal WHERE user_id = ?';
    const params = [userId];

    if (symbol) { sql += ' AND symbol = ?'; params.push(symbol); }
    if (strategy) { sql += ' AND strategy = ?'; params.push(strategy); }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const entries = await db.prepare(sql).all(...params);
    return entries.map(e => ({ ...e, tags: JSON.parse(e.tags || '[]') }));
  }

  // Get entry by id
  async getEntry(userId, entryId) {
    const entry = await db.prepare('SELECT * FROM trade_journal WHERE id = ? AND user_id = ?').get(entryId, userId);
    if (!entry) throw new Error('Entry not found');
    return { ...entry, tags: JSON.parse(entry.tags || '[]') };
  }

  // Update entry
  async updateEntry(userId, entryId, updates) {
    const entry = await db.prepare('SELECT * FROM trade_journal WHERE id = ? AND user_id = ?').get(entryId, userId);
    if (!entry) throw new Error('Entry not found');

    const { reason, strategy, emotions, setupQuality, notes, tags, outcome, pnl } = updates;
    await db.prepare(`
      UPDATE trade_journal SET 
        reason = COALESCE(?, reason), strategy = COALESCE(?, strategy),
        emotions = COALESCE(?, emotions), setup_quality = COALESCE(?, setup_quality),
        notes = COALESCE(?, notes), tags = COALESCE(?, tags),
        outcome = COALESCE(?, outcome), pnl = COALESCE(?, pnl),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(
      reason || null, strategy || null, emotions || null, setupQuality || null,
      notes || null, tags ? JSON.stringify(tags) : null,
      outcome || null, pnl || null,
      entryId, userId
    );

    return { message: 'Entry updated' };
  }

  // Delete entry
  async deleteEntry(userId, entryId) {
    const result = await db.prepare('DELETE FROM trade_journal WHERE id = ? AND user_id = ?').run(entryId, userId);
    if (result.changes === 0) throw new Error('Entry not found');
    return { message: 'Entry deleted' };
  }

  // Get journal analytics
  async getAnalytics(userId) {
    const totalEntries = await db.prepare('SELECT COUNT(*) as cnt FROM trade_journal WHERE user_id = ?').get(userId);

    const byStrategyRaw = await db.prepare(
      `SELECT strategy, COUNT(*) as count, 
       AVG(setup_quality) as avg_quality,
       SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) as wins,
       SUM(CASE WHEN outcome = 'LOSS' THEN 1 ELSE 0 END) as losses,
       COALESCE(SUM(pnl), 0) as total_pnl
       FROM trade_journal WHERE user_id = ? GROUP BY strategy`
    ).all(userId);

    const byEmotionRaw = await db.prepare(
      `SELECT emotions, COUNT(*) as count,
       SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) as wins,
       SUM(CASE WHEN outcome = 'LOSS' THEN 1 ELSE 0 END) as losses,
       COALESCE(SUM(pnl), 0) as total_pnl
       FROM trade_journal WHERE user_id = ? GROUP BY emotions`
    ).all(userId);

    // Compute per-strategy win rate & camelCase fields
    const byStrategy = byStrategyRaw.map(s => ({
      strategy: s.strategy,
      count: s.count,
      wins: s.wins,
      losses: s.losses,
      totalPnl: s.total_pnl,
      winRate: (s.wins + s.losses) > 0 ? (s.wins / (s.wins + s.losses)) * 100 : 0
    }));

    // Compute per-emotion win rate & camelCase fields
    const byEmotion = byEmotionRaw.map(e => ({
      emotion: e.emotions,
      emotions: e.emotions,
      count: e.count,
      wins: e.wins,
      losses: e.losses,
      totalPnl: e.total_pnl,
      winRate: (e.wins + e.losses) > 0 ? (e.wins / (e.wins + e.losses)) * 100 : 0
    }));

    // Compute overall stats
    const totalWins = byStrategy.reduce((s, x) => s + x.wins, 0);
    const totalLosses = byStrategy.reduce((s, x) => s + x.losses, 0);
    const totalPnl = byStrategy.reduce((s, x) => s + x.totalPnl, 0);
    const overallWinRate = (totalWins + totalLosses) > 0 ? (totalWins / (totalWins + totalLosses)) * 100 : 0;

    const bestStrategy = byStrategy.reduce((best, s) => {
      return s.totalPnl > (best?.totalPnl || -Infinity) ? s : best;
    }, null);

    const worstEmotion = byEmotion.reduce((worst, e) => {
      return e.totalPnl < (worst?.totalPnl || Infinity) ? e : worst;
    }, null);

    return {
      totalEntries: totalEntries.cnt,
      winRate: parseFloat(overallWinRate.toFixed(1)),
      totalPnl: parseFloat(totalPnl.toFixed(2)),
      bestStrategy: bestStrategy?.strategy || 'N/A',
      byStrategy,
      byEmotion,
      insights: {
        bestStrategy: bestStrategy?.strategy || 'N/A',
        worstEmotion: worstEmotion?.emotions || 'N/A',
        avgSetupQuality: byStrategyRaw.reduce((sum, s) => sum + (s.avg_quality || 0), 0) / (byStrategyRaw.length || 1)
      }
    };
  }

  // Strategies list
  getStrategies() {
    return [
      { id: 'TECHNICAL_BREAKOUT', name: 'Technical Breakout', icon: '📈' },
      { id: 'RSI_OVERSOLD', name: 'RSI Oversold', icon: '📉' },
      { id: 'RSI_OVERBOUGHT', name: 'RSI Overbought', icon: '📊' },
      { id: 'MOVING_AVG_CROSS', name: 'Moving Average Crossover', icon: '〰️' },
      { id: 'SUPPORT_BOUNCE', name: 'Support Bounce', icon: '⬆️' },
      { id: 'RESISTANCE_BREAK', name: 'Resistance Break', icon: '🚀' },
      { id: 'FUNDAMENTAL', name: 'Fundamental Analysis', icon: '🔍' },
      { id: 'NEWS_EVENT', name: 'News/Event Based', icon: '📰' },
      { id: 'CANDLESTICK_PATTERN', name: 'Candlestick Pattern', icon: '🕯️' },
      { id: 'VOLUME_SPIKE', name: 'Volume Spike', icon: '📶' },
      { id: 'SIP_INVESTMENT', name: 'SIP Investment', icon: '💰' },
      { id: 'OTHER', name: 'Other', icon: '❓' }
    ];
  }
}

module.exports = new JournalService();
