// Data sources:
// - Moneycontrol: live quotes (pricefeed) + OHLC history (techCharts)
// - Screener.in: fundamentals/ratios and qualitative info
// - Last resort: Mock data with realistic per-stock values

const screenerService = require('./screenerService');

// Yahoo Finance intentionally not used

// Cache for market data (5-minute TTL)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key) {
  const item = cache.get(key);
  if (item && Date.now() - item.timestamp < CACHE_TTL) return item.data;
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

// Clean symbol - remove .NS/.BO suffix
function cleanSymbol(sym) {
  return sym.toUpperCase().replace('.NS', '').replace('.BO', '');
}

class MarketService {
  // quotes
  async getQuote(symbol, exchange = 'NSE') {
    const clean = cleanSymbol(symbol);
    const cacheKey = `quote:${clean}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    // Moneycontrol first
    try {
      const mc = await screenerService.getMoneyControlData(clean);
      if (mc?.price) {
        // Do NOT hit Screener here; this method is called in bulk (trending/sectors).
        // Moneycontrol already provides most quote-level fields.
        const pe = mc.pe || 0;
        const eps = mc.eps || (pe > 0 ? mc.price / pe : 0);
        const bookValue = mc.bookValue || 0;

        const result = {
          symbol: clean,
          exchange: exchange || 'NSE',
          name: mc.name || `${clean} Ltd`,
          price: mc.price || 0,
          change: mc.change || 0,
          changePercent: mc.changePercent || 0,
          open: mc.open || 0,
          high: mc.dayHigh || 0,
          low: mc.dayLow || 0,
          close: mc.prevClose || 0,
          volume: mc.volume || 0,
          marketCap: (mc.marketCapCr || 0) * 10000000,
          fiftyTwoWeekHigh: mc.high52 || 0,
          fiftyTwoWeekLow: mc.low52 || 0,
          pe: pe || 0,
          eps: eps || 0,
          dividend: 0,
          bookValue: bookValue || 0,
          pb: mc.pb || (bookValue > 0 ? mc.price / bookValue : 0),
          timestamp: new Date().toISOString()
        };

        setCache(cacheKey, result);
        return result;
      }
    } catch (mcError) {
      console.warn(`[Moneycontrol] Failed for ${clean}:`, mcError.message);
    }

    // Last resort: mock data
    return this._getMockQuote(clean);
  }

  async getQuotes(symbols, exchange = 'NSE') {
    const list = Array.isArray(symbols) ? symbols : [];
    if (list.length === 0) return [];

    // Moneycontrol requires at least one network call per symbol; doing it sequentially is too slow.
    // Keep concurrency modest to avoid rate-limits.
    const concurrency = Math.min(8, list.length);
    const results = new Array(list.length);
    let cursor = 0;

    const worker = async () => {
      while (true) {
        const i = cursor++;
        if (i >= list.length) break;
        const sym = list[i];
        try {
          results[i] = await this.getQuote(sym, exchange);
        } catch {
          results[i] = null;
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, worker));
    return results.filter(Boolean);
  }

  // historical data
  async getHistorical(symbol, exchange = 'NSE', period = '1y', interval = '1d') {
    const clean = cleanSymbol(symbol);
    const cacheKey = `historical:${clean}:${period}:${interval}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    // Moneycontrol techCharts history
    try {
      const rangeMap = { '1d': 1, '1w': 7, '1m': 30, '3m': 90, '6m': 180, '1y': 365, '5y': 365 };
      const days = rangeMap[period] || 365;

      const now = Math.floor(Date.now() / 1000);
      const from = now - days * 86400;

      const resolution = String(interval || '1d').toLowerCase().includes('d') ? 'D' : 'D';
      const url = `https://priceapi.moneycontrol.com/techCharts/history?symbol=${encodeURIComponent(clean)}&resolution=${resolution}&from=${from}&to=${now}`;
      const response = await screenerService._fetchHTML(url);
      const json = JSON.parse(response);
      if (json?.s === 'ok' && Array.isArray(json.t) && Array.isArray(json.c) && json.t.length > 5) {
        const data = json.t.map((ts, i) => ({
          date: new Date(ts * 1000).toISOString(),
          open: (json.o?.[i] ?? 0) || 0,
          high: (json.h?.[i] ?? 0) || 0,
          low: (json.l?.[i] ?? 0) || 0,
          close: (json.c?.[i] ?? 0) || 0,
          volume: (json.v?.[i] ?? 0) || 0
        }));
        setCache(cacheKey, data);
        return data;
      }
    } catch (mcErr) {
      console.warn(`[Moneycontrol Historical] Failed for ${clean}:`, mcErr.message);
    }

    // Last resort: generate mock history
    const currentQuote = await this.getQuote(symbol, exchange).catch(() => null);
    const basePrice = currentQuote?.price || 1500;
    return this._generateMockHistory(basePrice, period);
  }

  // search
  async search(query) {
    const cacheKey = `search:${query}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const allStocks = this.getAllStocks();
    const q = query.toUpperCase();
    const localResults = [];
    const seen = new Set();

    for (const [sector, symbols] of Object.entries(allStocks)) {
      for (const sym of symbols) {
        if (seen.has(sym)) continue;
        if (sym.toUpperCase().includes(q) || q.includes(sym.toUpperCase())) {
          seen.add(sym);
          localResults.push({ symbol: sym, name: `${sym} Ltd`, exchange: 'NSE', type: 'EQUITY' });
        }
      }
    }

    if (localResults.length > 0) {
      setCache(cacheKey, localResults.slice(0, 20));
      return localResults.slice(0, 20);
    }

    try {
      const url = `https://www.moneycontrol.com/mccode/common/autosuggestion_solr.php?query=${encodeURIComponent(query)}&type=1&format=json`;
      const response = await screenerService._fetchHTML(url);
      const suggestions = JSON.parse(response);
      if (Array.isArray(suggestions) && suggestions.length > 0) {
        const results = [];
        const seenSymbols = new Set();
        for (const s of suggestions) {
          const pdt = String(s?.pdt_dis_nm || '');
          const m = pdt.match(/\b([A-Z0-9\-]{2,20})\b\s*,\s*\d{3,6}\s*<\/span>/i);
          // Fallback parser: look for ", SYMBOL, BSECODE" inside the span
          const m2 = pdt.match(/,\s*([A-Z0-9\-]{2,20})\s*,\s*(\d{3,6})/i);
          const sym = (m?.[1] || m2?.[1] || '').toUpperCase();
          if (!sym || seenSymbols.has(sym)) continue;
          seenSymbols.add(sym);
          results.push({ symbol: sym, name: s?.name || `${sym} Ltd`, exchange: 'NSE', type: 'EQUITY' });
          if (results.length >= 20) break;
        }
        if (results.length > 0) {
          setCache(cacheKey, results);
          return results;
        }
      }
    } catch {}

