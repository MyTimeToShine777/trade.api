const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class RiskManagementService {
  // Evaluate trade before execution
  async evaluateTrade(userId, tradeData) {
    const { symbol, side, quantity, price, stopLoss, target, tradeType } = tradeData;
    const user = await db.prepare('SELECT balance, initial_balance FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('User not found');

    const issues = [];
    const warnings = [];
    const tradeValue = price * quantity;
    const investedValue = await this._getInvestedValue(userId);
    const capitalPercent = (tradeValue / (user.balance + investedValue)) * 100;

    // 1. Position sizing check (max 20% in one stock)
    if (side === 'BUY' && capitalPercent > 20) {
      issues.push({
        rule: 'Position Sizing',
        detail: `Trade uses ${capitalPercent.toFixed(1)}% of portfolio. Maximum recommended: 20%`,
        severity: 'high'
      });
    }

    // 2. Balance check
    if (side === 'BUY' && tradeValue > user.balance) {
      issues.push({ rule: 'Insufficient Balance', detail: `Need ₹${tradeValue.toFixed(0)} but have ₹${user.balance.toFixed(0)}`, severity: 'critical' });
    }

    // 3. Risk:Reward ratio check
    if (stopLoss && target && price) {
      const risk = side === 'BUY' ? price - stopLoss : stopLoss - price;
      const reward = side === 'BUY' ? target - price : price - target;
      const rrRatio = risk > 0 ? reward / risk : 0;

      if (rrRatio < 1.5) {
        issues.push({
          rule: 'Risk:Reward Ratio',
          detail: `R:R is 1:${rrRatio.toFixed(2)}. Minimum recommended: 1:1.5`,
          severity: 'high'
        });
      }
      if (rrRatio < 2) {
        warnings.push({ rule: 'Suboptimal R:R', detail: `Consider 1:2+ ratio for better edge` });
      }
    }

    // 4. No stop-loss warning
    if (!stopLoss && tradeType === 'INTRADAY') {
      issues.push({ rule: 'Missing Stop-Loss', detail: 'Intraday trades MUST have a stop-loss', severity: 'high' });
    }
    if (!stopLoss && tradeType === 'DELIVERY') {
      warnings.push({ rule: 'No Stop-Loss', detail: 'Consider adding a stop-loss to limit downside' });
    }

    // 5. Daily loss limit check (10% of capital)
    const todayLoss = await this._getTodayPnL(userId);
    const maxDailyLoss = user.initial_balance * 0.10;
    if (todayLoss < -maxDailyLoss) {
      issues.push({
        rule: 'Daily Loss Limit',
        detail: `Today's loss: ₹${Math.abs(todayLoss).toFixed(0)}. Limit: ₹${maxDailyLoss.toFixed(0)} (10% of initial capital)`,
        severity: 'critical'
      });
    }

    // 6. Concentration check
    const existingHolding = await db
      .prepare('SELECT quantity, avg_price FROM holdings WHERE user_id = ? AND symbol = ?')
      .get(userId, symbol);
    if (existingHolding && side === 'BUY') {
      const existingValue = existingHolding.quantity * existingHolding.avg_price;
      const newTotalValue = existingValue + tradeValue;
      const totalPortfolio = user.balance + this._getInvestedValue(userId);
      const concentration = (newTotalValue / totalPortfolio) * 100;
      if (concentration > 25) {
        warnings.push({ rule: 'High Concentration', detail: `${symbol} would be ${concentration.toFixed(1)}% of portfolio after this trade` });
      }
    }

    // 7. Overtrading detection  
    const todayOrders = await db.prepare(
      `SELECT COUNT(*) as cnt FROM orders WHERE user_id = ? AND DATE(created_at) = CURRENT_DATE`
    ).get(userId);
    if (todayOrders.cnt > 15) {
      warnings.push({ rule: 'Possible Overtrading', detail: `${todayOrders.cnt} orders placed today. Consider being more selective.` });
    }

    const approved = issues.filter(i => i.severity === 'critical').length === 0;
    const riskScore = Math.max(0, 100 - (issues.length * 20) - (warnings.length * 5));

    return {
      approved,
      riskScore,
      issues,
      warnings,
      tradeMetrics: {
        tradeValue,
        capitalPercent: parseFloat(capitalPercent.toFixed(2)),
        availableBalance: user.balance,
        todayPnL: todayLoss
      }
    };
  }

  async _getInvestedValue(userId) {
    const result = await db
      .prepare('SELECT COALESCE(SUM(invested_amount), 0) as total FROM holdings WHERE user_id = ?')
      .get(userId);
    return result.total || 0;
  }

  async _getTodayPnL(userId) {
    const result = await db.prepare(
      `SELECT COALESCE(SUM(pnl), 0) as pnl FROM transactions WHERE user_id = ? AND DATE(created_at) = CURRENT_DATE`
    ).get(userId);
    return result.pnl || 0;
  }

  // Get risk dashboard data
  async getRiskDashboard(userId) {
    const user = await db.prepare('SELECT balance, initial_balance FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('User not found');

    const investedValue = await this._getInvestedValue(userId);
    const totalPortfolio = user.balance + investedValue;
    const todayPnL = await this._getTodayPnL(userId);

    // Holdings concentration
    const holdings = await db
      .prepare('SELECT symbol, quantity, avg_price, invested_amount FROM holdings WHERE user_id = ?')
      .all(userId);
    const concentrations = holdings.map(h => ({
      symbol: h.symbol,
      value: h.invested_amount,
      percent: totalPortfolio > 0 ? (h.invested_amount / totalPortfolio) * 100 : 0
    })).sort((a, b) => b.percent - a.percent);

    // Trade frequency (last 7 days)
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentTrades = await db.prepare(
      `SELECT DATE(created_at) as date, COUNT(*) as count, SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins, SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losses
       FROM transactions WHERE user_id = ? AND created_at > ? GROUP BY DATE(created_at)`
    ).all(userId, since);

    // Win rate
    const allTrades = await db.prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins, SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losses,
       AVG(CASE WHEN pnl > 0 THEN pnl ELSE NULL END) as avg_win, AVG(CASE WHEN pnl < 0 THEN pnl ELSE NULL END) as avg_loss
       FROM transactions WHERE user_id = ? AND side = 'SELL'`
    ).get(userId);

    const winRate = allTrades.total > 0 ? (allTrades.wins / allTrades.total * 100) : 0;
    const avgWin = allTrades.avg_win || 0;
    const avgLoss = allTrades.avg_loss || 0;
    const expectancy = avgWin > 0 && avgLoss !== 0 ? (winRate / 100 * avgWin + (1 - winRate / 100) * avgLoss) : 0;

    // Drawdown
    const drawdown = user.initial_balance > 0 ? ((totalPortfolio - user.initial_balance) / user.initial_balance) * 100 : 0;
    const maxRisk = Math.max(...(concentrations.map(c => c.percent) || [0]));

    return {
      portfolio: {
        totalValue: parseFloat(totalPortfolio.toFixed(2)),
        cashBalance: parseFloat(user.balance.toFixed(2)),
        investedValue: parseFloat(investedValue.toFixed(2)),
        initialBalance: user.initial_balance,
        drawdown: parseFloat(drawdown.toFixed(2))
      },
      risk: {
        maxConcentration: parseFloat(maxRisk.toFixed(2)),
        todayPnL: parseFloat(todayPnL.toFixed(2)),
        diversificationScore: Math.min(100, holdings.length * 10),
        cashPercent: totalPortfolio > 0 ? parseFloat((user.balance / totalPortfolio * 100).toFixed(2)) : 100
      },
      performance: {
        totalTrades: allTrades.total || 0,
        wins: allTrades.wins || 0,
        losses: allTrades.losses || 0,
        winRate: parseFloat(winRate.toFixed(2)),
        avgWin: parseFloat(avgWin.toFixed(2)),
        avgLoss: parseFloat(avgLoss.toFixed(2)),
        expectancy: parseFloat(expectancy.toFixed(2))
      },
      concentrations,
      recentTrades
    };
  }
}

module.exports = new RiskManagementService();
