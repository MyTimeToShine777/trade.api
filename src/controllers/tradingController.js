const tradingService = require('../services/tradingService');

exports.placeOrder = async (req, res) => {
  try {
    const result = await tradingService.placeOrder(req.user.id, req.body);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.cancelOrder = async (req, res) => {
  try {
    const result = await tradingService.cancelOrder(req.user.id, req.params.orderId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getOrders = async (req, res) => {
  try {
    const { status, limit = 50 } = req.query;
    const orders = await tradingService.getOrders(req.user.id, status, parseInt(limit));
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getHoldings = async (req, res) => {
  try {
    const holdings = await tradingService.getHoldings(req.user.id);
    res.json(holdings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getPortfolio = async (req, res) => {
  try {
    const portfolio = await tradingService.getPortfolioSummary(req.user.id);
    res.json(portfolio);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getTransactions = async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const transactions = await tradingService.getTransactions(req.user.id, parseInt(limit));
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
