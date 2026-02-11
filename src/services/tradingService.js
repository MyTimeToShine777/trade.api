const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const marketService = require('./marketService');

class TradingService {
  // Place a new order
  async placeOrder(userId, orderData) {
    const { symbol, exchange = 'NSE', orderType, side, quantity, price, triggerPrice, tradeType = 'DELIVERY', stopLoss, target } = orderData;

    // Get current market price
    const quote = await marketService.getQuote(symbol, exchange);
    const marketPrice = quote.price;

    if (!marketPrice || marketPrice <= 0) {
      throw new Error('Unable to fetch market price. Please try again.');
    }

    const user = await db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('User not found');

    const orderId = uuidv4();
    let executionPrice = null;
    let status = 'PENDING';

    // For market orders, execute immediately
    if (orderType === 'MARKET') {
      executionPrice = marketPrice;
      status = 'EXECUTED';

      if (side === 'BUY') {
        const totalCost = marketPrice * quantity;
        if (user.balance < totalCost) {
          throw new Error(`Insufficient balance. Required: ₹${totalCost.toFixed(2)}, Available: ₹${user.balance.toFixed(2)}`);
        }
        await this._executeBuy(userId, symbol, exchange, quantity, marketPrice, orderId, tradeType);
      } else {
        await this._executeSell(userId, symbol, exchange, quantity, marketPrice, orderId, tradeType);
      }
    }

    // For limit orders, check if can be filled immediately
    if (orderType === 'LIMIT' && price) {
      if (side === 'BUY' && marketPrice <= price) {
        executionPrice = marketPrice;
        status = 'EXECUTED';
        const totalCost = marketPrice * quantity;
        if (user.balance < totalCost) {
          throw new Error(`Insufficient balance. Required: ₹${totalCost.toFixed(2)}`);
        }
        await this._executeBuy(userId, symbol, exchange, quantity, marketPrice, orderId, tradeType);
      } else if (side === 'SELL' && marketPrice >= price) {
        executionPrice = marketPrice;
        status = 'EXECUTED';
        await this._executeSell(userId, symbol, exchange, quantity, marketPrice, orderId, tradeType);
      }
    }

    // Insert order
    await db.prepare(`
      INSERT INTO orders (id, user_id, symbol, exchange, order_type, side, quantity, price, trigger_price, status, filled_quantity, filled_price, trade_type, stop_loss, target, executed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      orderId, userId, symbol.toUpperCase(), exchange, orderType, side, quantity,
      price || null, triggerPrice || null, status,
      status === 'EXECUTED' ? quantity : 0, executionPrice,
      tradeType, stopLoss || null, target || null,
      status === 'EXECUTED' ? new Date().toISOString() : null
    );

    return {
      id: orderId,
      symbol,
      side,
      quantity,
      orderType,
      price: executionPrice || price,
      status,
      tradeType,
      marketPrice,
      message: status === 'EXECUTED'
        ? `${side} order executed at ₹${executionPrice.toFixed(2)}`
        : `${side} order placed. Waiting for execution.`
    };
  }

  async _executeBuy(userId, symbol, exchange, quantity, price, orderId, tradeType) {
    const totalCost = price * quantity;

    // Deduct balance
    await db
      .prepare('UPDATE users SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(totalCost, userId);

    // Update or create holding (only for delivery)
    if (tradeType === 'DELIVERY') {
      const existing = await db
        .prepare('SELECT * FROM holdings WHERE user_id = ? AND symbol = ?')
        .get(userId, symbol.toUpperCase());

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
          .run(uuidv4(), userId, symbol.toUpperCase(), exchange, quantity, price, totalCost);
      }
    }

    // Record transaction
    await db
      .prepare('INSERT INTO transactions (id, user_id, order_id, symbol, side, quantity, price, total_amount, trade_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uuidv4(), userId, orderId, symbol.toUpperCase(), 'BUY', quantity, price, totalCost, tradeType);
  }

  async _executeSell(userId, symbol, exchange, quantity, price, orderId, tradeType) {
    const holding = await db
      .prepare('SELECT * FROM holdings WHERE user_id = ? AND symbol = ?')
      .get(userId, symbol.toUpperCase());

    if (!holding || holding.quantity < quantity) {
      throw new Error(`Insufficient holdings. Available: ${holding ? holding.quantity : 0} shares of ${symbol}`);
    }

    const totalRevenue = price * quantity;
    const costBasis = holding.avg_price * quantity;
    const pnl = totalRevenue - costBasis;

    // Add balance
    await db
      .prepare('UPDATE users SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(totalRevenue, userId);

    // Update holding
    const newQty = holding.quantity - quantity;
    if (newQty === 0) {
      await db.prepare('DELETE FROM holdings WHERE id = ?').run(holding.id);
    } else {
      const newInvested = holding.avg_price * newQty;
      await db
        .prepare('UPDATE holdings SET quantity = ?, invested_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(newQty, newInvested, holding.id);
    }

    // Record transaction
    await db
      .prepare('INSERT INTO transactions (id, user_id, order_id, symbol, side, quantity, price, total_amount, trade_type, pnl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uuidv4(), userId, orderId, symbol.toUpperCase(), 'SELL', quantity, price, totalRevenue, tradeType, pnl);
  }

  // Cancel a pending order
  async cancelOrder(userId, orderId) {
    const order = await db
      .prepare('SELECT * FROM orders WHERE id = ? AND user_id = ? AND status = ?')
      .get(orderId, userId, 'PENDING');
    if (!order) throw new Error('Order not found or already executed');

    await db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('CANCELLED', orderId);
    return { message: 'Order cancelled successfully' };
  }

  // Get user orders
  async getOrders(userId, status = null, limit = 50) {
    let orders;
    if (status) {
      orders = await db
        .prepare('SELECT * FROM orders WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?')
        .all(userId, status, limit);
    } else {
      orders = await db
        .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(userId, limit);
    }
    // Add camelCase aliases for frontend compatibility
    return orders.map(o => ({
      ...o,
      type: o.order_type || o.type,
      orderType: o.order_type,
      createdAt: o.created_at,
      executedAt: o.executed_at,
      tradeType: o.trade_type,
      filledQuantity: o.filled_quantity,
      filledPrice: o.filled_price,
      stopLoss: o.stop_loss,
      triggerPrice: o.trigger_price,
    }));
  }

  // Get holdings with current prices
  async getHoldings(userId) {
    const holdings = await db.prepare('SELECT * FROM holdings WHERE user_id = ? ORDER BY symbol').all(userId);

    const enriched = await Promise.all(holdings.map(async (h) => {
      const quote = await marketService.getQuote(h.symbol, h.exchange);
      const currentValue = quote.price * h.quantity;
      const investedValue = h.avg_price * h.quantity;
      const pnl = currentValue - investedValue;
      const pnlPercent = investedValue > 0 ? (pnl / investedValue) * 100 : 0;

      return {
        ...h,
        avgPrice: h.avg_price,
        investedAmount: h.invested_amount,
        createdAt: h.created_at,
        updatedAt: h.updated_at,
        currentPrice: quote.price,
        currentValue: parseFloat(currentValue.toFixed(2)),
        investedValue: parseFloat(investedValue.toFixed(2)),
        pnl: parseFloat(pnl.toFixed(2)),
        pnlPercent: parseFloat(pnlPercent.toFixed(2)),
        dayChange: quote.change,
        dayChangePercent: quote.changePercent
      };
    }));

    return enriched;
  }

  // Get portfolio summary
  async getPortfolioSummary(userId) {
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const holdings = await this.getHoldings(userId);

    const totalInvested = holdings.reduce((sum, h) => sum + h.investedValue, 0);
    const totalCurrent = holdings.reduce((sum, h) => sum + h.currentValue, 0);
    const totalPnl = totalCurrent - totalInvested;
    const totalPnlPercent = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
    const portfolioValue = user.balance + totalCurrent;
    const overallReturn = portfolioValue - user.initial_balance;
    const overallReturnPercent = (overallReturn / user.initial_balance) * 100;

    // Today's transactions
    const todayPnlRow = await db
      .prepare(`
        SELECT COALESCE(SUM(pnl), 0) as today_pnl
        FROM transactions
        WHERE user_id = ? AND DATE(created_at) = CURRENT_DATE
      `)
      .get(userId);

    return {
      cashBalance: parseFloat(user.balance.toFixed(2)),
      investedValue: parseFloat(totalInvested.toFixed(2)),
      currentValue: parseFloat(totalCurrent.toFixed(2)),
      portfolioValue: parseFloat(portfolioValue.toFixed(2)),
      initialBalance: user.initial_balance,
      totalPnl: parseFloat(totalPnl.toFixed(2)),
      totalPnlPercent: parseFloat(totalPnlPercent.toFixed(2)),
      overallReturn: parseFloat(overallReturn.toFixed(2)),
      overallReturnPercent: parseFloat(overallReturnPercent.toFixed(2)),
      todayPnl: todayPnlRow?.today_pnl || 0,
      holdingsCount: holdings.length,
      holdings
    };
  }

  // Get transaction history
  async getTransactions(userId, limit = 100) {
    const txns = await db
      .prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(userId, limit);
    return txns.map(t => ({
      ...t,
      createdAt: t.created_at,
      orderType: t.order_type,
      tradeType: t.trade_type,
      totalAmount: t.total_amount,
    }));
  }
}

module.exports = new TradingService();
