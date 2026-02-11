const fundamentalService = require('../services/fundamentalService');

exports.scoreStock = async (req, res) => {
  try {
    const result = await fundamentalService.scoreStock(req.params.symbol, req.query.exchange || 'NSE');
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.compareStocks = async (req, res) => {
  try {
    const { symbols } = req.body;
    if (!symbols || symbols.length < 2) return res.status(400).json({ error: 'Provide at least 2 symbols' });
    const result = await fundamentalService.compareStocks(symbols);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};
