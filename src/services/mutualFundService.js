// Mutual Fund / ETF Service
// Data sources: Moneycontrol (via MarketService) + mock fallback
// Yahoo Finance intentionally not used

const marketService = require('./marketService');

const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

class MutualFundService {
  constructor() {
    this.categories = {
      index_funds: {
        name: 'Index Funds', icon: '📊',
        description: 'Track market indices like Nifty 50, Sensex',
        funds: [
          { symbol: 'NIFTYBEES', name: 'Nippon India Nifty 50 BeES', type: 'ETF', category: 'Large Cap', risk: 'Moderate' },
          { symbol: 'BANKBEES', name: 'Nippon India Bank BeES', type: 'ETF', category: 'Sectoral-Banking', risk: 'High' },
          { symbol: 'JUNIORBEES', name: 'Nippon India Nifty Next 50 Jr BeES', type: 'ETF', category: 'Large Cap', risk: 'Moderate' },
          { symbol: 'SETFNIF50', name: 'SBI Nifty 50 ETF', type: 'ETF', category: 'Large Cap', risk: 'Moderate' },
          { symbol: 'ITBEES', name: 'Nippon India Nifty IT BeES', type: 'ETF', category: 'Sectoral-IT', risk: 'High' },
        ]
      },
      gold_funds: {
        name: 'Gold Funds', icon: '🥇',
        description: 'Invest in gold without physical storage',
        funds: [
          { symbol: 'GOLDBEES', name: 'Nippon India Gold BeES', type: 'ETF', category: 'Commodity-Gold', risk: 'Moderate' },
          { symbol: 'GOLDCASE', name: 'ICICI Pru Gold ETF', type: 'ETF', category: 'Commodity-Gold', risk: 'Moderate' },
        ]
      },
      silver_funds: {
        name: 'Silver Funds', icon: '🥈',
        description: 'Invest in silver via ETFs',
        funds: [
          { symbol: 'SILVERBEES', name: 'Nippon India Silver BeES', type: 'ETF', category: 'Commodity-Silver', risk: 'High' },
        ]
      },
      equity_large: {
        name: 'Large Cap Equity', icon: '🏢',
        description: 'Invest in top 100 companies by market cap',
        funds: [
          { symbol: 'NIFTYBEES', name: 'Nifty 50 ETF (Large Cap)', type: 'ETF', category: 'Large Cap', risk: 'Moderate' },
          { symbol: 'SETFNIFBK', name: 'SBI Nifty Bank ETF', type: 'ETF', category: 'Banking', risk: 'High' },
        ]
      },
      equity_mid: {
        name: 'Mid Cap Equity', icon: '📈',
        description: 'Companies ranked 101-250 by market cap',
        funds: [
          { symbol: 'MOM100', name: 'Motilal Oswal Midcap 100 ETF', type: 'ETF', category: 'Mid Cap', risk: 'High' },
        ]
      },
      debt_funds: {
        name: 'Debt / Bond Funds', icon: '🏦',
        description: 'Safer fixed-income investments',
        funds: [
          { symbol: 'LIQUIDBEES', name: 'Nippon India Liquid BeES', type: 'ETF', category: 'Liquid', risk: 'Low' },
          { symbol: 'LONGTERM', name: 'Edelweiss Nifty PSU Bond Plus SDL ETF', type: 'ETF', category: 'Bond', risk: 'Low' },
        ]
      }
    };
  }

