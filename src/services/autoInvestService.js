const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const marketService = require('./marketService');
const aiService = require('./aiService');
const mutualFundService = require('./mutualFundService');
const commodityService = require('./commodityService');

// Popular stock universes for AI to pick from
const STOCK_UNIVERSE = [
  'RELIANCE','TCS','HDFCBANK','INFY','ICICIBANK','HINDUNILVR','ITC','SBIN','BHARTIARTL','KOTAKBANK',
  'LT','AXISBANK','BAJFINANCE','MARUTI','HCLTECH','WIPRO','TITAN','SUNPHARMA','NESTLEIND','ULTRACEMCO',
  'TATAMOTORS','TATASTEEL','POWERGRID','NTPC','ADANIENT','ADANIPORTS','BAJAJFINSV','ONGC','COALINDIA','JSWSTEEL',
  'TECHM','INDUSINDBK','DRREDDY','CIPLA','M&M','HEROMOTOCO','GRASIM','BPCL','DIVISLAB','APOLLOHOSP',
  'ASIANPAINT','BRITANNIA','EICHERMOT','TATACONSUM','HINDPETRO','PIDILITIND','SBILIFE','HDFCLIFE','DABUR','GODREJCP'
];

const MF_ETF_UNIVERSE = [
  { symbol: 'NIFTYBEES', name: 'Nippon Nifty 50 ETF', type: 'index' },
  { symbol: 'BANKBEES', name: 'Nippon Bank Nifty ETF', type: 'index' },
  { symbol: 'JUNIORBEES', name: 'Nippon Nifty Next 50 ETF', type: 'index' },
  { symbol: 'SETFNIF50', name: 'SBI Nifty 50 ETF', type: 'index' },
  { symbol: 'ITBEES', name: 'Nippon IT ETF', type: 'sector' },
  { symbol: 'SETFNIFBK', name: 'SBI Nifty Bank ETF', type: 'sector' },
  { symbol: 'PSUBNKBEES', name: 'Nippon PSU Bank ETF', type: 'sector' },
  { symbol: 'MOM50', name: 'Motilal Nifty Momentum ETF', type: 'factor' },
];

const COMMODITY_ETF_UNIVERSE = [
  { symbol: 'GOLDBEES', name: 'Nippon Gold ETF', type: 'gold' },
  { symbol: 'SILVERBEES', name: 'Nippon Silver ETF', type: 'silver' },
  { symbol: 'CPSEETF', name: 'Nippon CPSE ETF', type: 'psu' },
];

class AutoInvestService {
  constructor() {
    this._tablesReady = db._ready;
  }

