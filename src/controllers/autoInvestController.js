const autoInvestService = require('../services/autoInvestService');

class AutoInvestController {
  // Create a new auto-invest plan
  async createPlan(req, res) {
    try {
      const plan = await autoInvestService.createPlan(req.user.id, req.body);
      res.json(plan);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }

  // Get current plan
  async getPlan(req, res) {
    try {
      const plan = await autoInvestService.getPlan(req.user.id);
      res.json(plan || { status: 'NONE' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }

  // Update plan
  async updatePlan(req, res) {
    try {
      const plan = await autoInvestService.updatePlan(req.user.id, req.body);
      res.json(plan);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }

  // Toggle plan (pause/resume)
  async togglePlan(req, res) {
    try {
      const result = await autoInvestService.togglePlan(req.user.id);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }

  // Cancel plan
  async cancelPlan(req, res) {
    try {
      const result = await autoInvestService.cancelPlan(req.user.id);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }

  // Run AI research — pick investments
  async runResearch(req, res) {
    try {
      const result = await autoInvestService.runResearch(req.user.id);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }

  // Execute pending picks — actually buy
  async executePicks(req, res) {
    try {
      const result = await autoInvestService.executePicks(req.user.id);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }

  // Get history
  async getHistory(req, res) {
    try {
      const history = await autoInvestService.getHistory(req.user.id);
      res.json(history);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }

  // Get latest research
  async getResearch(req, res) {
    try {
      const research = await autoInvestService.getLatestResearch(req.user.id);
      res.json(research || { status: 'NO_RESEARCH' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }

  // Get full dashboard
  async getDashboard(req, res) {
    try {
      const dashboard = await autoInvestService.getDashboard(req.user.id);
      res.json(dashboard);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
}

module.exports = new AutoInvestController();
