const sipService = require('../services/sipService');

exports.createSIP = (req, res) => {
  try {
    const result = sipService.createSIP(req.user.id, req.body);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getSIPs = (req, res) => {
  try {
    const sips = sipService.getSIPs(req.user.id);
    res.json(sips);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.toggleSIP = (req, res) => {
  try {
    const result = sipService.toggleSIP(req.user.id, req.params.id);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.cancelSIP = (req, res) => {
  try {
    const result = sipService.cancelSIP(req.user.id, req.params.id);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.executeSIP = async (req, res) => {
  try {
    const result = await sipService.executeSIP(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getSIPTransactions = (req, res) => {
  try {
    const txns = sipService.getSIPTransactions(req.user.id, req.params.id);
    res.json(txns);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.calculateSIP = (req, res) => {
  try {
    const { monthlyAmount, expectedReturn, years, durationMonths } = req.body;
    const yrs = years || (durationMonths ? Math.ceil(durationMonths / 12) : null);
    if (!monthlyAmount || !yrs) return res.status(400).json({ error: 'monthlyAmount and years (or durationMonths) required' });
    const result = sipService.calculateSIP({
      monthlyAmount: parseFloat(monthlyAmount),
      expectedReturn: parseFloat(expectedReturn || 12),
      years: parseInt(yrs)
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
