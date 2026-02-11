const challengeService = require('../services/challengeService');

exports.createChallenge = async (req, res) => {
  try {
    const result = challengeService.createChallenge(req.user.id, req.body);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.getActiveChallenge = async (req, res) => {
  try {
    const result = challengeService.getActiveChallenge(req.user.id);
    if (!result) return res.status(404).json({ active: false, message: 'No active challenge' });
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.recordSnapshot = async (req, res) => {
  try {
    const result = challengeService.recordSnapshot(req.user.id);
    res.json(result || { message: 'No active challenge' });
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.getChallenges = async (req, res) => {
  try {
    const result = challengeService.getChallenges(req.user.id);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.cancelChallenge = async (req, res) => {
  try {
    const result = challengeService.cancelChallenge(req.user.id);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.getLeaderboard = async (req, res) => {
  try {
    const result = challengeService.getLeaderboard(parseInt(req.query.days) || 100);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
};
