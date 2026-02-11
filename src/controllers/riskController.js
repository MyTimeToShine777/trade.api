const riskService = require('../services/riskService');

exports.evaluateTrade = async (req, res) => {
  try {
    // Map frontend field names to backend
    const tradeData = {
      ...req.body,
      target: req.body.takeProfit || req.body.target,
      tradeType: req.body.orderType || req.body.tradeType || 'DELIVERY'
    };
    const result = riskService.evaluateTrade(req.user.id, tradeData);

    // Transform response to match frontend expectations
    res.json({
      approved: result.approved,
      riskScore: result.riskScore,
      warnings: result.warnings.map(w => w.detail || w),
      blocks: result.issues.map(i => i.detail || i),
      metrics: {
        positionPercent: result.tradeMetrics?.capitalPercent || 0,
        rrRatio: result.tradeMetrics?.rrRatio || 0,
        tradeValue: result.tradeMetrics?.tradeValue || 0,
        availableBalance: result.tradeMetrics?.availableBalance || 0,
      }
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.getRiskDashboard = async (req, res) => {
  try {
    const data = riskService.getRiskDashboard(req.user.id);

    // Flatten nested structure for frontend
    const todayPnl = data.risk.todayPnL || 0;
    const portfolioValue = data.portfolio.totalValue || 0;
    const dailyLossPercent = portfolioValue > 0 ? Math.abs(Math.min(0, todayPnl)) / portfolioValue * 100 : 0;
    const avgWin = data.performance.avgWin || 0;
    const avgLoss = Math.abs(data.performance.avgLoss || 1);
    const avgRR = avgLoss > 0 ? avgWin / avgLoss : 0;

    // Generate risk warnings
    const recentWarnings = [];
    if (data.risk.maxConcentration > 20) recentWarnings.push(`High stock concentration: ${data.risk.maxConcentration.toFixed(1)}% in one holding`);
    if (dailyLossPercent > 5) recentWarnings.push(`Daily loss at ${dailyLossPercent.toFixed(1)}% — approaching 10% limit`);
    if (data.performance.winRate < 40 && data.performance.totalTrades > 5) recentWarnings.push(`Low win rate: ${data.performance.winRate.toFixed(1)}%`);
    if (data.risk.cashPercent < 20) recentWarnings.push(`Low cash reserves: only ${data.risk.cashPercent.toFixed(1)}% available`);

    res.json({
      portfolioValue: data.portfolio.totalValue,
      cashBalance: data.portfolio.cashBalance,
      investedValue: data.portfolio.investedValue,
      todayPnl: data.risk.todayPnL,
      winRate: data.performance.winRate,
      expectancy: data.performance.expectancy,
      maxDrawdown: data.portfolio.drawdown,
      dailyLossPercent: parseFloat(dailyLossPercent.toFixed(2)),
      concentrations: data.concentrations.map(c => ({ symbol: c.symbol, value: c.value, percentage: c.percent })),
      totalTrades: data.performance.totalTrades,
      winningTrades: data.performance.wins,
      losingTrades: data.performance.losses,
      avgRR: parseFloat(avgRR.toFixed(2)),
      recentWarnings,
      recentTrades: data.recentTrades
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
};
