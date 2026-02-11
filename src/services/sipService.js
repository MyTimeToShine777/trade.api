const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const marketService = require('./marketService');

class SIPService {
  // Create a new SIP plan
  async createSIP(userId, { symbol, exchange = 'NSE', amount, frequency = 'MONTHLY', dayOfMonth = 1 }) {
    if (amount < 100) throw new Error('Minimum SIP amount is ₹100');
    if (amount > 100000) throw new Error('Maximum SIP amount is ₹1,00,000');

    const sipId = uuidv4();
    await db.prepare(`
      INSERT INTO sip_plans (id, user_id, symbol, exchange, amount, frequency, day_of_month, status, next_execution)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
    `).run(sipId, userId, symbol.toUpperCase(), exchange, amount, frequency, dayOfMonth, this._getNextExecutionDate(dayOfMonth));

    return {
      id: sipId,
      symbol: symbol.toUpperCase(),
      amount,
      frequency,
      dayOfMonth,
      status: 'ACTIVE',
      message: `SIP created! ₹${amount} will be invested in ${symbol} ${frequency.toLowerCase()}.`
    };
  }

  // Get all SIP plans for a user
  async getSIPs(userId) {
    return await db.prepare('SELECT * FROM sip_plans WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  }

  // Pause/Resume SIP
  async toggleSIP(userId, sipId) {
    const sip = await db.prepare('SELECT * FROM sip_plans WHERE id = ? AND user_id = ?').get(sipId, userId);
    if (!sip) throw new Error('SIP plan not found');

    const newStatus = sip.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    await db.prepare('UPDATE sip_plans SET status = ? WHERE id = ?').run(newStatus, sipId);
    return { id: sipId, status: newStatus, message: `SIP ${newStatus.toLowerCase()}` };
  }

  // Cancel SIP
  async cancelSIP(userId, sipId) {
    const sip = await db.prepare('SELECT * FROM sip_plans WHERE id = ? AND user_id = ?').get(sipId, userId);
    if (!sip) throw new Error('SIP plan not found');

    await db.prepare('UPDATE sip_plans SET status = ? WHERE id = ?').run('CANCELLED', sipId);
    return { message: 'SIP cancelled successfully' };
  }

  // Execute a SIP (buy stocks)
  async executeSIP(sipId) {
    const sip = await db.prepare('SELECT * FROM sip_plans WHERE id = ? AND status = ?').get(sipId, 'ACTIVE');
    if (!sip) return null;

    const user = await db.prepare('SELECT balance FROM users WHERE id = ?').get(sip.user_id);
    if (!user || user.balance < sip.amount) {
      await db
        .prepare(`INSERT INTO sip_transactions (id, sip_id, user_id, symbol, amount, status, notes) VALUES (?, ?, ?, ?, ?, 'FAILED', 'Insufficient balance')`)
        .run(uuidv4(), sipId, sip.user_id, sip.symbol, sip.amount);
      return { status: 'FAILED', reason: 'Insufficient balance' };
    }

    try {
      const quote = await marketService.getQuote(sip.symbol, sip.exchange);
      const price = quote.price;
      const quantity = Math.floor(sip.amount / price);

      if (quantity < 1) {
        await db
          .prepare(`INSERT INTO sip_transactions (id, sip_id, user_id, symbol, amount, status, notes) VALUES (?, ?, ?, ?, ?, 'FAILED', 'Price too high for SIP amount')`)
          .run(uuidv4(), sipId, sip.user_id, sip.symbol, sip.amount);
        return { status: 'FAILED', reason: 'Stock price exceeds SIP amount' };
      }

      const totalCost = price * quantity;

      // Deduct balance
      await db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(totalCost, sip.user_id);

      // Update holdings
      const existing = await db.prepare('SELECT * FROM holdings WHERE user_id = ? AND symbol = ?').get(sip.user_id, sip.symbol);
      if (existing) {
        const newQty = existing.quantity + quantity;
        const newInvested = existing.invested_amount + totalCost;
        const newAvg = newInvested / newQty;
        await db
          .prepare('UPDATE holdings SET quantity = ?, avg_price = ?, invested_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(newQty, newAvg, newInvested, existing.id);
      } else {
        await db
          .prepare('INSERT INTO holdings (id, user_id, symbol, exchange, quantity, avg_price, invested_amount) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(uuidv4(), sip.user_id, sip.symbol, sip.exchange, quantity, price, totalCost);
      }

      // Record SIP transaction
      const txId = uuidv4();
      await db
        .prepare(`INSERT INTO sip_transactions (id, sip_id, user_id, symbol, amount, quantity, price, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'EXECUTED')`)
        .run(txId, sipId, sip.user_id, sip.symbol, totalCost, quantity, price);

      // Update total invested & next execution
      await db
        .prepare('UPDATE sip_plans SET total_invested = total_invested + ?, installments_done = installments_done + 1, next_execution = ? WHERE id = ?')
        .run(totalCost, this._getNextExecutionDate(sip.day_of_month), sipId);

      return {
        status: 'EXECUTED',
        symbol: sip.symbol,
        quantity,
        price,
        totalCost,
        message: `SIP: Bought ${quantity} shares of ${sip.symbol} at ₹${price.toFixed(2)}`
      };
    } catch (error) {
      console.error('SIP execution error:', error.message);
      return { status: 'FAILED', reason: error.message };
    }
  }

  // Get SIP transaction history
  async getSIPTransactions(userId, sipId = null) {
    if (sipId) {
      return await db
        .prepare('SELECT * FROM sip_transactions WHERE user_id = ? AND sip_id = ? ORDER BY created_at DESC')
        .all(userId, sipId);
    }
    return await db
      .prepare('SELECT * FROM sip_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(userId);
  }

  // SIP Calculator
  calculateSIP({ monthlyAmount, expectedReturn = 12, years }) {
    const monthlyRate = expectedReturn / 12 / 100;
    const months = years * 12;
    const totalInvested = monthlyAmount * months;

    // Future Value = P × [{(1 + r)^n - 1} / r] × (1 + r)
    const futureValue = monthlyAmount * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate) * (1 + monthlyRate);
    const totalReturns = futureValue - totalInvested;

    // Year-by-year breakdown
    const yearlyBreakdown = [];
    for (let y = 1; y <= years; y++) {
      const m = y * 12;
      const inv = monthlyAmount * m;
      const fv = monthlyAmount * ((Math.pow(1 + monthlyRate, m) - 1) / monthlyRate) * (1 + monthlyRate);
      yearlyBreakdown.push({
        year: y,
        invested: Math.round(inv),
        value: Math.round(fv),
        returns: Math.round(fv - inv)
      });
    }

    return {
      monthlyAmount,
      expectedReturn,
      years,
      totalInvested: Math.round(totalInvested),
      futureValue: Math.round(futureValue),
      totalReturns: Math.round(totalReturns),
      yearlyBreakdown
    };
  }

  _getNextExecutionDate(dayOfMonth) {
    const now = new Date();
    let next = new Date(now.getFullYear(), now.getMonth(), dayOfMonth);
    if (next <= now) {
      next.setMonth(next.getMonth() + 1);
    }
    return next.toISOString().split('T')[0];
  }
}

module.exports = new SIPService();
