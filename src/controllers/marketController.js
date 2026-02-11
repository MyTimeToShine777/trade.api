const marketService = require('../services/marketService');
const technicalService = require('../services/technicalService');

exports.getQuote = async (req, res) => {
  try {
    const { symbol } = req.params;
    const { exchange = 'NSE' } = req.query;
    const quote = await marketService.getQuote(symbol, exchange);
    res.json(quote);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getMultipleQuotes = async (req, res) => {
  try {
    const { symbols } = req.body; // Array of symbols
    const { exchange = 'NSE' } = req.query;
    if (!symbols || !Array.isArray(symbols)) {
      return res.status(400).json({ error: 'symbols array is required' });
    }
    const quotes = await marketService.getQuotes(symbols, exchange);
    res.json(quotes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getHistorical = async (req, res) => {
  try {
    const { symbol } = req.params;
    const { exchange = 'NSE', period = '1y', interval = '1d' } = req.query;
    const data = await marketService.getHistorical(symbol, exchange, period, interval);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getHistoricalWithIndicators = async (req, res) => {
  try {
    const { symbol } = req.params;
    const { exchange = 'NSE', period = '1y', interval = '1d' } = req.query;
    const candles = await marketService.getHistorical(symbol, exchange, period, interval);

    if (candles.length === 0) {
      return res.json({ candles: [], indicators: {} });
    }

    const indicators = technicalService.calculateIndicators(candles);
    res.json({ candles, indicators });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.search = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Query parameter q is required' });
    const results = await marketService.search(q);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getFundamentals = async (req, res) => {
  try {
    const { symbol } = req.params;
    const { exchange = 'NSE', deep = 'false' } = req.query;
    const includeScreener = deep === 'true' || deep === '1';
    const data = await marketService.getFundamentals(symbol, exchange, includeScreener);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getIndices = async (req, res) => {
  try {
    const indices = await marketService.getIndices();
    res.json(indices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getTrending = async (req, res) => {
  try {
    const { limit } = req.query;
    const trending = await marketService.getTrending(limit);
    res.json(trending);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getGainersLosers = async (req, res) => {
  try {
    const data = await marketService.getGainersLosers();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Screener - filter stocks by fundamental criteria
exports.screener = async (req, res) => {
  try {
    const {
      sector = 'nifty50',
      symbols,
      minPE, maxPE, minROE, maxDebtToEquity, minMarketCap, capCategory
    } = req.body;

    // Get symbols either from request or from sector
    let stockSymbols;
    if (symbols && Array.isArray(symbols)) {
      stockSymbols = symbols;
    } else {
      const allStocks = marketService.getAllStocks();
      stockSymbols = allStocks[sector] || allStocks.nifty50;
    }

    // Process in batches of 5 to avoid rate limiting
    const batchSize = 5;
    const fundamentals = [];
    const allSymbols = stockSymbols;
    for (let i = 0; i < allSymbols.length; i += batchSize) {
      const batch = allSymbols.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(s => marketService.getFundamentals(s).catch(() => null))
      );
      fundamentals.push(...batchResults);
      // Small delay between batches (except for last batch)
      if (i + batchSize < allSymbols.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    let filtered = fundamentals.filter(f => f !== null);

    if (minPE) filtered = filtered.filter(f => f.pe >= parseFloat(minPE));
    if (maxPE) filtered = filtered.filter(f => f.pe <= parseFloat(maxPE) && f.pe > 0);
    if (minROE) filtered = filtered.filter(f => f.roe >= parseFloat(minROE));
    if (maxDebtToEquity) filtered = filtered.filter(f => f.debtToEquity <= parseFloat(maxDebtToEquity));
    if (minMarketCap) filtered = filtered.filter(f => f.marketCap >= parseFloat(minMarketCap));
    if (capCategory) filtered = filtered.filter(f => f.capCategory === capCategory);

    res.json({
      total: filtered.length,
      stocks: filtered.sort((a, b) => b.healthScore - a.healthScore)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get sectors list
exports.getSectors = (req, res) => {
  res.json(marketService.getSectors());
};

// Get stocks by sector
exports.getStocksBySector = async (req, res) => {
  try {
    const { sector } = req.params;
    const stocks = await marketService.getStocksBySector(sector);
    res.json(stocks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get all stock symbols
exports.getAllStocks = (req, res) => {
  res.json(marketService.getAllStocks());
};
