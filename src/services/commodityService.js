// India-only Commodity Service (INR)
// Data sources: Moneycontrol MCX commodity futures (pricefeed) + Moneycontrol equity/ETF quotes (via MarketService)

const marketService = require('./marketService');

// Cache for commodity prices (keep short for "realtime")
const cache = new Map();
const CACHE_TTL = 30 * 1000; // 30 seconds

// Cache for MCX expiry resolution (slow-changing)
const expiryCache = new Map();
const EXPIRY_TTL = 24 * 60 * 60 * 1000; // 24 hours

// INR fallback prices (approximate) — only used when live fetch fails
const FALLBACK_INR = {
  gold_india: { price: 6500, change: 25, changePercent: 0.38, dayHigh: 6550, dayLow: 6450, previousClose: 6475 },
  silver_india: { price: 78000, change: 650, changePercent: 0.84, dayHigh: 79000, dayLow: 77000, previousClose: 77350 },
  copper_india: { price: 250, change: 1.2, changePercent: 0.48, dayHigh: 252, dayLow: 247, previousClose: 248.8 },
};

class CommodityService {
  constructor() {
    this.commodities = {
      gold_india: {
        // MCX future quote (Moneycontrol priceapi requires an expiry token)
        mcxSymbol: 'GOLD',
        name: 'Gold (India)',
        icon: '🥇',
        unit: 'MCX (₹/10g) + ETF investing',
        description: 'Real-time MCX Gold futures quote with per-gram and 1 savaran (8g) conversion. Invest via Gold BeES ETF on NSE.',
        category: 'precious_metal',
        currency: 'INR',
        instrumentType: 'COMMODITY_FUTURE',
        // Investing + history via NSE ETF
        inrSymbol: 'GOLDBEES',
        historySymbol: 'GOLDBEES',
        // Conversion assumptions:
        // - MCX GOLD is commonly quoted per 10 grams.
        quoteUnit: 'INR_PER_10G',
      },
      silver_india: {
        mcxSymbol: 'SILVER',
        name: 'Silver (India)',
        icon: '🥈',
        unit: 'MCX (₹/kg) + ETF investing',
        description: 'Real-time MCX Silver futures quote with per-gram and 1 savaran (8g) conversion. Invest via Silver BeES ETF on NSE.',
        category: 'precious_metal',
        currency: 'INR',
        instrumentType: 'COMMODITY_FUTURE',
        inrSymbol: 'SILVERBEES',
        historySymbol: 'SILVERBEES',
        // Conversion assumptions:
        // - MCX SILVER is commonly quoted per 1 kilogram.
        quoteUnit: 'INR_PER_KG',
      },
      copper_india: {
        symbol: 'HINDCOPPER',
        name: 'Copper (India proxy)',
        icon: '🔶',
        unit: 'Equity proxy (not spot)',
        description: 'Proxy via Hindustan Copper (a company). This is not MCX spot copper price.',
        category: 'base_metal',
        currency: 'INR',
        instrumentType: 'EQUITY',
      },

      // Explicit ETF entries for the UI's "Indian Commodity ETFs" section
      gold_etf: {
        symbol: 'GOLDBEES',
        name: 'Gold BeES (ETF)',
        icon: '🥇',
        unit: 'ETF (NSE)',
        description: 'NSE-listed ETF tracking domestic gold prices.',
        category: 'precious_metal',
        currency: 'INR',
        instrumentType: 'ETF',
        isIndianETF: true,
      },
      silver_etf: {
        symbol: 'SILVERBEES',
        name: 'Silver BeES (ETF)',
        icon: '🥈',
        unit: 'ETF (NSE)',
        description: 'NSE-listed ETF tracking domestic silver prices.',
        category: 'precious_metal',
        currency: 'INR',
        instrumentType: 'ETF',
        isIndianETF: true,
      },
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

  async _fetchQuote(cleanSymbol) {
    const q = await marketService.getQuote(cleanSymbol, 'NSE');
    if (!q?.price) return null;

    return {
      price: q.price || 0,
      change: q.change || 0,
      changePercent: q.changePercent || 0,
      dayHigh: q.high || 0,
      dayLow: q.low || 0,
      open: q.open || 0,
      previousClose: q.close || 0,
      fiftyTwoWeekHigh: q.fiftyTwoWeekHigh || 0,
      fiftyTwoWeekLow: q.fiftyTwoWeekLow || 0,
      volume: q.volume || 0,
    };
  }

  _formatExpiryToken(date) {
    const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const dd = String(date.getDate()).padStart(2, '0');
    const mmm = months[date.getMonth()];
    const yyyy = String(date.getFullYear());
    return `${dd}${mmm}${yyyy}`;
  }

  async _resolveMcxExpiry(mcxSymbol) {
    const key = String(mcxSymbol || '').toUpperCase();
    if (!key) return null;

    const cached = expiryCache.get(key);
    if (cached && Date.now() - cached.time < EXPIRY_TTL) return cached.expiry;

    // Moneycontrol MCX futures commonly list contracts with expiry on the 5th of the month.
    // Probe upcoming months until we find a valid contract.
    const today = new Date();
    for (let i = 0; i < 18; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 5);
      const token = this._formatExpiryToken(d);
      const url = `https://priceapi.moneycontrol.com/pricefeed/mcx/commodityfuture/${encodeURIComponent(key)}?expiry=${encodeURIComponent(token)}`;
      try {
        const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' } });
        const j = await r.json().catch(() => null);
        if (j?.code === '200' && j?.data?.pricecurrent) {
          expiryCache.set(key, { expiry: token, time: Date.now() });
          return token;
        }
      } catch {
        // ignore and keep probing
      }
    }

    return null;
  }

  async _fetchMcxFutureQuote(mcxSymbol) {
    const sym = String(mcxSymbol || '').toUpperCase();
    if (!sym) return null;

    const expiry = await this._resolveMcxExpiry(sym);
    if (!expiry) return null;

    const url = `https://priceapi.moneycontrol.com/pricefeed/mcx/commodityfuture/${encodeURIComponent(sym)}?expiry=${encodeURIComponent(expiry)}`;
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' } });
    const j = await r.json().catch(() => null);
    if (!j || j.code !== '200' || !j.data) return null;

    const d = j.data;
    const price = parseFloat(d.pricecurrent) || 0;
    const prevClose = parseFloat(d.priceprevclose) || 0;
    const change = parseFloat(d.pricechange) || (price && prevClose ? price - prevClose : 0);
    const changePercent = parseFloat(d.pricepercentchange) || (prevClose ? (change / prevClose) * 100 : 0);

    return {
      price,
      change,
      changePercent,
      dayHigh: parseFloat(d.HIGH) || 0,
      dayLow: parseFloat(d.LOW) || 0,
      open: parseFloat(d.OPEN) || 0,
      previousClose: prevClose,
      volume: parseInt(d.VOL) || 0,
      expiry: d.EXPIRY || expiry,
      expiryDate: d.EXPIRY_DATE || '',
      rawUnit: sym === 'GOLD' ? 'INR_PER_10G' : (sym === 'SILVER' ? 'INR_PER_KG' : 'INR'),
    };
  }

  _applyUnitConversions(info, quote) {
    const q = { ...quote };

    const price = Number(q.price || 0);
    if (!price) return q;

    // 1 savaran (sovereign) = 8 grams
    const gramsInSovereign = 8;

    if (info.quoteUnit === 'INR_PER_10G') {
      const perGram = price / 10;
      q.pricePerGram = perGram;
      q.pricePerSovereign = perGram * gramsInSovereign;
      q.displayUnit = '₹/10g (MCX)';
    } else if (info.quoteUnit === 'INR_PER_KG') {
      const perGram = price / 1000;
      q.pricePerGram = perGram;
      q.pricePerSovereign = perGram * gramsInSovereign;
      q.displayUnit = '₹/kg (MCX)';
    }

    return q;
  }

  _toResult(id, info, quote, extra = {}) {
    return {
      id,
      ...info,
      price: quote.price || 0,
      change: quote.change || 0,
      changePercent: quote.changePercent || 0,
      dayHigh: quote.dayHigh || 0,
      dayLow: quote.dayLow || 0,
      open: quote.open || 0,
      previousClose: quote.previousClose || 0,
      fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh || 0,
      fiftyTwoWeekLow: quote.fiftyTwoWeekLow || 0,
      volume: quote.volume || 0,
      lastUpdated: new Date().toISOString(),
      currency: 'INR',
      ...extra,
    };
  }

  _getFallbackCommodity(id, info) {
    const fb = FALLBACK_INR[id] || { price: 100, change: 0, changePercent: 0, dayHigh: 105, dayLow: 95, previousClose: 100 };
    const v = 1 + (Math.random() - 0.5) * 0.005;
    return this._toResult(
      id,
      info,
      {
        price: parseFloat((fb.price * v).toFixed(2)),
        change: parseFloat((fb.change * v).toFixed(2)),
        changePercent: parseFloat(fb.changePercent.toFixed(2)),
        dayHigh: parseFloat((fb.dayHigh * v).toFixed(2)),
        dayLow: parseFloat((fb.dayLow * v).toFixed(2)),
        open: parseFloat(((fb.previousClose + fb.change * 0.5) * v).toFixed(2)),
        previousClose: fb.previousClose,
        fiftyTwoWeekHigh: parseFloat((fb.price * 1.15).toFixed(2)),
        fiftyTwoWeekLow: parseFloat((fb.price * 0.78).toFixed(2)),
        volume: Math.floor(50_000 + Math.random() * 200_000),
      },
      { isFallback: true }
    );
  }

  async getAllCommodities() {
    return this._getCached('all_commodities', async () => {
      const entries = Object.entries(this.commodities);
      const results = await Promise.all(
        entries.map(async ([id, info]) => {
          try {
            // MCX futures first (for commodities), otherwise NSE quote (for ETFs/proxies)
            let quote = null;

            if (info.mcxSymbol) {
              const mcx = await this._fetchMcxFutureQuote(info.mcxSymbol);
              if (mcx?.price) {
                quote = this._applyUnitConversions(info, mcx);

                // Also fetch ETF quote for investing UI (best-effort)
                if (info.inrSymbol) {
                  const etf = await this._fetchQuote(info.inrSymbol).catch(() => null);
                  if (etf?.price) {
                    quote.etfPrice = etf.price;
                    quote.etfChange = etf.change;
                    quote.etfChangePercent = etf.changePercent;
                  }
                }
              }
            } else if (info.symbol) {
              quote = await this._fetchQuote(info.symbol);
            }

            if (quote) return this._toResult(id, info, quote, {
              ...(quote.displayUnit ? { unit: quote.displayUnit } : {}),
              ...(quote.pricePerGram ? { pricePerGram: quote.pricePerGram, pricePerSovereign: quote.pricePerSovereign } : {}),
              ...(quote.etfPrice ? { etfPrice: quote.etfPrice, etfChange: quote.etfChange, etfChangePercent: quote.etfChangePercent } : {}),
              ...(quote.expiry ? { mcxExpiry: quote.expiry, mcxExpiryDate: quote.expiryDate } : {}),
              source: info.mcxSymbol ? 'moneycontrol_mcx' : 'moneycontrol',
            });

            return this._getFallbackCommodity(id, info);
          } catch {
            return this._getFallbackCommodity(id, info);
          }
        })
      );
      return results;
    });
  }

  async getCommodityQuote(commodityId) {
    const info = this.commodities[commodityId];
    if (!info) throw new Error('Commodity not found');

    return this._getCached(`commodity_${commodityId}`, async () => {
      try {
        let quote = null;

        if (info.mcxSymbol) {
          const mcx = await this._fetchMcxFutureQuote(info.mcxSymbol);
          if (mcx?.price) {
            quote = this._applyUnitConversions(info, mcx);

            if (info.inrSymbol) {
              const etf = await this._fetchQuote(info.inrSymbol).catch(() => null);
              if (etf?.price) {
                quote.etfPrice = etf.price;
                quote.etfChange = etf.change;
                quote.etfChangePercent = etf.changePercent;
              }
            }
          }
        } else if (info.symbol) {
          quote = await this._fetchQuote(info.symbol);
        }

        if (quote) {
          return this._toResult(commodityId, info, quote, {
            ...(quote.displayUnit ? { unit: quote.displayUnit } : {}),
            ...(quote.pricePerGram ? { pricePerGram: quote.pricePerGram, pricePerSovereign: quote.pricePerSovereign } : {}),
            ...(quote.etfPrice ? { etfPrice: quote.etfPrice, etfChange: quote.etfChange, etfChangePercent: quote.etfChangePercent } : {}),
            ...(quote.expiry ? { mcxExpiry: quote.expiry, mcxExpiryDate: quote.expiryDate } : {}),
            source: info.mcxSymbol ? 'moneycontrol_mcx' : 'moneycontrol',
          });
        }

        return this._getFallbackCommodity(commodityId, info);
      } catch {
        return this._getFallbackCommodity(commodityId, info);
      }
    });
  }

  async getCommodityHistory(commodityId, period = '6mo') {
    const info = this.commodities[commodityId];
    if (!info) throw new Error('Commodity not found');

    // Use the same historical pipeline as equities (NSE) where possible
    const range = period === '1mo' ? '1m' : period === '3mo' ? '3m' : period === '1y' ? '1y' : '6m';
    const historySym = info.historySymbol || info.inrSymbol || info.symbol;
    const data = historySym
      ? await marketService.getHistorical(historySym, 'NSE', range, '1d').catch(() => [])
      : [];
    if (Array.isArray(data) && data.length > 5) return data;

    // Fallback mock history
    const base = FALLBACK_INR[commodityId]?.price || 200;
    const out = [];
    let price = base * 0.9;
    for (let i = 180; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      price += (Math.random() - 0.48) * (base * 0.01);
      price = Math.max(base * 0.7, Math.min(base * 1.3, price));
      out.push({
        date: d.toISOString(),
        open: price - base * 0.002,
        high: price + base * 0.005,
        low: price - base * 0.005,
        close: price,
        volume: Math.floor(Math.random() * 100000),
      });
    }
    return out;
  }
}

module.exports = new CommodityService();