  async _getCached(key, fetcher) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.time < CACHE_TTL) return cached.data;
    try {
      const data = await fetcher();
      cache.set(key, { data, time: Date.now() });
      return data;
    } catch (e) {
      if (cached) return cached.data;
      throw e;
    }
  }

  // Fetch ETF quote - try NSE first, then fallback
  async _getETFQuote(symbol) {
    const clean = symbol.replace('.NS', '').replace('.BO', '');

    // Moneycontrol via MarketService
    try {
      const q = await marketService.getQuote(clean, 'NSE');
      if (q?.price) {
        return {
          price: q.price,
          nav: q.price,
          change: q.change || 0,
          changePercent: q.changePercent || 0,
          high52: q.fiftyTwoWeekHigh || 0,
          low52: q.fiftyTwoWeekLow || 0,
          fiftyTwoWeekHigh: q.fiftyTwoWeekHigh || 0,
          fiftyTwoWeekLow: q.fiftyTwoWeekLow || 0,
          dayHigh: q.high || 0,
          dayLow: q.low || 0,
          marketCap: q.marketCap || 0,
          volume: q.volume || 0,
        };
      }
    } catch {}

    // Fallback
    return this._getFallbackETFPrice(clean);
  }

  getCategories() {
    return Object.entries(this.categories).map(([id, cat]) => ({
      id, name: cat.name, icon: cat.icon,
      description: cat.description, fundCount: cat.funds.length
    }));
  }

  async getFundsByCategory(categoryId) {
    const cat = this.categories[categoryId];
    if (!cat) throw new Error('Category not found');

    return this._getCached(`funds_${categoryId}`, async () => {
      const funds = [];
      for (const f of cat.funds) {
        const quote = await this._getETFQuote(f.symbol);
        funds.push({
          ...f,
          categoryId,
          categoryName: cat.name,
          ...quote
        });
        await new Promise(r => setTimeout(r, 200));
      }
      return { ...cat, funds };
    });
  }

  _getFallbackETFPrice(symbol) {
    const clean = symbol.replace('.NS', '').replace('.BO', '');
    const fallbacks = {
      NIFTYBEES: { price: 265.50, change: 1.25, changePercent: 0.47, high52: 285, low52: 220 },
      BANKBEES: { price: 485.20, change: -2.10, changePercent: -0.43, high52: 520, low52: 400 },
      JUNIORBEES: { price: 720.80, change: 3.50, changePercent: 0.49, high52: 780, low52: 590 },
      SETFNIF50: { price: 262.30, change: 1.10, changePercent: 0.42, high52: 282, low52: 218 },
      ITBEES: { price: 42.80, change: 0.35, changePercent: 0.82, high52: 48, low52: 35 },
      GOLDBEES: { price: 62.50, change: 0.45, changePercent: 0.72, high52: 68, low52: 48 },
      GOLDCASE: { price: 63.20, change: 0.40, changePercent: 0.64, high52: 69, low52: 49 },
      SILVERBEES: { price: 88.30, change: 0.95, changePercent: 1.09, high52: 95, low52: 68 },
      SETFNIFBK: { price: 480.10, change: -1.80, changePercent: -0.37, high52: 515, low52: 395 },
      MOM100: { price: 32.50, change: 0.20, changePercent: 0.62, high52: 38, low52: 25 },
      LIQUIDBEES: { price: 1000.02, change: 0.01, changePercent: 0.00, high52: 1000.1, low52: 999.9 },
      LONGTERM: { price: 312.40, change: 0.30, changePercent: 0.10, high52: 325, low52: 290 },
    };
    const v = 1 + (Math.random() - 0.5) * 0.01;
    const fb = fallbacks[clean] || { price: 100, change: 0.5, changePercent: 0.5, high52: 120, low52: 80 };
    return {
      price: parseFloat((fb.price * v).toFixed(2)),
      nav: parseFloat((fb.price * v).toFixed(2)),
      change: parseFloat((fb.change * v).toFixed(2)),
      changePercent: parseFloat(fb.changePercent.toFixed(2)),
      high52: fb.high52,
      low52: fb.low52,
      fiftyTwoWeekHigh: fb.high52,
      fiftyTwoWeekLow: fb.low52,
      dayHigh: parseFloat((fb.price * 1.01).toFixed(2)),
      dayLow: parseFloat((fb.price * 0.99).toFixed(2)),
      volume: Math.floor(50000 + Math.random() * 200000),
      marketCap: Math.floor(5_000_000_000 + Math.random() * 200_000_000_000),
    };
  }

  async getAllFunds() {
    const allFunds = [];
    for (const [catId, cat] of Object.entries(this.categories)) {
      for (const fund of cat.funds) {
        allFunds.push({ ...fund, categoryId: catId, categoryName: cat.name });
      }
    }
    const enriched = [];
    for (const f of allFunds) {
      const quote = await this._getETFQuote(f.symbol);
      enriched.push({ ...f, ...quote });
      await new Promise(r => setTimeout(r, 150));
    }
    return enriched;
  }

  async getFundDetail(symbol) {
    const clean = symbol.replace('.NS', '').replace('.BO', '');
    const quote = await this._getETFQuote(clean);

    let fundInfo = { name: clean, category: 'ETF', risk: 'Moderate' };
    for (const cat of Object.values(this.categories)) {
      const found = cat.funds.find(f => f.symbol === clean || f.symbol === symbol);
      if (found) { fundInfo = found; break; }
    }

    const price = quote.price || 100;
    const low52 = quote.low52 || price * 0.85;
    const yearReturn = low52 > 0 ? ((price / low52 - 1) * 100 * 0.5) : 10;

    return {
      symbol: clean, name: fundInfo.name || clean,
      category: fundInfo.category, risk: fundInfo.risk,
      price: quote.price, nav: quote.nav || quote.price,
      change: quote.change, changePercent: quote.changePercent,
      high52: quote.high52,
      low52: quote.low52,
      dayHigh: quote.dayHigh || 0,
      dayLow: quote.dayLow || 0,
      fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh || quote.high52 || 0,
      fiftyTwoWeekLow: quote.fiftyTwoWeekLow || quote.low52 || 0,
      volume: quote.volume || 0,
      marketCap: quote.marketCap || 0,
      returns: {
        '1M': parseFloat((yearReturn * 0.12).toFixed(2)),
        '3M': parseFloat((yearReturn * 0.3).toFixed(2)),
        '6M': parseFloat((yearReturn * 0.55).toFixed(2)),
        '1Y': parseFloat(yearReturn.toFixed(2))
      },
      navHistory: []
    };
  }

  calculateSIP(monthlyAmount, years, expectedReturn) {
    const months = years * 12;
    const monthlyRate = expectedReturn / 100 / 12;
    let totalInvested = 0;
    let futureValue = 0;
    const yearlyBreakdown = [];

    for (let m = 1; m <= months; m++) {
      totalInvested += monthlyAmount;
      futureValue = (futureValue + monthlyAmount) * (1 + monthlyRate);
      if (m % 12 === 0) {
        yearlyBreakdown.push({
          year: m / 12,
          invested: Math.round(totalInvested),
          value: Math.round(futureValue),
          gains: Math.round(futureValue - totalInvested)
        });
      }
    }

    return {
      monthlyAmount, years, expectedReturn,
      totalInvested: Math.round(totalInvested),
      futureValue: Math.round(futureValue),
      totalGains: Math.round(futureValue - totalInvested),
      xirr: expectedReturn, yearlyBreakdown
    };
  }
}

module.exports = new MutualFundService();
