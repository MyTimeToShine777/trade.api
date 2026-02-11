const aiService = require('../services/aiService');
const tradingService = require('../services/tradingService');
const screenerService = require('../services/screenerService');

exports.analyzeStock = async (req, res) => {
  try {
    const { symbol } = req.params;
    const analysis = await aiService.analyzeStock(symbol);
    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get raw scraped data from Screener.in + MoneyControl (no AI)
exports.getCompanyData = async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await screenerService.getFullAnalysisData(symbol);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.compareStocks = async (req, res) => {
  try {
    let { symbol1, symbol2, symbols } = req.body || {};
    if ((!symbol1 || !symbol2) && Array.isArray(symbols) && symbols.length >= 2) {
      symbol1 = symbols[0];
      symbol2 = symbols[1];
    }
    if (!symbol1 || !symbol2) return res.status(400).json({ error: 'Two symbols required' });
    const comparison = await aiService.compareStocks(String(symbol1), String(symbol2));
    res.json(comparison);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.chat = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    let context = {};
    try {
      const portfolio = await tradingService.getPortfolioSummary(req.user.id);
      context.portfolio = portfolio;
    } catch (e) {}

    const response = await aiService.chat(message, context);
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.marketSentiment = async (req, res) => {
  try {
    const sentiment = await aiService.getMarketSentiment();
    res.json(sentiment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.explainConcept = async (req, res) => {
  try {
    const { concept } = req.params;
    const explanation = await aiService.explainConcept(decodeURIComponent(concept));
    res.json(explanation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.analyzePortfolio = async (req, res) => {
  try {
    const holdings = await tradingService.getHoldings(req.user.id);
    const user = await require('../config/database').prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id);
    const analysis = await aiService.analyzePortfolio(holdings, user?.balance || 0);
    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
