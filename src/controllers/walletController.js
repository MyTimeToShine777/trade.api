const walletService = require('../services/walletService');

exports.getWallet = async (req, res) => {
  try {
    const result = await walletService.getWallet(req.user.id);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.deposit = async (req, res) => {
  try {
    const { amount, description } = req.body;
    const result = await walletService.deposit(req.user.id, parseFloat(amount), description);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.withdraw = async (req, res) => {
  try {
    const { amount, description } = req.body;
    const result = await walletService.withdraw(req.user.id, parseFloat(amount), description);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.getTransactions = async (req, res) => {
  try {
    const result = await walletService.getTransactions(req.user.id, req.query);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.resetWallet = async (req, res) => {
  try {
    const result = await walletService.resetWallet(req.user.id);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};