  // Get or create current month's budget tracker
  async _getMonthlyBudget(planId, userId, monthlyBudget) {
    await this._tablesReady;
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    let monthly = await db
      .prepare('SELECT * FROM auto_invest_monthly WHERE plan_id = ? AND month = ?')
      .get(planId, month);
    if (!monthly) {
      const id = uuidv4();
      await db
        .prepare('INSERT INTO auto_invest_monthly (id, plan_id, user_id, month, budget, remaining) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, planId, userId, month, monthlyBudget, monthlyBudget);
      monthly = await db.prepare('SELECT * FROM auto_invest_monthly WHERE id = ?').get(id);
    }
    return monthly;
  }

  // Analyze past picks performance and learn from losses
  async _learnFromPastPicks(userId, planId) {
    await this._tablesReady;
    const executedPicks = await db.prepare(`
      SELECT * FROM auto_invest_picks WHERE user_id = ? AND plan_id = ? AND status = 'EXECUTED'
      ORDER BY created_at DESC LIMIT 50
    `).all(userId, planId);

    if (!executedPicks.length) return { lessons: [], summary: 'No past investments yet.' };

    const lessons = [];
    const performances = [];

    for (const pick of executedPicks) {
      try {
        const quote = await marketService.getQuote(pick.symbol, 'NSE');
        const currentPrice = quote.price || 0;
        const buyPrice = pick.price || 0;
        if (!buyPrice || !currentPrice) continue;

        const pnlPercent = ((currentPrice - buyPrice) / buyPrice * 100);
        performances.push({ symbol: pick.symbol, type: pick.asset_type, buyPrice, currentPrice, pnlPercent: pnlPercent.toFixed(2), reason: pick.reason });

        // If loss > 5%, record a lesson
        if (pnlPercent < -5) {
          const severity = pnlPercent < -15 ? 'MAJOR' : pnlPercent < -10 ? 'MODERATE' : 'MINOR';
          const existingLesson = await db
            .prepare('SELECT id FROM auto_invest_lessons WHERE user_id = ? AND symbol = ? AND plan_id = ? AND category = ?')
            .get(userId, pick.symbol, planId, 'LOSS');
          
          if (!existingLesson) {
            const lessonText = `${pick.symbol} bought at ₹${buyPrice.toFixed(0)} is now ₹${currentPrice.toFixed(0)} (${pnlPercent.toFixed(1)}% loss). Original reason: ${pick.reason}`;
            const lessonId = uuidv4();
            await db
              .prepare('INSERT INTO auto_invest_lessons (id, plan_id, user_id, symbol, asset_type, buy_price, current_price, pnl_percent, lesson, category, severity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
              .run(lessonId, planId, userId, pick.symbol, pick.asset_type, buyPrice, currentPrice, pnlPercent, lessonText, 'LOSS', severity);
            lessons.push({ symbol: pick.symbol, pnlPercent, severity, lesson: lessonText });
          }
        }
        // If gain > 10%, record positive lesson
        if (pnlPercent > 10) {
          const existingWin = await db
            .prepare('SELECT id FROM auto_invest_lessons WHERE user_id = ? AND symbol = ? AND plan_id = ? AND category = ?')
            .get(userId, pick.symbol, planId, 'WIN');
          if (!existingWin) {
            const winText = `${pick.symbol} bought at ₹${buyPrice.toFixed(0)} is now ₹${currentPrice.toFixed(0)} (${pnlPercent.toFixed(1)}% gain). Strategy worked: ${pick.reason}`;
            const wId = uuidv4();
            await db
              .prepare('INSERT INTO auto_invest_lessons (id, plan_id, user_id, symbol, asset_type, buy_price, current_price, pnl_percent, lesson, category, severity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
              .run(wId, planId, userId, pick.symbol, pick.asset_type, buyPrice, currentPrice, pnlPercent, winText, 'WIN', 'POSITIVE');
          }
        }
      } catch (e) { /* skip failed quote */ }
    }

    // Get all stored lessons
    const allLessons = await db
      .prepare('SELECT * FROM auto_invest_lessons WHERE user_id = ? AND plan_id = ? ORDER BY created_at DESC LIMIT 20')
      .all(userId, planId);

    const winners = performances.filter(p => parseFloat(p.pnlPercent) > 0);
    const losers = performances.filter(p => parseFloat(p.pnlPercent) < 0);
    const avgPnl = performances.length ? (performances.reduce((s, p) => s + parseFloat(p.pnlPercent), 0) / performances.length).toFixed(1) : 0;

    const summary = `Portfolio Review: ${performances.length} past picks analyzed. ${winners.length} gainers, ${losers.length} losers. Avg P&L: ${avgPnl}%.
Top winners: ${winners.sort((a, b) => b.pnlPercent - a.pnlPercent).slice(0, 3).map(w => `${w.symbol} (+${w.pnlPercent}%)`).join(', ') || 'None yet'}
Top losers: ${losers.sort((a, b) => a.pnlPercent - b.pnlPercent).slice(0, 3).map(l => `${l.symbol} (${l.pnlPercent}%)`).join(', ') || 'None yet'}`;

    return {
      lessons: allLessons.map(l => ({ symbol: l.symbol, type: l.asset_type, pnl: l.pnl_percent, lesson: l.lesson, category: l.category, severity: l.severity })),
      performances,
      summary,
      avgPnl: parseFloat(avgPnl),
      winRate: performances.length ? ((winners.length / performances.length) * 100).toFixed(0) : 0,
    };
  }

  // Create a new auto-invest plan
  async createPlan(userId, { name, monthlyBudget, stockPct, mfPct, commodityPct, riskLevel }) {
    await this._tablesReady;
    // Validate percentages sum to 100
    const total = (stockPct || 50) + (mfPct || 30) + (commodityPct || 20);
    if (Math.abs(total - 100) > 1) {
      throw new Error('Asset allocation percentages must sum to 100%');
    }

    // Check if user already has an active plan
    const existing = await db.prepare('SELECT id FROM auto_invest_plans WHERE user_id = ? AND status = ?').get(userId, 'ACTIVE');
    if (existing) {
      throw new Error('You already have an active auto-invest plan. Pause it first to create a new one.');
    }

    const id = uuidv4();
    await db.prepare(`
      INSERT INTO auto_invest_plans (id, user_id, name, monthly_budget, stock_pct, mf_pct, commodity_pct, risk_level, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `).run(id, userId, name || 'My Auto-Invest Plan', monthlyBudget, stockPct || 50, mfPct || 30, commodityPct || 20, riskLevel || 'MODERATE');

    return this.getPlan(userId);
  }

  // Get user's plan
  async getPlan(userId) {
    await this._tablesReady;
    const plan = await db
      .prepare('SELECT * FROM auto_invest_plans WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(userId);
    if (!plan) return null;
    return {
      id: plan.id,
      name: plan.name,
      monthlyBudget: plan.monthly_budget,
      stockPct: plan.stock_pct,
      mfPct: plan.mf_pct,
      commodityPct: plan.commodity_pct,
      riskLevel: plan.risk_level,
      status: plan.status,
      lastResearchAt: plan.last_research_at,
      lastInvestAt: plan.last_invest_at,
      totalInvested: plan.total_invested,
      monthsActive: plan.months_active,
      createdAt: plan.created_at,
    };
  }

  // Update plan
  async updatePlan(userId, updates) {
    await this._tablesReady;
    const plan = await db
      .prepare('SELECT * FROM auto_invest_plans WHERE user_id = ? AND status != ?')
      .get(userId, 'CANCELLED');
    if (!plan) throw new Error('No active plan found');

    const { name, monthlyBudget, stockPct, mfPct, commodityPct, riskLevel } = updates;
    if (stockPct !== undefined || mfPct !== undefined || commodityPct !== undefined) {
      const total = (stockPct ?? plan.stock_pct) + (mfPct ?? plan.mf_pct) + (commodityPct ?? plan.commodity_pct);
      if (Math.abs(total - 100) > 1) throw new Error('Percentages must sum to 100%');
    }

    await db.prepare(`
      UPDATE auto_invest_plans SET
        name = COALESCE(?, name),
        monthly_budget = COALESCE(?, monthly_budget),
        stock_pct = COALESCE(?, stock_pct),
        mf_pct = COALESCE(?, mf_pct),
        commodity_pct = COALESCE(?, commodity_pct),
        risk_level = COALESCE(?, risk_level),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, monthlyBudget, stockPct, mfPct, commodityPct, riskLevel, plan.id);

    return this.getPlan(userId);
  }

  // Toggle plan status
  async togglePlan(userId) {
    await this._tablesReady;
    const plan = await db
      .prepare('SELECT * FROM auto_invest_plans WHERE user_id = ? AND status != ?')
      .get(userId, 'CANCELLED');
    if (!plan) throw new Error('No plan found');
    const newStatus = plan.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    await db
      .prepare('UPDATE auto_invest_plans SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(newStatus, plan.id);
    return { status: newStatus };
  }

  // Cancel plan
  async cancelPlan(userId) {
    await this._tablesReady;
    const plan = await db
      .prepare('SELECT * FROM auto_invest_plans WHERE user_id = ? AND status != ?')
      .get(userId, 'CANCELLED');
    if (!plan) throw new Error('No plan found');
    await db
      .prepare('UPDATE auto_invest_plans SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('CANCELLED', plan.id);
    return { status: 'CANCELLED' };
  }

  // AI Research — analyze market and pick best investments
  async runResearch(userId) {
    await this._tablesReady;
    const plan = await db
      .prepare('SELECT * FROM auto_invest_plans WHERE user_id = ? AND status = ?')
      .get(userId, 'ACTIVE');
    if (!plan) throw new Error('No active auto-invest plan');

    // Get monthly budget tracker — auto-resets each month
    const monthly = await this._getMonthlyBudget(plan.id, userId, plan.monthly_budget);
    const remainingBudget = monthly.remaining;
    if (remainingBudget <= 0) throw new Error(`Monthly budget of ₹${plan.monthly_budget} already fully invested for ${monthly.month}. Resets next month.`);

    const budget = remainingBudget; // Use remaining monthly budget, not full
    const stockBudget = (budget * plan.stock_pct / 100);
    const mfBudget = (budget * plan.mf_pct / 100);
    const commodityBudget = (budget * plan.commodity_pct / 100);
    const riskLevel = plan.risk_level;

    // 1. Learn from past picks (AI adaptation)
    let learningData = { lessons: [], summary: 'First investment — no history yet.', avgPnl: 0, winRate: 0 };
    try {
      learningData = await this._learnFromPastPicks(userId, plan.id);
    } catch (e) { console.warn('Learning analysis failed:', e.message); }

    // 2. Get market sentiment
    let sentiment = null;
    try {
      sentiment = await aiService.getMarketSentiment();
    } catch (e) { console.warn('Sentiment fetch failed:', e.message); }

    // 3. Get random subset of stocks to analyze (12 from universe)
    const shuffled = [...STOCK_UNIVERSE].sort(() => Math.random() - 0.5);
    const stockCandidates = shuffled.slice(0, 12);

    // 4. Fetch quick quotes for all candidates + MF ETFs + Commodity ETFs
    const allSymbols = [
      ...stockCandidates,
      ...MF_ETF_UNIVERSE.map(m => m.symbol),
      ...COMMODITY_ETF_UNIVERSE.map(c => c.symbol)
    ];

    const quotes = {};
    const quotePromises = allSymbols.map(async (sym) => {
      try {
        const q = await marketService.getQuote(sym, 'NSE');
        quotes[sym] = q;
      } catch (e) { /* skip */ }
    });
    await Promise.all(quotePromises);

    // 5. Build AI learning context
    const lossLessons = learningData.lessons.filter(l => l.category === 'LOSS');
    const winLessons = learningData.lessons.filter(l => l.category === 'WIN');

    let learningPrompt = '';
    if (learningData.lessons.length > 0) {
      learningPrompt = `

=== AI LEARNING FROM PAST INVESTMENTS ===
Past Performance: Win Rate ${learningData.winRate}%, Average P&L: ${learningData.avgPnl}%
${learningData.summary}

LOSSES TO AVOID REPEATING (learn from these mistakes):
${lossLessons.length ? lossLessons.map(l => `- ${l.lesson} [${l.severity}]`).join('\n') : 'No major losses recorded yet.'}

SUCCESSFUL STRATEGIES (repeat what worked):
${winLessons.length ? winLessons.map(l => `- ${l.lesson}`).join('\n') : 'No major wins recorded yet.'}

CRITICAL: Based on past losses, AVOID stocks in similar situations. Based on wins, prefer stocks with similar characteristics.
If win rate is below 50%, shift towards safer picks (ETFs, large-caps, gold). If win rate is above 70%, maintain current strategy.`;
    }

    // 6. Ask AI to pick the best investments
    const client = aiService._getClient();
    const prompt = `You are TradeBot — an expert Indian stock market auto-investing AI that LEARNS and ADAPTS from past performance.

TODAY'S DATE: ${new Date().toISOString().split('T')[0]}
USER'S RISK LEVEL: ${riskLevel}
MONTHLY BUDGET: ₹${plan.monthly_budget.toLocaleString('en-IN')} (Month: ${monthly.month})
  Already invested this month: ₹${monthly.spent.toLocaleString('en-IN')}
  REMAINING BUDGET for this cycle: ₹${budget.toLocaleString('en-IN')}
  - Stocks budget: ₹${stockBudget.toLocaleString('en-IN')} (${plan.stock_pct}%)
  - Mutual Fund/ETF budget: ₹${mfBudget.toLocaleString('en-IN')} (${plan.mf_pct}%)
  - Commodity ETF budget: ₹${commodityBudget.toLocaleString('en-IN')} (${plan.commodity_pct}%)

${sentiment ? `MARKET SENTIMENT: ${sentiment.overall || sentiment.sentiment || 'NEUTRAL'} — ${sentiment.summary || ''}` : ''}
${learningPrompt}

STOCK CANDIDATES (with current prices):
${stockCandidates.map(s => `${s}: ₹${quotes[s]?.price || 'N/A'} (${(quotes[s]?.changePercent || 0).toFixed(1)}% today)`).join('\n')}

MUTUAL FUND/ETF OPTIONS:
${MF_ETF_UNIVERSE.map(m => `${m.symbol} (${m.name}): ₹${quotes[m.symbol]?.price || 'N/A'}`).join('\n')}

COMMODITY ETF OPTIONS:
${COMMODITY_ETF_UNIVERSE.map(c => `${c.symbol} (${c.name}): ₹${quotes[c.symbol]?.price || 'N/A'}`).join('\n')}

TASK: Research and recommend the BEST investments. You MUST:
1. LEARN from past mistakes — do NOT repeat losing patterns
2. ADAPT strategy based on win rate and past performance
3. Consider value investing principles — buy quality at reasonable valuations
4. Factor in current market conditions and momentum
5. Diversify across sectors and risk levels
6. For ${riskLevel} risk — ${riskLevel === 'AGGRESSIVE' ? 'prefer growth stocks, higher equity allocation' : riskLevel === 'CONSERVATIVE' ? 'prefer large-cap, dividend stocks, more ETFs/gold' : 'balanced mix of growth and value'}
7. STAY WITHIN remaining budget of ₹${budget.toLocaleString('en-IN')}

Return ONLY valid JSON:
{
  "marketOutlook": "brief 2-line market outlook for today",
  "strategy": "brief strategy description — mention what you learned from past picks",
  "adaptations": "what you changed based on past performance (if any)",
  "stockPicks": [
    { "symbol": "SYMBOL", "reason": "why this stock (reference past learning if relevant)", "confidence": "HIGH/MEDIUM/LOW", "allocatePercent": 25 }
  ],
  "mfPicks": [
    { "symbol": "SYMBOL", "reason": "why this ETF", "confidence": "HIGH/MEDIUM/LOW", "allocatePercent": 50 }
  ],
  "commodityPicks": [
    { "symbol": "SYMBOL", "reason": "why this commodity ETF", "confidence": "HIGH/MEDIUM/LOW", "allocatePercent": 100 }
  ],
  "newsSummary": "key market news affecting investment decisions"
}

RULES:
- stockPicks allocatePercent must sum to 100 (of stock budget). Pick 2-5 stocks.
- mfPicks allocatePercent must sum to 100 (of MF budget). Pick 1-3 ETFs.
- commodityPicks allocatePercent must sum to 100 (of commodity budget). Pick 1-2 ETFs.
- Only use symbols from the candidates listed above.
- Only pick stocks/ETFs that have valid prices (not N/A).`;

    const response = await client.models.generateContent({
      model: aiService.model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: 'low' },
        temperature: 0.7,
      }
    });

    let research;
    try {
      let text = response.text || '';
      text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      research = JSON.parse(text);
    } catch (e) {
      throw new Error('AI research failed to parse. Please try again.');
    }

    // 5. Save research
    const researchId = uuidv4();
    const today = new Date().toISOString().split('T')[0];
    await db.prepare(`
      INSERT INTO auto_invest_research (id, plan_id, user_id, research_date, market_sentiment, top_stock_picks, top_mf_picks, top_commodity_picks, news_summary, ai_strategy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      researchId, plan.id, userId, today,
      research.marketOutlook || '',
      JSON.stringify(research.stockPicks || []),
      JSON.stringify(research.mfPicks || []),
      JSON.stringify(research.commodityPicks || []),
      research.newsSummary || '',
      research.strategy || ''
    );

    await db
      .prepare('UPDATE auto_invest_plans SET last_research_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(new Date().toISOString(), plan.id);

    // 6. Create pending picks
    const picks = [];

    // Stock picks
    for (const sp of (research.stockPicks || [])) {
      const amount = stockBudget * (sp.allocatePercent || 0) / 100;
      const price = quotes[sp.symbol]?.price || 0;
      const quantity = price > 0 ? Math.floor(amount / price) : 0;
      if (quantity > 0) {
        const pickId = uuidv4();
        await db.prepare(`
          INSERT INTO auto_invest_picks (id, plan_id, user_id, symbol, asset_type, action, reason, allocated_amount, quantity, price, confidence, status)
          VALUES (?, ?, ?, ?, 'STOCK', 'BUY', ?, ?, ?, ?, ?, 'PENDING')
        `).run(pickId, plan.id, userId, sp.symbol, sp.reason, amount, quantity, price, sp.confidence || 'MEDIUM');
        picks.push({ id: pickId, symbol: sp.symbol, type: 'STOCK', reason: sp.reason, amount, quantity, price, confidence: sp.confidence });
      }
    }

    // MF ETF picks
    for (const mf of (research.mfPicks || [])) {
      const amount = mfBudget * (mf.allocatePercent || 0) / 100;
      const price = quotes[mf.symbol]?.price || 0;
      const quantity = price > 0 ? Math.floor(amount / price) : 0;
      if (quantity > 0) {
        const pickId = uuidv4();
        await db.prepare(`
          INSERT INTO auto_invest_picks (id, plan_id, user_id, symbol, asset_type, action, reason, allocated_amount, quantity, price, confidence, status)
          VALUES (?, ?, ?, ?, 'MUTUAL_FUND', 'BUY', ?, ?, ?, ?, ?, 'PENDING')
        `).run(pickId, plan.id, userId, mf.symbol, mf.reason, amount, quantity, price, mf.confidence || 'MEDIUM');
        picks.push({ id: pickId, symbol: mf.symbol, type: 'MUTUAL_FUND', reason: mf.reason, amount, quantity, price, confidence: mf.confidence });
      }
    }

    // Commodity ETF picks
    for (const cm of (research.commodityPicks || [])) {
      const amount = commodityBudget * (cm.allocatePercent || 0) / 100;
      const price = quotes[cm.symbol]?.price || 0;
      const quantity = price > 0 ? Math.floor(amount / price) : 0;
      if (quantity > 0) {
        const pickId = uuidv4();
        await db.prepare(`
          INSERT INTO auto_invest_picks (id, plan_id, user_id, symbol, asset_type, action, reason, allocated_amount, quantity, price, confidence, status)
          VALUES (?, ?, ?, ?, 'COMMODITY', 'BUY', ?, ?, ?, ?, ?, 'PENDING')
        `).run(pickId, plan.id, userId, cm.symbol, cm.reason, amount, quantity, price, cm.confidence || 'MEDIUM');
        picks.push({ id: pickId, symbol: cm.symbol, type: 'COMMODITY', reason: cm.reason, amount, quantity, price, confidence: cm.confidence });
      }
    }

    return {
      researchId,
      date: today,
      marketOutlook: research.marketOutlook,
      strategy: research.strategy,
      adaptations: research.adaptations || 'First research — no past data to adapt from.',
      newsSummary: research.newsSummary,
      picks,
      totalAllocated: picks.reduce((s, p) => s + (p.quantity * p.price), 0),
      monthlyBudget: plan.monthly_budget,
      monthSpent: monthly.spent,
      monthRemaining: remainingBudget,
      month: monthly.month,
      learningData: {
        winRate: learningData.winRate,
        avgPnl: learningData.avgPnl,
        lessonsCount: learningData.lessons.length,
        summary: learningData.summary,
      },
    };
  }

  // Execute all pending picks — actually buy the stocks/ETFs
  async executePicks(userId) {
    await this._tablesReady;
    const plan = await db
      .prepare('SELECT * FROM auto_invest_plans WHERE user_id = ? AND status = ?')
      .get(userId, 'ACTIVE');
    if (!plan) throw new Error('No active plan');

    const pendingPicks = await db
      .prepare('SELECT * FROM auto_invest_picks WHERE plan_id = ? AND user_id = ? AND status = ?')
      .all(plan.id, userId, 'PENDING');
    if (!pendingPicks.length) throw new Error('No pending picks to execute. Run research first.');

    // Check user balance
    const user = await db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('User not found');

    // Monthly remaining budget (do not exceed it even if the user has extra cash)
    const monthly = await this._getMonthlyBudget(plan.id, userId, plan.monthly_budget);
    let remainingMonthly = Number(monthly?.remaining ?? 0);

    const results = [];
    let totalInvested = 0;

    for (const pick of pendingPicks) {
      try {
        if (remainingMonthly <= 0) {
          await db.prepare('UPDATE auto_invest_picks SET status = ? WHERE id = ?').run('SKIPPED', pick.id);
          results.push({ symbol: pick.symbol, status: 'SKIPPED', reason: 'Monthly budget exhausted' });
          continue;
        }

        // Re-fetch live price
        const quote = await marketService.getQuote(pick.symbol, 'NSE');
        const livePrice = quote.price || pick.price;

        if (!livePrice || livePrice <= 0) {
          await db.prepare('UPDATE auto_invest_picks SET status = ? WHERE id = ?').run('FAILED', pick.id);
          results.push({ symbol: pick.symbol, status: 'FAILED', reason: 'Invalid live price' });
          continue;
        }

        // Check balance and allocation limits
        const currentUser = await db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
        const allocatedAmount = Number(pick.allocated_amount ?? 0);

        const spendLimit = Math.max(
          0,
          Math.min(
            Number(currentUser?.balance ?? 0),
            remainingMonthly,
            allocatedAmount > 0 ? allocatedAmount : Number.POSITIVE_INFINITY
          )
        );

        const maxQtyBySpend = Math.floor(spendLimit / livePrice);
        const finalQty = Math.min(Number(pick.quantity ?? 0), maxQtyBySpend);

        if (!finalQty || finalQty < 1) {
          await db.prepare('UPDATE auto_invest_picks SET status = ? WHERE id = ?').run('SKIPPED', pick.id);
          results.push({ symbol: pick.symbol, status: 'SKIPPED', reason: spendLimit <= 0 ? 'Insufficient balance or budget' : 'Allocation too small at live price' });
          continue;
        }

        pick.quantity = finalQty;
        const finalCost = pick.quantity * livePrice;
        remainingMonthly -= finalCost;

        // Deduct balance
        await db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(finalCost, userId);

        // Upsert holdings
        const existing = await db
          .prepare('SELECT * FROM holdings WHERE user_id = ? AND symbol = ?')
          .get(userId, pick.symbol);
        if (existing) {
          const newQty = existing.quantity + pick.quantity;
          const newInvested = existing.invested_amount + finalCost;
          const newAvg = newInvested / newQty;
          await db
            .prepare('UPDATE holdings SET quantity = ?, avg_price = ?, invested_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(newQty, newAvg, newInvested, existing.id);
        } else {
          const holdingId = uuidv4();
          await db
            .prepare('INSERT INTO holdings (id, user_id, symbol, exchange, quantity, avg_price, invested_amount) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(holdingId, userId, pick.symbol, 'NSE', pick.quantity, livePrice, finalCost);
        }

        // Record in transactions
        const txnId = uuidv4();
        await db
          .prepare('INSERT INTO transactions (id, user_id, symbol, side, quantity, price, total_amount, trade_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(txnId, userId, pick.symbol, 'BUY', pick.quantity, livePrice, finalCost, 'DELIVERY');

        // Record in orders
        const orderId = uuidv4();
        await db.prepare(`INSERT INTO orders (id, user_id, symbol, exchange, order_type, side, quantity, price, status, filled_quantity, filled_price, trade_type, executed_at)
          VALUES (?, ?, ?, 'NSE', 'MARKET', 'BUY', ?, ?, 'EXECUTED', ?, ?, 'DELIVERY', CURRENT_TIMESTAMP)`)
          .run(orderId, userId, pick.symbol, pick.quantity, livePrice, pick.quantity, livePrice);

        // Update pick status
        await db
          .prepare('UPDATE auto_invest_picks SET status = ?, price = ?, executed_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run('EXECUTED', livePrice, pick.id);

        totalInvested += finalCost;
        results.push({
          symbol: pick.symbol,
          type: pick.asset_type,
          status: 'EXECUTED',
          quantity: pick.quantity,
          price: livePrice,
          totalCost: finalCost,
          reason: pick.reason
        });
      } catch (e) {
        await db.prepare('UPDATE auto_invest_picks SET status = ? WHERE id = ?').run('FAILED', pick.id);
        results.push({ symbol: pick.symbol, status: 'FAILED', reason: e.message });
      }
    }

    // Update plan totals
    await db
      .prepare('UPDATE auto_invest_plans SET total_invested = total_invested + ?, months_active = months_active + 1, last_invest_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(totalInvested, new Date().toISOString(), plan.id);

    // Update monthly budget tracker
    const month = new Date().toISOString().slice(0, 7);
    await db.prepare(`
      UPDATE auto_invest_monthly SET
        spent = spent + ?,
        remaining = CASE WHEN remaining - ? < 0 THEN 0 ELSE remaining - ? END,
        investments_count = investments_count + ?
      WHERE plan_id = ? AND month = ?
    `).run(
      totalInvested,
      totalInvested,
      totalInvested,
      results.filter(r => r.status === 'EXECUTED').length,
      plan.id,
      month
    );

    const updatedUser = await db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
    const updatedMonthly = await db
      .prepare('SELECT * FROM auto_invest_monthly WHERE plan_id = ? AND month = ?')
      .get(plan.id, month);

    return {
      totalInvested,
      remainingBalance: updatedUser?.balance || 0,
      monthlyBudget: plan.monthly_budget,
      monthSpent: updatedMonthly?.spent || totalInvested,
      monthRemaining: updatedMonthly?.remaining || 0,
      month: month,
      results,
      executedCount: results.filter(r => r.status === 'EXECUTED').length,
      skippedCount: results.filter(r => r.status === 'SKIPPED').length,
      failedCount: results.filter(r => r.status === 'FAILED').length,
    };
  }

  // Get investment history
  async getHistory(userId) {
    await this._tablesReady;
    const picks = await db.prepare(`
      SELECT * FROM auto_invest_picks WHERE user_id = ? ORDER BY created_at DESC LIMIT 100
    `).all(userId);

    return picks.map(p => ({
      id: p.id,
      symbol: p.symbol,
      assetType: p.asset_type,
      action: p.action,
      reason: p.reason,
      allocatedAmount: p.allocated_amount,
      quantity: p.quantity,
      price: p.price,
      confidence: p.confidence,
      status: p.status,
      executedAt: p.executed_at,
      createdAt: p.created_at,
    }));
  }

  // Get latest research
  async getLatestResearch(userId) {
    await this._tablesReady;
    const plan = await db
      .prepare('SELECT * FROM auto_invest_plans WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(userId);
    if (!plan) return null;

    const research = await db
      .prepare('SELECT * FROM auto_invest_research WHERE plan_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(plan.id);
    if (!research) return null;

    const pendingPicks = await db
      .prepare('SELECT * FROM auto_invest_picks WHERE plan_id = ? AND status = ?')
      .all(plan.id, 'PENDING');

    return {
      id: research.id,
      date: research.research_date,
      marketSentiment: research.market_sentiment,
      stockPicks: JSON.parse(research.top_stock_picks || '[]'),
      mfPicks: JSON.parse(research.top_mf_picks || '[]'),
      commodityPicks: JSON.parse(research.top_commodity_picks || '[]'),
      newsSummary: research.news_summary,
      strategy: research.ai_strategy,
      pendingPicks: pendingPicks.map(p => ({
        id: p.id, symbol: p.symbol, type: p.asset_type, quantity: p.quantity,
        price: p.price, amount: p.allocated_amount, reason: p.reason, confidence: p.confidence
      })),
      createdAt: research.created_at,
    };
  }

  // Get dashboard stats
  async getDashboard(userId) {
    await this._tablesReady;
    const plan = await this.getPlan(userId);
    const history = await this.getHistory(userId);
    const research = await this.getLatestResearch(userId);

    // Get learning data
    let learning = { lessons: [], summary: '', avgPnl: 0, winRate: 0 };
    if (plan && plan.id) {
      try {
        const planRow = await db
          .prepare('SELECT id FROM auto_invest_plans WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
          .get(userId);
        if (planRow) learning = await this._learnFromPastPicks(userId, planRow.id);
      } catch (e) { /* skip */ }
    }

    // Get monthly budget info
    let monthlyInfo = null;
    if (plan && plan.status !== 'NONE' && plan.status !== 'CANCELLED') {
      const planRow = await db
        .prepare('SELECT id, monthly_budget FROM auto_invest_plans WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(userId);
      if (planRow) {
        const month = new Date().toISOString().slice(0, 7);
        monthlyInfo = await db
          .prepare('SELECT * FROM auto_invest_monthly WHERE plan_id = ? AND month = ?')
          .get(planRow.id, month);
        if (!monthlyInfo) {
          monthlyInfo = { month, budget: planRow.monthly_budget, spent: 0, remaining: planRow.monthly_budget, investments_count: 0 };
        }
      }
    }

    // Group executed picks by asset type
    const executed = history.filter(h => h.status === 'EXECUTED');
    const stockInvested = executed.filter(h => h.assetType === 'STOCK').reduce((s, h) => s + (h.quantity * h.price), 0);
    const mfInvested = executed.filter(h => h.assetType === 'MUTUAL_FUND').reduce((s, h) => s + (h.quantity * h.price), 0);
    const commodityInvested = executed.filter(h => h.assetType === 'COMMODITY').reduce((s, h) => s + (h.quantity * h.price), 0);

    return {
      plan,
      latestResearch: research,
      recentHistory: history.slice(0, 20),
      monthlyBudget: monthlyInfo,
      learning: {
        winRate: learning.winRate,
        avgPnl: learning.avgPnl,
        lessonsCount: learning.lessons?.length || 0,
        summary: learning.summary,
        topLessons: (learning.lessons || []).slice(0, 5),
      },
      stats: {
        totalInvested: plan?.totalInvested || 0,
        stockInvested,
        mfInvested,
        commodityInvested,
        executedTrades: executed.length,
        monthsActive: plan?.monthsActive || 0,
      }
    };
  }
}

module.exports = new AutoInvestService();
