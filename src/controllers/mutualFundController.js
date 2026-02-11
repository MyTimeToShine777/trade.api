const mutualFundService = require('../services/mutualFundService');

exports.getCategories = async (req, res) => {
  try {
    res.json(mutualFundService.getCategories());
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getFundsByCategory = async (req, res) => {
  try {
    const result = await mutualFundService.getFundsByCategory(req.params.category);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.getAllFunds = async (req, res) => {
  try {
    const result = await mutualFundService.getAllFunds();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getFundDetail = async (req, res) => {
  try {
    const result = await mutualFundService.getFundDetail(req.params.symbol);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.calculateSIP = async (req, res) => {
  try {
    const { monthlyAmount, durationMonths, years, expectedReturn } = req.body;
    const yearValue = years || (durationMonths ? durationMonths / 12 : 5);
    const result = mutualFundService.calculateSIP(monthlyAmount, yearValue, expectedReturn);
    // Return both original and frontend-expected field names
    res.json({
      ...result,
      totalValue: result.futureValue,
      estimatedReturns: result.totalGains,
      wealthGainPercent: result.totalInvested > 0 ? parseFloat((((result.futureValue - result.totalInvested) / result.totalInvested) * 100).toFixed(2)) : 0
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
};
