const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const marketService = require('../services/marketService');

exports.getWatchlist = async (req, res) => {
  try {
    const items = await db
      .prepare('SELECT * FROM watchlists WHERE user_id = ? ORDER BY added_at DESC')
      .all(req.user.id);

    // Enrich with current prices
    const enriched = await Promise.all(items.map(async (item) => {
      const quote = await marketService.getQuote(item.symbol, item.exchange);
      return { ...item, ...quote };
    }));

    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.addToWatchlist = async (req, res) => {
  try {
    const { symbol, exchange = 'NSE' } = req.body;
    if (!symbol) return res.status(400).json({ error: 'Symbol is required' });

    const existing = await db
      .prepare('SELECT id FROM watchlists WHERE user_id = ? AND symbol = ?')
      .get(req.user.id, symbol.toUpperCase());
    if (existing) return res.status(409).json({ error: 'Already in watchlist' });

    const id = uuidv4();
    await db
      .prepare('INSERT INTO watchlists (id, user_id, symbol, exchange) VALUES (?, ?, ?, ?)')
      .run(id, req.user.id, symbol.toUpperCase(), exchange);

    res.status(201).json({ id, symbol: symbol.toUpperCase(), exchange, message: 'Added to watchlist' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.removeFromWatchlist = async (req, res) => {
  try {
    const { symbol } = req.params;
    await db
      .prepare('DELETE FROM watchlists WHERE user_id = ? AND symbol = ?')
      .run(req.user.id, symbol.toUpperCase());
    res.json({ message: 'Removed from watchlist' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
