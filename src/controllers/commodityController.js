const commodityService = require('../services/commodityService');

exports.getAllCommodities = async (req, res) => {
  try {
    const result = await commodityService.getAllCommodities();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getCommodityQuote = async (req, res) => {
  try {
    const result = await commodityService.getCommodityQuote(req.params.id);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.getCommodityHistory = async (req, res) => {
  try {
    const result = await commodityService.getCommodityHistory(req.params.id, req.query.period || '6mo');
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};
