const journalService = require('../services/journalService');

exports.createEntry = async (req, res) => {
  try {
    const result = journalService.createEntry(req.user.id, req.body);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.getEntries = async (req, res) => {
  try {
    const result = journalService.getEntries(req.user.id, req.query);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.getEntry = async (req, res) => {
  try {
    const result = journalService.getEntry(req.user.id, req.params.id);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.updateEntry = async (req, res) => {
  try {
    const result = journalService.updateEntry(req.user.id, req.params.id, req.body);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.deleteEntry = async (req, res) => {
  try {
    const result = journalService.deleteEntry(req.user.id, req.params.id);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.getAnalytics = async (req, res) => {
  try {
    const result = journalService.getAnalytics(req.user.id);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.getStrategies = async (req, res) => {
  try {
    res.json(journalService.getStrategies());
  } catch (e) { res.status(400).json({ error: e.message }); }
};