    return localResults;
  }

  // fundamentals
  async getFundamentals(symbol, exchange = 'NSE', includeScreener = false) {
    const clean = cleanSymbol(symbol);
    const cacheKey = `fundamentals:${clean}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const quote = await this.getQuote(clean, exchange).catch(() => null);
    // Screener is optional because it is slower and can rate-limit; use it only when explicitly requested.
    const screener = includeScreener ? await screenerService.getCompanyData(clean).catch(() => null) : null;

    if (screener || quote) {
      const price = quote?.price || 0;
      const pe = screener?.ratios?.pe || quote?.pe || 0;
      const eps = screener?.ratios?.eps || quote?.eps || (pe > 0 && price > 0 ? price / pe : 0);
      const bookValue = screener?.ratios?.bookValue || quote?.bookValue || 0;
      const roe = screener?.ratios?.roe || 0;
      const de = screener?.ratios?.debtToEquity || 0;

      const marketCap = quote?.marketCap || 0;
      const result = {
        symbol: clean,
        name: screener?.name || quote?.name || `${clean} Ltd`,
        price,
        eps: parseFloat((eps || 0).toFixed(2)),
        pe: parseFloat((pe || 0).toFixed(2)),
        forwardPE: parseFloat(((pe || 0) * 0.85).toFixed(2)),
        debtToEquity: de,
        roe,
        marketCap,
        bookValue,
        pb: (bookValue > 0 ? parseFloat((price / bookValue).toFixed(2)) : 0),
        revenue: Math.floor(marketCap * 0.15) || 0,
        revenueGrowth: screener?.growth?.sales || 0,
        profitMargin: screener?.ratios?.profitMargin || 0,
        operatingMargin: screener?.ratios?.operatingMargin || 0,
        currentRatio: screener?.ratios?.currentRatio || 0,
        dividendYield: screener?.ratios?.dividendYield || 0,
        beta: 0,
        fiftyTwoWeekHigh: quote?.fiftyTwoWeekHigh || 0,
        fiftyTwoWeekLow: quote?.fiftyTwoWeekLow || 0,
        avgVolume: quote?.volume || 0,
        capCategory: this._classifyMarketCap(marketCap),
        healthScore: 50
      };

      const mock = this._getMockFundamentals(clean);
      if (!result.roe) result.roe = mock.roe;
      if (!result.debtToEquity) result.debtToEquity = mock.debtToEquity;
      if (!result.revenue) result.revenue = mock.revenue;
      if (!result.revenueGrowth) result.revenueGrowth = mock.revenueGrowth;
      if (!result.profitMargin) result.profitMargin = mock.profitMargin;
      if (!result.operatingMargin) result.operatingMargin = mock.operatingMargin;
      if (!result.currentRatio) result.currentRatio = mock.currentRatio;
      if (!result.beta) result.beta = mock.beta;
      if (!result.marketCap) result.marketCap = mock.marketCap;
      if (!result.avgVolume) result.avgVolume = mock.avgVolume;
      result.capCategory = this._classifyMarketCap(result.marketCap);
      result.healthScore = this._calculateHealthScore({
        pe: result.pe,
        debtToEquity: result.debtToEquity,
        roe: result.roe / 100,
        profitMargin: result.profitMargin / 100,
        revenueGrowth: result.revenueGrowth / 100
      });

      setCache(cacheKey, result);
      return result;
    }
    return this._getMockFundamentals(clean);
  }

  // indices
  async getIndices() {
    // Indices should feel realtime; also avoid caching transient failures for a full 5 minutes.
    // Use a dedicated short-lived cache.
    if (!this._indicesCache) this._indicesCache = { data: null, ts: 0 };
    if (this._indicesCache.data && Date.now() - this._indicesCache.ts < 30 * 1000) {
      return this._indicesCache.data;
    }

    const fallback = {
      nifty50: { value: 0, change: 0, changePercent: 0, note: 'Not enough data' },
      sensex: { value: 0, change: 0, changePercent: 0, note: 'Not enough data' }
    };

    const toIndex = (etfQuote, name, sourceSymbol, multiplier = 100) => {
      if (!etfQuote?.price) return { value: 0, change: 0, changePercent: 0, note: 'Not enough data' };
      return {
        name,
        value: Number(etfQuote.price) * multiplier,
        change: Number(etfQuote.change || 0) * multiplier,
        changePercent: Number(etfQuote.changePercent || 0),
        sourceSymbol,
        derivedFromEtf: true,
        multiplier
      };
    };

    try {
      const [niftyEtf, sensexEtf] = await Promise.all([
        this.getQuote('NIFTYBEES', 'NSE').catch(() => null),
        this.getQuote('SENSEXBEES', 'NSE').catch(() => null)
      ]);

      const result = {
        nifty50: toIndex(niftyEtf, 'NIFTY 50', 'NIFTYBEES', 100),
        sensex: toIndex(sensexEtf, 'SENSEX', 'SENSEXBEES', 100)
      };
      const hasAny = (result.nifty50?.value || 0) > 0 || (result.sensex?.value || 0) > 0;
      if (hasAny) {
        this._indicesCache = { data: result, ts: Date.now() };
      }
      return result;
    } catch {
      // Do not cache the fallback; let the next request retry quickly.
      return fallback;
    }
  }

  // stock lists
  getAllStocks() {
    return {
      nifty50: [
        'RELIANCE','TCS','HDFCBANK','INFY','ICICIBANK','HINDUNILVR','ITC','SBIN',
        'BHARTIARTL','KOTAKBANK','LT','AXISBANK','WIPRO','ASIANPAINT','MARUTI',
        'SUNPHARMA','TITAN','BAJFINANCE','HCLTECH','TATASTEEL','NTPC','POWERGRID',
        'ONGC','JSWSTEEL','M&M','ADANIENT','ADANIPORTS','COALINDIA','BAJAJFINSV',
        'DRREDDY','NESTLEIND','ULTRACEMCO','CIPLA','TRENT','BEL','GRASIM','INDIGO',
        'HINDALCO','SBILIFE','HDFCLIFE','APOLLOHOSP','EICHERMOT','TECHM','TATACONSUM',
        'SHRIRAMFIN','BAJAJ-AUTO','JIOFIN','ETERNAL','MAXHEALTH','TMPV'
      ],
      niftyNext50: [
        'BANKBARODA','BOSCHLTD','CHOLAFIN','COLPAL','DABUR','DLF','GAIL','GODREJCP',
        'HAL','HAVELLS','HEROMOTOCO','IDFCFIRSTB','INDUSTOWER','IOC','IRCTC','JINDALSTEL',
        'JUBLFOOD','LICI','LUPIN','MARICO','MOTHERSON','NAUKRI','PEL','PIIND',
        'PNB','POLYCAB','SBICARD','SIEMENS','SRF','TATACHEM','TATAPOWER','TATAMOTORS',
        'TORNTPHARM','TVSMOTOR','UPL','VEDL','ZOMATO','ZYDUSLIFE','ABB','ACC',
        'AMBUJACEM','BHEL','BPCL','CANBK','CONCOR','DIVISLAB','ICICIPRULI','MCDOWELL-N',
        'MUTHOOTFIN','PAGEIND'
      ],
      banking: [
        'HDFCBANK','ICICIBANK','SBIN','KOTAKBANK','AXISBANK','INDUSINDBK','PNB','BANKBARODA',
        'IDFCFIRSTB','CANBK','UNIONBANK','INDIANB','IOB','CENTRALBK','BANDHANBNK',
        'FEDERALBNK','RBLBANK','AUBANK','YESBANK','IDBI'
      ],
      it: [
        'TCS','INFY','HCLTECH','WIPRO','TECHM','LTIM','MPHASIS','COFORGE',
        'PERSISTENT','LTTS','NAUKRI','TATAELXSI','HAPPSTMNDS','ROUTE','KPITTECH','BIRLASOFT'
      ],
      pharma: [
        'SUNPHARMA','DRREDDY','CIPLA','DIVISLAB','LUPIN','AUROPHARMA','BIOCON',
        'TORNTPHARM','ZYDUSLIFE','GLENMARK','ALKEM','IPCALAB','NATCOPHARMA','LALPATHLAB','METROPOLIS'
      ],
      auto: [
        'MARUTI','TATAMOTORS','M&M','BAJAJ-AUTO','HEROMOTOCO','EICHERMOT','TVSMOTOR',
        'ASHOKLEY','MOTHERSON','BALKRISIND','MRF','TIINDIA','BHARATFORG','EXIDEIND','APOLLOTYRE'
      ],
      fmcg: [
        'HINDUNILVR','ITC','NESTLEIND','TATACONSUM','DABUR','MARICO','GODREJCP',
        'COLPAL','BRITANNIA','VBL','UBL','EMAMILTD','PGHH','RADICO','JYOTHYLAB'
      ],
      metals: [
        'TATASTEEL','JSWSTEEL','HINDALCO','VEDL','COALINDIA','NMDC','SAIL',
        'JINDALSTEL','NATIONALUM','MOIL','HINDCOPPER','WELCORP','APLAPOLLO','RATNAMANI'
      ],
      energy: [
        'RELIANCE','ONGC','NTPC','POWERGRID','BPCL','IOC','GAIL','TATAPOWER',
        'ADANIGREEN','ADANIPOWER','NHPC','SJVN','IREDA','PETRONET','IGL','MGL'
      ],
      realty: [
        'DLF','GODREJPROP','OBEROIRLTY','PRESTIGE','PHOENIXLTD','BRIGADE',
        'SOBHA','SUNTECK','MAHLIFE','LODHA'
      ],
      infra: [
        'LT','ADANIENT','ADANIPORTS','ULTRACEMCO','GRASIM','ACC','AMBUJACEM',
        'CONCOR','IRB','NCC','NBCC','BEL','HAL','BHEL'
      ],
      finance: [
        'BAJFINANCE','BAJAJFINSV','SBILIFE','HDFCLIFE','ICICIPRULI','CHOLAFIN',
        'SHRIRAMFIN','MUTHOOTFIN','MANAPPURAM','LICHSGFIN','PFC','RECLTD','IRFC','JIOFIN','PAYTM'
      ]
    };
  }

  async getStocksBySector(sector) {
    const allStocks = this.getAllStocks();
    const symbols = allStocks[sector] || allStocks.nifty50;
    return this.getQuotes(symbols);
  }

  getSectors() {
    return [
      { id: 'nifty50', name: 'NIFTY 50', icon: '📊', description: 'Top 50 Indian companies by market cap' },
      { id: 'niftyNext50', name: 'NIFTY Next 50', icon: '📈', description: 'Next 50 large-cap companies' },
      { id: 'banking', name: 'Banking', icon: '🏦', description: 'Public & private sector banks' },
      { id: 'it', name: 'Information Technology', icon: '💻', description: 'IT & software companies' },
      { id: 'pharma', name: 'Pharma & Healthcare', icon: '💊', description: 'Pharmaceutical companies' },
      { id: 'auto', name: 'Automobile', icon: '🚗', description: 'Vehicle manufacturers & auto parts' },
      { id: 'fmcg', name: 'FMCG', icon: '🛒', description: 'Fast moving consumer goods' },
      { id: 'metals', name: 'Metals & Mining', icon: '⛏️', description: 'Steel, aluminum, mining' },
      { id: 'energy', name: 'Energy & Power', icon: '⚡', description: 'Oil, gas, power generation' },
      { id: 'realty', name: 'Real Estate', icon: '🏗️', description: 'Real estate developers' },
      { id: 'infra', name: 'Infrastructure', icon: '🏭', description: 'Infrastructure & construction' },
      { id: 'finance', name: 'Financial Services', icon: '💰', description: 'NBFCs, insurance, fintech' }
    ];
  }

  async getTrending(limit = 30) {
    const all = this.getAllStocks();
    const popularSymbols = [...new Set([
      ...all.nifty50,
      ...all.niftyNext50,
      ...all.banking,
      ...all.it,
      ...all.pharma,
      ...all.auto,
      ...all.fmcg,
      ...all.metals,
      ...all.energy
    ])];
    const capped = popularSymbols.slice(0, Math.max(1, Math.min(200, Number(limit) || 30)));
    return this.getQuotes(capped);
  }

  async getGainersLosers() {
    // Use a larger universe than UI trending for more meaningful gainers/losers.
    const stocks = await this.getTrending(120);
    const sorted = [...stocks].sort((a, b) => b.changePercent - a.changePercent);
    return {
      gainers: sorted.filter(s => s.changePercent > 0).slice(0, 10),
      losers: sorted.filter(s => s.changePercent < 0).slice(-10).reverse()
    };
  }

  // helpers
  _classifyMarketCap(cap) {
    if (cap >= 200000000000) return 'Large Cap';
    if (cap >= 50000000000) return 'Mid Cap';
    return 'Small Cap';
  }

  _calculateHealthScore(data) {
    let score = 50;
    if (data.pe && data.pe > 0 && data.pe < 25) score += 10;
    if (data.pe && data.pe > 40) score -= 10;
    if (data.debtToEquity && data.debtToEquity < 1) score += 15;
    if (data.debtToEquity && data.debtToEquity > 2) score -= 15;
    if (data.roe && data.roe > 0.15) score += 10;
    if (data.profitMargin && data.profitMargin > 0.1) score += 10;
    if (data.revenueGrowth && data.revenueGrowth > 0.1) score += 5;
    return Math.max(0, Math.min(100, score));
  }

  _generateMockHistory(basePrice, period) {
    const periodMap = { '1d': 1, '1w': 7, '1m': 30, '3m': 90, '6m': 180, '1y': 365, '5y': 1825 };
    const days = periodMap[period] || 365;
    const data = [];
    let price = basePrice * (0.75 + Math.random() * 0.15);
    const dailyDrift = Math.pow(basePrice / price, 1 / days) - 1;
    for (let i = days; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      if (date.getDay() === 0 || date.getDay() === 6) continue;
      const volatility = price * 0.02;
      const change = (Math.random() - 0.48) * volatility + price * dailyDrift;
      price = Math.max(price * 0.5, price + change);
      data.push({
        date: date.toISOString(),
        open: parseFloat((price - (Math.random() - 0.5) * volatility * 0.5).toFixed(2)),
        high: parseFloat((price + Math.random() * volatility).toFixed(2)),
        low: parseFloat(Math.max(1, price - Math.random() * volatility).toFixed(2)),
        close: parseFloat(price.toFixed(2)),
        volume: Math.floor(500000 + Math.random() * 5000000)
      });
    }
    if (data.length > 0) data[data.length - 1].close = basePrice;
    return data;
  }

  _getMockQuote(symbol) {
    const mock = this._getMockFundamentals(symbol);
    const change = (Math.random() - 0.5) * mock.price * 0.04;
    return {
      symbol: symbol.toUpperCase(), exchange: 'NSE', name: mock.name,
      price: parseFloat(mock.price.toFixed(2)),
      change: parseFloat(change.toFixed(2)),
      changePercent: parseFloat(((change / mock.price) * 100).toFixed(2)),
      open: parseFloat((mock.price - 20).toFixed(2)),
      high: parseFloat((mock.price + 50).toFixed(2)),
      low: parseFloat((mock.price - 60).toFixed(2)),
      close: parseFloat((mock.price - change).toFixed(2)),
      volume: Math.floor(Math.random() * 10000000),
      marketCap: mock.marketCap,
      fiftyTwoWeekHigh: mock.fiftyTwoWeekHigh, fiftyTwoWeekLow: mock.fiftyTwoWeekLow,
      pe: mock.pe, eps: mock.eps, dividend: mock.dividendYield,
      bookValue: mock.bookValue, pb: mock.pb,
      timestamp: new Date().toISOString()
    };
  }

  _getMockFundamentals(symbol) {
    const stockData = {
      RELIANCE: { name: 'Reliance Industries', price: 1460, eps: 65.2, pe: 22.4, bv: 1120, mc: 19700000000000, roe: 9.8, de: 0.35, pm: 8.2, rg: 18.5, om: 14.1, beta: 0.82, dy: 0.38, cr: 1.28 },
      TCS: { name: 'Tata Consultancy Services', price: 3950, eps: 120.5, pe: 32.8, bv: 310, mc: 14400000000000, roe: 47.2, de: 0.04, pm: 19.8, rg: 8.2, om: 25.1, beta: 0.55, dy: 1.15, cr: 2.42 },
      HDFCBANK: { name: 'HDFC Bank Ltd', price: 1970, eps: 82.3, pe: 23.9, bv: 530, mc: 15000000000000, roe: 16.8, de: 0.92, pm: 22.5, rg: 16.4, om: 32.8, beta: 0.88, dy: 1.05, cr: 1.15 },
      INFY: { name: 'Infosys Ltd', price: 1620, eps: 62.8, pe: 25.8, bv: 215, mc: 6700000000000, roe: 32.1, de: 0.08, pm: 17.5, rg: 5.8, om: 21.3, beta: 0.68, dy: 2.35, cr: 2.8 },
      ICICIBANK: { name: 'ICICI Bank Ltd', price: 1430, eps: 62.5, pe: 22.9, bv: 350, mc: 10000000000000, roe: 18.2, de: 0.85, pm: 25.8, rg: 22.1, om: 38.2, beta: 0.95, dy: 0.78, cr: 1.08 },
      HINDUNILVR: { name: 'Hindustan Unilever', price: 2520, eps: 42.5, pe: 59.3, bv: 55, mc: 5900000000000, roe: 82.5, de: 0.02, pm: 16.8, rg: 2.5, om: 23.5, beta: 0.42, dy: 1.52, cr: 1.35 },
      ITC: { name: 'ITC Ltd', price: 435, eps: 15.8, pe: 27.5, bv: 52, mc: 5450000000000, roe: 28.5, de: 0.01, pm: 26.2, rg: 5.2, om: 35.8, beta: 0.55, dy: 2.85, cr: 2.1 },
      SBIN: { name: 'State Bank of India', price: 810, eps: 72.5, pe: 11.2, bv: 425, mc: 7230000000000, roe: 17.5, de: 1.15, pm: 18.2, rg: 25.5, om: 28.5, beta: 1.12, dy: 1.75, cr: 1.02 },
      BHARTIARTL: { name: 'Bharti Airtel Ltd', price: 1880, eps: 38.2, pe: 49.2, bv: 285, mc: 11200000000000, roe: 14.5, de: 1.82, pm: 12.5, rg: 22.8, om: 28.2, beta: 0.65, dy: 0.42, cr: 0.78 },
      KOTAKBANK: { name: 'Kotak Mahindra Bank', price: 2140, eps: 68.5, pe: 31.2, bv: 580, mc: 4250000000000, roe: 13.8, de: 0.55, pm: 28.2, rg: 15.8, om: 35.5, beta: 0.82, dy: 0.12, cr: 1.18 },
      LT: { name: 'Larsen & Toubro', price: 3420, eps: 95.2, pe: 35.9, bv: 620, mc: 4700000000000, roe: 15.8, de: 1.25, pm: 7.5, rg: 18.2, om: 11.8, beta: 1.15, dy: 0.72, cr: 1.32 },
      AXISBANK: { name: 'Axis Bank Ltd', price: 1210, eps: 72.8, pe: 16.6, bv: 420, mc: 3740000000000, roe: 18.5, de: 0.78, pm: 22.8, rg: 19.5, om: 32.5, beta: 1.05, dy: 0.08, cr: 1.05 },
      WIPRO: { name: 'Wipro Ltd', price: 265, eps: 18.2, pe: 14.6, bv: 145, mc: 2770000000000, roe: 14.8, de: 0.18, pm: 12.5, rg: 0.8, om: 16.2, beta: 0.72, dy: 0.22, cr: 2.55 },
      SUNPHARMA: { name: 'Sun Pharmaceutical', price: 1780, eps: 32.5, pe: 54.8, bv: 285, mc: 4270000000000, roe: 12.8, de: 0.12, pm: 22.5, rg: 10.5, om: 28.5, beta: 0.48, dy: 0.62, cr: 1.95 },
      MARUTI: { name: 'Maruti Suzuki India', price: 12500, eps: 345.5, pe: 36.2, bv: 2850, mc: 3920000000000, roe: 14.2, de: 0.02, pm: 8.5, rg: 12.8, om: 11.2, beta: 0.85, dy: 0.72, cr: 1.15 },
      TATAMOTORS: { name: 'Tata Motors Ltd', price: 705, eps: 52.5, pe: 13.4, bv: 210, mc: 2590000000000, roe: 28.5, de: 1.45, pm: 5.8, rg: 25.2, om: 8.5, beta: 1.42, dy: 0.35, cr: 0.92 },
      TITAN: { name: 'Titan Company Ltd', price: 3400, eps: 38.5, pe: 88.3, bv: 185, mc: 3020000000000, roe: 25.8, de: 0.15, pm: 8.2, rg: 22.5, om: 12.5, beta: 0.78, dy: 0.28, cr: 1.65 },
      BAJFINANCE: { name: 'Bajaj Finance Ltd', price: 9400, eps: 182.5, pe: 51.5, bv: 1250, mc: 5830000000000, roe: 22.8, de: 3.85, pm: 22.5, rg: 28.5, om: 42.8, beta: 1.25, dy: 0.42, cr: 1.12 },
      HCLTECH: { name: 'HCL Technologies', price: 1720, eps: 58.2, pe: 29.6, bv: 280, mc: 4660000000000, roe: 23.5, de: 0.05, pm: 16.8, rg: 6.5, om: 20.8, beta: 0.62, dy: 3.25, cr: 2.85 },
      TATASTEEL: { name: 'Tata Steel Ltd', price: 155, eps: 12.8, pe: 12.1, bv: 125, mc: 1920000000000, roe: 10.5, de: 0.82, pm: 5.2, rg: -8.5, om: 8.8, beta: 1.48, dy: 2.15, cr: 1.08 },
      NTPC: { name: 'NTPC Ltd', price: 365, eps: 22.5, pe: 16.2, bv: 185, mc: 3530000000000, roe: 12.8, de: 1.35, pm: 12.5, rg: 15.8, om: 25.2, beta: 0.72, dy: 1.85, cr: 0.92 },
      DRREDDY: { name: "Dr. Reddy's Laboratories", price: 1240, eps: 95.8, pe: 12.9, bv: 1250, mc: 1035000000000, roe: 8.2, de: 0.12, pm: 15.5, rg: 12.8, om: 22.5, beta: 0.35, dy: 0.52, cr: 2.15 },
      CIPLA: { name: 'Cipla Ltd', price: 1520, eps: 32.5, pe: 46.8, bv: 285, mc: 1230000000000, roe: 14.2, de: 0.08, pm: 14.8, rg: 8.5, om: 19.5, beta: 0.42, dy: 0.72, cr: 2.35 },
      INDUSINDBK: { name: 'IndusInd Bank', price: 820, eps: 82.5, pe: 9.9, bv: 620, mc: 640000000000, roe: 14.8, de: 0.92, pm: 15.8, rg: 12.2, om: 22.5, beta: 1.35, dy: 1.15, cr: 1.05 },
      PNB: { name: 'Punjab National Bank', price: 100, eps: 12.5, pe: 8.0, bv: 82, mc: 1100000000000, roe: 16.2, de: 1.45, pm: 12.5, rg: 32.5, om: 18.8, beta: 1.52, dy: 2.52, cr: 1.02 },
      BANKBARODA: { name: 'Bank of Baroda', price: 238, eps: 35.2, pe: 6.8, bv: 195, mc: 1230000000000, roe: 19.2, de: 1.18, pm: 15.2, rg: 18.5, om: 22.8, beta: 1.32, dy: 2.85, cr: 1.05 },
      IDFCFIRSTB: { name: 'IDFC First Bank', price: 63, eps: 4.8, pe: 13.1, bv: 42, mc: 450000000000, roe: 11.8, de: 1.52, pm: 8.5, rg: 35.2, om: 12.8, beta: 1.45, dy: 0, cr: 1.08 },
      CANBK: { name: 'Canara Bank', price: 98, eps: 42.5, pe: 2.3, bv: 285, mc: 890000000000, roe: 15.8, de: 1.28, pm: 15.5, rg: 22.8, om: 25.2, beta: 1.38, dy: 3.15, cr: 1.02 },
      UNIONBANK: { name: 'Union Bank of India', price: 115, eps: 18.2, pe: 6.3, bv: 95, mc: 790000000000, roe: 20.5, de: 1.35, pm: 12.8, rg: 28.5, om: 18.5, beta: 1.42, dy: 2.95, cr: 1.01 },
      INDIANB: { name: 'Indian Bank', price: 530, eps: 62.5, pe: 8.5, bv: 380, mc: 715000000000, roe: 17.2, de: 1.12, pm: 18.2, rg: 15.8, om: 25.5, beta: 1.18, dy: 2.25, cr: 1.05 },
      IOB: { name: 'Indian Overseas Bank', price: 54, eps: 5.2, pe: 10.4, bv: 32, mc: 1010000000000, roe: 17.5, de: 1.55, pm: 8.8, rg: 42.5, om: 12.5, beta: 1.62, dy: 0, cr: 1.01 },
      CENTRALBK: { name: 'Central Bank of India', price: 55, eps: 3.8, pe: 14.5, bv: 42, mc: 480000000000, roe: 9.8, de: 1.72, pm: 5.2, rg: 22.5, om: 8.5, beta: 1.55, dy: 0, cr: 1.02 },
      BANDHANBNK: { name: 'Bandhan Bank', price: 175, eps: 18.5, pe: 9.5, bv: 95, mc: 282000000000, roe: 21.2, de: 1.08, pm: 18.5, rg: -5.8, om: 28.2, beta: 1.28, dy: 0, cr: 1.05 },
      FEDERALBNK: { name: 'Federal Bank', price: 205, eps: 18.2, pe: 11.3, bv: 115, mc: 500000000000, roe: 16.8, de: 0.78, pm: 15.5, rg: 22.8, om: 22.5, beta: 1.08, dy: 1.52, cr: 1.08 },
      RBLBANK: { name: 'RBL Bank Ltd', price: 165, eps: 22.5, pe: 7.3, bv: 285, mc: 100000000000, roe: 8.5, de: 0.92, pm: 8.2, rg: 5.5, om: 12.8, beta: 1.52, dy: 0.85, cr: 1.02 },
      AUBANK: { name: 'AU Small Finance Bank', price: 620, eps: 28.5, pe: 21.8, bv: 245, mc: 462000000000, roe: 12.5, de: 0.85, pm: 15.8, rg: 28.5, om: 22.5, beta: 1.12, dy: 0.18, cr: 1.12 },
      YESBANK: { name: 'Yes Bank Ltd', price: 19, eps: 1.2, pe: 15.8, bv: 15, mc: 595000000000, roe: 8.2, de: 1.85, pm: 5.5, rg: 18.2, om: 8.8, beta: 1.72, dy: 0, cr: 1.01 },
      IDBI: { name: 'IDBI Bank Ltd', price: 78, eps: 8.5, pe: 9.2, bv: 55, mc: 840000000000, roe: 16.5, de: 1.15, pm: 15.2, rg: 28.5, om: 22.8, beta: 1.35, dy: 1.82, cr: 1.02 },
      TECHM: { name: 'Tech Mahindra', price: 1680, eps: 52.5, pe: 32.0, bv: 385, mc: 1630000000000, roe: 14.8, de: 0.08, pm: 10.5, rg: 2.2, om: 13.5, beta: 0.82, dy: 1.85, cr: 2.65 },
      ASIANPAINT: { name: 'Asian Paints Ltd', price: 2380, eps: 32.5, pe: 73.2, bv: 165, mc: 2280000000000, roe: 22.5, de: 0.12, pm: 14.8, rg: 3.5, om: 18.5, beta: 0.58, dy: 0.65, cr: 1.48 },
      NESTLEIND: { name: 'Nestle India Ltd', price: 2250, eps: 52.8, pe: 42.6, bv: 125, mc: 2170000000000, roe: 58.5, de: 0.05, pm: 15.2, rg: 8.5, om: 22.8, beta: 0.38, dy: 1.35, cr: 1.52 },
      POWERGRID: { name: 'Power Grid Corp', price: 312, eps: 28.5, pe: 10.9, bv: 185, mc: 2900000000000, roe: 16.2, de: 1.85, pm: 32.5, rg: 8.8, om: 82.5, beta: 0.62, dy: 3.85, cr: 0.85 },
      ONGC: { name: 'ONGC Ltd', price: 252, eps: 42.5, pe: 5.9, bv: 215, mc: 3170000000000, roe: 21.5, de: 0.35, pm: 18.5, rg: -5.2, om: 32.5, beta: 0.92, dy: 4.25, cr: 1.28 },
      COALINDIA: { name: 'Coal India Ltd', price: 385, eps: 52.8, pe: 7.3, bv: 155, mc: 2370000000000, roe: 52.5, de: 0.08, pm: 22.5, rg: -2.5, om: 28.8, beta: 0.78, dy: 5.25, cr: 2.15 },
      DIVISLAB: { name: "Divi's Laboratories", price: 6350, eps: 82.5, pe: 77.0, bv: 625, mc: 1680000000000, roe: 14.5, de: 0.02, pm: 28.5, rg: 18.5, om: 35.2, beta: 0.42, dy: 0.85, cr: 3.25 },
      LUPIN: { name: 'Lupin Ltd', price: 2120, eps: 38.5, pe: 55.1, bv: 385, mc: 966000000000, roe: 11.2, de: 0.18, pm: 12.8, rg: 15.5, om: 18.2, beta: 0.55, dy: 0.52, cr: 1.85 },
      CHOLAFIN: { name: 'Cholamandalam Investment', price: 1580, eps: 42.5, pe: 37.2, bv: 285, mc: 1325000000000, roe: 20.5, de: 4.25, pm: 22.5, rg: 32.5, om: 38.5, beta: 1.15, dy: 0.15, cr: 1.05 },
      BAJAJFINSV: { name: 'Bajaj Finserv Ltd', price: 2050, eps: 18.5, pe: 110.8, bv: 285, mc: 3260000000000, roe: 12.5, de: 2.52, pm: 15.2, rg: 18.5, om: 22.8, beta: 1.05, dy: 0.08, cr: 1.12 },
      HEROMOTOCO: { name: 'Hero MotoCorp', price: 4350, eps: 175.2, pe: 24.8, bv: 1250, mc: 870000000000, roe: 16.8, de: 0.02, pm: 8.8, rg: 12.5, om: 12.2, beta: 0.82, dy: 2.85, cr: 1.45 },
      EICHERMOT: { name: 'Eicher Motors', price: 5250, eps: 115.5, pe: 45.5, bv: 685, mc: 1440000000000, roe: 22.5, de: 0.02, pm: 18.5, rg: 8.8, om: 25.8, beta: 0.78, dy: 0.72, cr: 1.95 },
      HAL: { name: 'Hindustan Aeronautics', price: 4050, eps: 125.5, pe: 32.3, bv: 850, mc: 2710000000000, roe: 26.8, de: 0.02, pm: 18.2, rg: 15.8, om: 22.5, beta: 0.68, dy: 1.15, cr: 1.62 },
      BEL: { name: 'Bharat Electronics', price: 295, eps: 8.5, pe: 34.7, bv: 42, mc: 2160000000000, roe: 22.8, de: 0.01, pm: 18.5, rg: 25.5, om: 25.2, beta: 0.72, dy: 0.82, cr: 2.15 },
      TATAPOWER: { name: 'Tata Power Company', price: 395, eps: 12.8, pe: 30.9, bv: 125, mc: 1260000000000, roe: 11.5, de: 1.52, pm: 8.2, rg: 22.5, om: 15.8, beta: 1.12, dy: 0.52, cr: 0.92 },
      DLF: { name: 'DLF Ltd', price: 750, eps: 12.5, pe: 60.0, bv: 185, mc: 1860000000000, roe: 7.2, de: 0.18, pm: 28.5, rg: 15.2, om: 35.8, beta: 1.28, dy: 0.72, cr: 2.85 },
      VEDL: { name: 'Vedanta Ltd', price: 440, eps: 35.2, pe: 12.5, bv: 115, mc: 1640000000000, roe: 35.5, de: 1.52, pm: 12.5, rg: -12.5, om: 18.2, beta: 1.55, dy: 8.52, cr: 0.85 },
      ADANIENT: { name: 'Adani Enterprises', price: 2800, eps: 42.5, pe: 65.9, bv: 485, mc: 3190000000000, roe: 9.2, de: 0.82, pm: 2.5, rg: 42.5, om: 5.8, beta: 1.68, dy: 0.05, cr: 1.25 },
      PAYTM: { name: 'One 97 Communications', price: 880, eps: -15.5, pe: 0, bv: 185, mc: 560000000000, roe: -8.5, de: 0.02, pm: -12.5, rg: 25.5, om: -8.8, beta: 1.85, dy: 0, cr: 2.85 },
      ZOMATO: { name: 'Zomato Ltd', price: 240, eps: 2.5, pe: 96.0, bv: 22, mc: 2120000000000, roe: 4.2, de: 0.01, pm: 2.5, rg: 52.5, om: 1.8, beta: 1.45, dy: 0, cr: 3.25 },
      GAIL: { name: 'GAIL (India) Ltd', price: 196, eps: 18.2, pe: 10.8, bv: 135, mc: 1290000000000, roe: 14.5, de: 0.35, pm: 8.5, rg: -8.5, om: 12.8, beta: 0.92, dy: 2.85, cr: 1.52 },
      BPCL: { name: 'Bharat Petroleum', price: 310, eps: 62.5, pe: 5.0, bv: 285, mc: 1350000000000, roe: 24.8, de: 0.55, pm: 3.8, rg: -5.2, om: 5.5, beta: 1.08, dy: 5.15, cr: 0.95 },
      IOC: { name: 'Indian Oil Corporation', price: 140, eps: 22.5, pe: 6.2, bv: 115, mc: 1970000000000, roe: 21.2, de: 0.82, pm: 3.2, rg: -2.8, om: 4.8, beta: 0.95, dy: 6.52, cr: 0.88 },
      SHRIRAMFIN: { name: 'Shriram Finance', price: 2850, eps: 155.5, pe: 18.3, bv: 1250, mc: 1072000000000, roe: 16.5, de: 3.82, pm: 22.5, rg: 18.2, om: 55.2, beta: 1.12, dy: 1.12, cr: 1.05 },
      MUTHOOTFIN: { name: 'Muthoot Finance', price: 2150, eps: 85.5, pe: 25.1, bv: 525, mc: 863000000000, roe: 18.8, de: 2.85, pm: 32.5, rg: 22.5, om: 42.8, beta: 0.85, dy: 1.35, cr: 1.08 },
      PFC: { name: 'Power Finance Corp', price: 415, eps: 55.2, pe: 7.5, bv: 285, mc: 1370000000000, roe: 20.5, de: 8.52, pm: 42.5, rg: 15.8, om: 82.5, beta: 1.02, dy: 2.85, cr: 1.02 },
      RECLTD: { name: 'REC Limited', price: 480, eps: 62.5, pe: 7.7, bv: 310, mc: 1265000000000, roe: 21.8, de: 7.85, pm: 38.5, rg: 18.5, om: 78.5, beta: 1.08, dy: 2.52, cr: 1.05 },
      JINDALSTEL: { name: 'Jindal Steel & Power', price: 990, eps: 52.5, pe: 18.9, bv: 485, mc: 1010000000000, roe: 12.2, de: 0.42, pm: 10.5, rg: 15.8, om: 15.2, beta: 1.42, dy: 0.52, cr: 1.28 },
      NMDC: { name: 'NMDC Ltd', price: 225, eps: 22.5, pe: 10.0, bv: 95, mc: 660000000000, roe: 26.5, de: 0.05, pm: 32.5, rg: -5.5, om: 42.8, beta: 0.95, dy: 4.25, cr: 3.15 },
      SAIL: { name: 'Steel Authority of India', price: 120, eps: 8.5, pe: 14.1, bv: 85, mc: 495000000000, roe: 10.8, de: 0.55, pm: 5.2, rg: -12.5, om: 8.8, beta: 1.52, dy: 2.85, cr: 1.15 },
      HINDALCO: { name: 'Hindalco Industries', price: 660, eps: 42.5, pe: 15.5, bv: 385, mc: 1480000000000, roe: 12.5, de: 0.62, pm: 5.8, rg: 8.5, om: 10.2, beta: 1.35, dy: 0.62, cr: 1.45 },
      LTIM: { name: 'LTIMindtree Ltd', price: 5650, eps: 145.5, pe: 38.8, bv: 580, mc: 1670000000000, roe: 28.5, de: 0.05, pm: 15.2, rg: 5.8, om: 18.5, beta: 0.72, dy: 1.15, cr: 2.85 },
      MPHASIS: { name: 'Mphasis Ltd', price: 2800, eps: 82.5, pe: 33.9, bv: 415, mc: 527000000000, roe: 22.5, de: 0.08, pm: 14.5, rg: 3.5, om: 17.8, beta: 0.68, dy: 1.52, cr: 2.52 },
    };

    const key = symbol.toUpperCase().replace(/&/g, '&').replace('.NS','').replace('.BO','');
    const data = stockData[key];
    if (data) {
      const v = 1 + (Math.random() - 0.5) * 0.02;
      const price = parseFloat((data.price * v).toFixed(2));
      return {
        symbol: symbol.toUpperCase(), name: data.name, price,
        eps: data.eps, pe: parseFloat(data.pe.toFixed(2)),
        forwardPE: parseFloat((data.pe * 0.85).toFixed(2)),
        debtToEquity: data.de, roe: data.roe, marketCap: data.mc,
        bookValue: data.bv, pb: parseFloat((price / data.bv).toFixed(2)),
        revenue: Math.floor(data.mc * 0.15),
        revenueGrowth: data.rg, profitMargin: data.pm,
        operatingMargin: data.om, currentRatio: data.cr,
        dividendYield: data.dy, beta: data.beta,
        fiftyTwoWeekHigh: parseFloat((price * 1.25).toFixed(2)),
        fiftyTwoWeekLow: parseFloat((price * 0.72).toFixed(2)),
        avgVolume: Math.floor(data.mc / price / 100),
        capCategory: this._classifyMarketCap(data.mc),
        healthScore: this._calculateHealthScore({
          pe: data.pe, debtToEquity: data.de, roe: data.roe / 100,
          profitMargin: data.pm / 100, revenueGrowth: data.rg / 100
        })
      };
    }

    // Seeded random for unknown stocks
    let hash = 0;
    for (let i = 0; i < symbol.length; i++) { hash = ((hash << 5) - hash + symbol.charCodeAt(i)) | 0; }
    const seed = Math.abs(hash);
    const s = (n) => ((seed * n) % 1000) / 1000;
    const price = parseFloat((200 + s(7) * 4800).toFixed(2));
    const eps = parseFloat((5 + s(13) * 150).toFixed(2));
    const pe = eps > 0 ? parseFloat((price / eps).toFixed(2)) : 0;
    const bv = parseFloat((price * (0.3 + s(17) * 0.5)).toFixed(2));
    const mc = Math.floor(50000000000 + s(23) * 12000000000000);
    const roe = parseFloat((5 + s(29) * 35).toFixed(2));
    const de = parseFloat((s(31) * 2.5).toFixed(2));
    const pm = parseFloat((2 + s(37) * 28).toFixed(2));
    return {
      symbol: symbol.toUpperCase(),
      name: `${symbol.charAt(0).toUpperCase()}${symbol.slice(1).toLowerCase()} Ltd`,
      price, eps, pe,
      forwardPE: parseFloat((pe * 0.85).toFixed(2)),
      debtToEquity: de, roe, marketCap: mc, bookValue: bv,
      pb: bv > 0 ? parseFloat((price / bv).toFixed(2)) : 0,
      revenue: Math.floor(mc * 0.15),
      revenueGrowth: parseFloat((-5 + s(41) * 40).toFixed(2)),
      profitMargin: pm,
      operatingMargin: parseFloat((pm * (1 + s(43) * 0.5)).toFixed(2)),
      currentRatio: parseFloat((0.5 + s(47) * 2.5).toFixed(2)),
      dividendYield: parseFloat((s(53) * 5).toFixed(2)),
      beta: parseFloat((0.3 + s(59) * 1.5).toFixed(2)),
      fiftyTwoWeekHigh: parseFloat((price * 1.25).toFixed(2)),
      fiftyTwoWeekLow: parseFloat((price * 0.72).toFixed(2)),
      avgVolume: Math.floor(mc / price / 100),
      capCategory: this._classifyMarketCap(mc),
      healthScore: this._calculateHealthScore({
        pe, debtToEquity: de, roe: roe / 100,
        profitMargin: pm / 100, revenueGrowth: s(41) * 0.4 - 0.05
      })
    };
  }
}

module.exports = new MarketService();
