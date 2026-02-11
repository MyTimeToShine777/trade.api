const { GoogleGenAI } = require('@google/genai');
const marketService = require('./marketService');
const screenerService = require('./screenerService');
const technicalService = require('./technicalService');

class AIService {
  constructor() {
    this.client = null;
    this.model = 'gemini-3-pro-preview';
  }

  _stripCodeFences(text) {
    if (!text) return '';
    return String(text)
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
  }

  _safeJsonParse(text) {
    const cleaned = this._stripCodeFences(text);
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      // Try extracting the first JSON object in the string
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(cleaned.slice(start, end + 1));
        } catch (_) {}
      }
      throw e;
    }
  }

  _getClient() {
    if (!this.client) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY not configured. Add it to your .env file.');
      this.client = new GoogleGenAI({ apiKey });
    }
    return this.client;
  }

  // Analyze a stock with AI — DEEP analysis using Screener.in + MoneyControl + NSE data + Technical Analysis
  async analyzeStock(symbol) {
    try {
      // Fetch ALL data sources in parallel
      const [quote, fundamentals, externalData, chartData] = await Promise.all([
        marketService.getQuote(symbol),
        marketService.getFundamentals(symbol),
        screenerService.getFullAnalysisData(symbol),
        marketService.getHistorical(symbol, 'NSE', '1y', '1d').catch(() => [])
      ]);

      const sc = externalData.screener;
      const mc = externalData.moneycontrol;

      // Calculate technical indicators from chart candles
      let tech = null;
      if (chartData && chartData.length > 5) {
        try {
          tech = technicalService.calculateIndicators(chartData);
        } catch (e) { console.error('Technical calc error:', e.message); }
      }

      // Build comprehensive data prompt
      let dataText = `Stock: ${symbol} (${fundamentals.name || mc?.name || ''})
Current Price: ₹${quote.price || mc?.price || 0}
Day Change: ${(quote.changePercent || mc?.changePercent || 0).toFixed(2)}%
Market Cap: ₹${mc?.marketCapCr || (fundamentals.marketCap ? (fundamentals.marketCap / 10000000).toFixed(0) : 'N/A')} Cr
Sector: ${mc?.sector || fundamentals.sector || 'N/A'}
Cap Category: ${fundamentals.capCategory || 'N/A'}

=== FUNDAMENTAL ANALYSIS (P&L + Balance Sheet) ===
P/E Ratio: ${mc?.peConsolidated || fundamentals.pe || sc?.ratios?.pe || 'N/A'} (Industry P/E: ${mc?.industryPE || 'N/A'})
P/B Ratio: ${mc?.pbConsolidated || fundamentals.pb || 'N/A'}
EPS (TTM): ₹${mc?.epsConsolidated || fundamentals.eps || 'N/A'}
Book Value: ₹${mc?.bookValueConsolidated || sc?.ratios?.bookValue || fundamentals.bookValue || 'N/A'}
Dividend Yield: ${mc?.dividendYieldConsolidated || sc?.ratios?.dividendYield || fundamentals.dividendYield || 0}%
ROE: ${sc?.ratios?.roe || fundamentals.roe || 'N/A'}%
ROCE: ${sc?.ratios?.roce || 'N/A'}%
Debt/Equity: ${fundamentals.debtToEquity || 'N/A'}
Current Ratio: ${fundamentals.currentRatio || 'N/A'}
Revenue Growth: ${fundamentals.revenueGrowth || 'N/A'}%
Profit Margin: ${fundamentals.profitMargin || 'N/A'}%
Operating Margin: ${fundamentals.operatingMargin || 'N/A'}%
Face Value: ₹${mc?.faceValue || sc?.ratios?.faceValue || 'N/A'}
52-Week High: ₹${mc?.high52 || fundamentals.fiftyTwoWeekHigh || 'N/A'}
52-Week Low: ₹${mc?.low52 || fundamentals.fiftyTwoWeekLow || 'N/A'}
Beta: ${fundamentals.beta || 'N/A'}
Health Score: ${fundamentals.healthScore || 'N/A'}/100`;

      // Add MoneyControl SMA/CAGR/performance data
      if (mc) {
        dataText += `\n\n=== MOVING AVERAGES & PRICE PERFORMANCE (MoneyControl) ===
SMA 5-Day: ₹${mc.sma5}
SMA 30-Day: ₹${mc.sma30}
SMA 50-Day: ₹${mc.sma50} (Price ${mc.aboveSma50 ? 'ABOVE' : 'BELOW'} SMA50)
SMA 150-Day: ₹${mc.sma150}
SMA 200-Day: ₹${mc.sma200} (Price ${mc.aboveSma200 ? 'ABOVE' : 'BELOW'} SMA200)
Volume: ${mc.volume?.toLocaleString()} | Delivery %: ${mc.deliveryPercent}%

1 Week: ${mc.change1w}% | 1 Month: ${mc.change1m}% | 3 Months: ${mc.change3m}%
6 Months: ${mc.change6m}% | 1 Year: ${mc.change1y}% | YTD: ${mc.changeYtd}%
CAGR 1Y: ${mc.cagr1Y}% | 3Y: ${mc.cagr3Y}% | 5Y: ${mc.cagr5Y}% | 10Y: ${mc.cagr10Y}%`;
      }

      // Add LIVE Technical Analysis from chart candles
      if (tech) {
        const closes = chartData.map(c => c.close);
        const latestClose = closes[closes.length - 1];
        const rsiValues = tech.rsi?.values?.filter(v => v !== null);
        const latestRSI = rsiValues?.length ? rsiValues[rsiValues.length - 1] : null;
        const macdVals = tech.macd;
        const latestMACD = macdVals?.macd ? macdVals.macd.filter(v => v !== null).slice(-1)[0] : null;
        const latestSignal = macdVals?.signal ? macdVals.signal.filter(v => v !== null).slice(-1)[0] : null;
        const latestHistogram = macdVals?.histogram ? macdVals.histogram.filter(v => v !== null).slice(-1)[0] : null;
        const stochK = tech.stochastic?.k?.filter(v => v !== null);
        const stochD = tech.stochastic?.d?.filter(v => v !== null);
        const bb = tech.bollinger;
        const latestBBUpper = bb?.upper?.filter(v => v !== null).slice(-1)[0];
        const latestBBLower = bb?.lower?.filter(v => v !== null).slice(-1)[0];
        const latestBBMiddle = bb?.middle?.filter(v => v !== null).slice(-1)[0];

        dataText += `\n\n=== LIVE TECHNICAL ANALYSIS (Calculated from 1Y daily candles) ===
Trend: ${tech.trend?.trend || 'N/A'} (Strength: ${tech.trend?.strength || 0}%)
Price vs SMA20: ${tech.trend?.priceVsSMA20 || 'N/A'}%
Price vs SMA50: ${tech.trend?.priceVsSMA50 || 'N/A'}%
RSI (14): ${latestRSI?.toFixed(1) || 'N/A'} ${latestRSI ? (latestRSI > 70 ? '[OVERBOUGHT]' : latestRSI < 30 ? '[OVERSOLD]' : '[NEUTRAL]') : ''}
MACD Line: ${latestMACD?.toFixed(2) || 'N/A'} | Signal: ${latestSignal?.toFixed(2) || 'N/A'} | Histogram: ${latestHistogram?.toFixed(2) || 'N/A'} ${latestHistogram > 0 ? '[BULLISH]' : '[BEARISH]'}
Stochastic %K: ${stochK?.length ? stochK[stochK.length - 1]?.toFixed(1) : 'N/A'} | %D: ${stochD?.length ? stochD[stochD.length - 1]?.toFixed(1) : 'N/A'}
Bollinger Bands: Upper ₹${latestBBUpper?.toFixed(1) || 'N/A'} | Middle ₹${latestBBMiddle?.toFixed(1) || 'N/A'} | Lower ₹${latestBBLower?.toFixed(1) || 'N/A'}`;

        // Support & Resistance
        if (tech.supportResistance) {
          const sr = tech.supportResistance;
          if (sr.support?.length) dataText += `\nSupport Levels: ${sr.support.map(s => '₹' + s).join(', ')}`;
          if (sr.resistance?.length) dataText += `\nResistance Levels: ${sr.resistance.map(r => '₹' + r).join(', ')}`;
        }

        // Candlestick Patterns (last 5 detected)
        if (tech.patterns?.length) {
          const recentPatterns = tech.patterns.slice(-5);
          dataText += `\n\n=== CANDLESTICK PATTERNS DETECTED ===`;
          recentPatterns.forEach(p => {
            dataText += `\n${p.date}: ${p.pattern} (${p.type}) — reliability: ${p.reliability}`;
          });
        }

        // Volume analysis
        const volumes = chartData.map(c => c.volume).filter(v => v > 0);
        if (volumes.length > 20) {
          const volSMA = tech.volumeSMA?.sma20;
          const latestVol = volumes[volumes.length - 1];
          const avgVol = volSMA ? volSMA.filter(v => v !== null).slice(-1)[0] : null;
          if (avgVol) {
            const volRatio = (latestVol / avgVol).toFixed(2);
            dataText += `\nVolume: ${latestVol?.toLocaleString()} (${volRatio}x of 20-day avg) ${parseFloat(volRatio) > 1.5 ? '[HIGH VOLUME]' : parseFloat(volRatio) < 0.5 ? '[LOW VOLUME]' : '[NORMAL]'}`;
          }
        }
      }

      // Add Screener.in deep data
      if (sc) {
        if (sc.pros?.length) {
          dataText += `\n\n=== SCREENER.IN PROS ===\n${sc.pros.map(p => `• ${p}`).join('\n')}`;
        }
        if (sc.cons?.length) {
          dataText += `\n\n=== SCREENER.IN CONS ===\n${sc.cons.map(c => `• ${c}`).join('\n')}`;
        }
        if (sc.growth) {
          dataText += `\n\n=== GROWTH RATES (Screener) ===`;
          if (sc.growth.salesGrowth) dataText += `\nSales Growth: 3Y: ${sc.growth.salesGrowth['3yr'] || 'N/A'}%, 5Y: ${sc.growth.salesGrowth['5yr'] || 'N/A'}%, 10Y: ${sc.growth.salesGrowth['10yr'] || 'N/A'}%, TTM: ${sc.growth.salesGrowth.ttm || 'N/A'}%`;
          if (sc.growth.profitGrowth) dataText += `\nProfit Growth: 3Y: ${sc.growth.profitGrowth['3yr'] || 'N/A'}%, 5Y: ${sc.growth.profitGrowth['5yr'] || 'N/A'}%, TTM: ${sc.growth.profitGrowth.ttm || 'N/A'}%`;
          if (sc.growth.roeHistory) dataText += `\nROE: 3Y Avg: ${sc.growth.roeHistory['3yr'] || 'N/A'}%, 5Y Avg: ${sc.growth.roeHistory['5yr'] || 'N/A'}%, Last Year: ${sc.growth.roeHistory.lastYear || 'N/A'}%`;
          if (sc.growth.priceCagr) dataText += `\nPrice CAGR: 1Y: ${sc.growth.priceCagr['1yr'] || 'N/A'}%, 3Y: ${sc.growth.priceCagr['3yr'] || 'N/A'}%, 5Y: ${sc.growth.priceCagr['5yr'] || 'N/A'}%`;
        }
        if (sc.quarterlyResults?.length) {
          dataText += `\n\n=== LATEST QUARTERLY RESULTS ===`;
          sc.quarterlyResults.forEach(q => {
            const changeDir = q.latest > q.previous ? '▲' : '▼';
            const changePct = q.previous ? ((q.latest - q.previous) / Math.abs(q.previous) * 100).toFixed(1) : 'N/A';
            dataText += `\n${q.metric}: ₹${q.latest} (${changeDir} ${changePct}% QoQ from ₹${q.previous})`;
          });
        }
        if (sc.shareholding && Object.keys(sc.shareholding).length > 0) {
          dataText += `\n\n=== SHAREHOLDING PATTERN ===`;
          if (sc.shareholding.promoters) dataText += `\nPromoters: ${sc.shareholding.promoters}%`;
          if (sc.shareholding.fiis) dataText += `\nFIIs: ${sc.shareholding.fiis}%`;
          if (sc.shareholding.diis) dataText += `\nDIIs: ${sc.shareholding.diis}%`;
          if (sc.shareholding.public) dataText += `\nPublic: ${sc.shareholding.public}%`;
        }
        if (sc.peers?.length) {
          dataText += `\n\n=== PEER COMPARISON ===`;
          sc.peers.slice(0, 5).forEach(p => {
            dataText += `\n${p.name}: Price ₹${p.price}, P/E ${p.pe}, ROCE ${p.roce}%`;
          });
        }
        if (sc.about) {
          dataText += `\n\n=== ABOUT ===\n${sc.about}`;
        }
      }

      const prompt = `You are TradeBot — a beginner-friendly Indian market research assistant.

GOAL
Explain the research in very simple English that a complete beginner can understand.

RULES (STRICT)
- Use ₹ (INR) only. Never use $.
- Keep sentences short. Avoid jargon.
- If you MUST mention a technical term (like P/E, ROE, RSI), explain it in simple words in the same line.
- Use ONLY the data provided below. Do NOT invent numbers. If data is missing, say "Not enough data".
- This is educational research for paper trading. Include a short disclaimer.

WHAT TO OUTPUT
Return ONLY valid JSON (no markdown). Keep the fields short, clear, and beginner-friendly.

DATA
${dataText}

OUTPUT JSON SCHEMA (EXACT KEYS)
{
  "action": "BUY/SELL/HOLD/AVOID",
  "actionConfidence": "HIGH/MEDIUM/LOW",
  "actionReason": "One clear line a beginner understands",

  "beginnerSummary": "2-3 short sentences, no jargon",
  "summary": "Same as beginnerSummary (kept for UI compatibility)",

  "recommendation": "BUY/HOLD/SELL/AVOID",
  "confidenceLevel": "HIGH/MEDIUM/LOW",
  "riskLevel": "LOW/MEDIUM/HIGH",

  "targetPrice": null,
  "targetTimeline": "Not enough data",
  "stopLoss": null,
  "riskRewardRatio": "Not enough data",

  "fundamentalVerdict": "STRONG/GOOD/AVERAGE/WEAK — 1 short line why",
  "technicalVerdict": "BULLISH/NEUTRAL/BEARISH — 1 short line why",
  "rsiSignal": "OVERBOUGHT/OVERSOLD/NEUTRAL — 1 short line",
  "macdSignal": "BULLISH/BEARISH/NEUTRAL — 1 short line",
  "volumeSignal": "HIGH/NORMAL/LOW — 1 short line",
  "candlestickSignal": "1 short line or Not enough data",
  "trendAnalysis": "2-3 short sentences: trend + key levels",
  "supportLevels": [0],
  "resistanceLevels": [0],

  "whatThisIs": "1 sentence: what the company/ETF does (or Not enough data)",
  "whyThisCall": ["reason 1", "reason 2", "reason 3"],
  "keyRisks": ["risk 1", "risk 2"],
  "whatToWatchNext": ["watch item 1", "watch item 2"],
  "strengths": ["short strength 1", "short strength 2"],
  "weaknesses": ["short weakness 1", "short weakness 2"],

  "peerComparison": "1-2 short sentences or Not enough data",
  "quarterlyTrend": "1-2 short sentences or Not enough data",
  "shareholdingInsight": "1-2 short sentences or Not enough data",

  "traderAdvice": {
    "scalper": "1 short line",
    "intraday": "1 short line",
    "swingTrader": "1 short line",
    "longTermInvestor": "1 short line"
  },

  "detailedAnalysis": "4-8 short bullet-like sentences grouped in 2-4 paragraphs. Very simple English.",
  "keyInsight": "1 beginner-friendly takeaway",
  "disclaimer": "1 sentence disclaimer"
}`;

      const client = this._getClient();
      const response = await client.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: 'low' }
        }
      });

      const analysis = this._safeJsonParse(response.text);

      // Build technical summary for frontend
      let technicalSummary = null;
      if (tech) {
        const rsiValues = tech.rsi?.values?.filter(v => v !== null);
        const lastRSI = rsiValues?.length ? rsiValues[rsiValues.length - 1] : null;
        const lastMACD = tech.macd?.histogram?.filter(v => v !== null).slice(-1)[0];
        technicalSummary = {
          trend: tech.trend?.trend,
          trendStrength: tech.trend?.strength,
          rsi: lastRSI ? parseFloat(lastRSI.toFixed(1)) : null,
          macdHistogram: lastMACD ? parseFloat(lastMACD.toFixed(2)) : null,
          support: tech.supportResistance?.support || [],
          resistance: tech.supportResistance?.resistance || [],
          patterns: (tech.patterns || []).slice(-5).map(p => ({ pattern: p.pattern, type: p.type, date: p.date, reliability: p.reliability }))
        };
      }

      const asOf = quote?.timestamp || new Date().toISOString();

      const safeUpper = (v, fallback) => {
        const s = (v ?? fallback ?? '').toString().trim();
        return s ? s.toUpperCase() : (fallback || '');
      };

      const toNumberOrNull = (v) => {
        const n = typeof v === 'number' ? v : (v === null || v === undefined ? NaN : Number(v));
        return Number.isFinite(n) ? n : null;
      };

      const toStringOrNotEnoughData = (v) => {
        const s = (v ?? '').toString().trim();
        return s ? s : 'Not enough data';
      };

      const toStringArray = (v) => {
        if (!Array.isArray(v)) return [];
        return v.map(x => (x ?? '').toString().trim()).filter(Boolean);
      };

      const toNumberArray = (v) => {
        if (!Array.isArray(v)) return [];
        return v.map(x => Number(x)).filter(n => Number.isFinite(n));
      };

      const normalized = {
        ...analysis,
        // Always present core fields
        beginnerSummary: (analysis.beginnerSummary || analysis.summary || analysis.actionReason || '').toString().trim(),
        summary: (analysis.summary || analysis.beginnerSummary || analysis.actionReason || '').toString().trim(),
        recommendation: safeUpper(analysis.recommendation || analysis.action, 'HOLD'),
        action: safeUpper(analysis.action || analysis.recommendation, 'HOLD'),
        confidenceLevel: safeUpper(analysis.confidenceLevel || analysis.actionConfidence, 'MEDIUM'),
        actionConfidence: safeUpper(analysis.actionConfidence || analysis.confidenceLevel, 'MEDIUM'),
        riskLevel: safeUpper(analysis.riskLevel, 'MEDIUM'),

        // Targets/levels (keep numeric values nullable)
        targetPrice: toNumberOrNull(analysis.targetPrice),
        stopLoss: toNumberOrNull(analysis.stopLoss),
        targetTimeline: toStringOrNotEnoughData(analysis.targetTimeline),
        riskRewardRatio: toStringOrNotEnoughData(analysis.riskRewardRatio),

        // Arrays
        whyThisCall: toStringArray(analysis.whyThisCall),
        keyRisks: toStringArray(analysis.keyRisks),
        whatToWatchNext: toStringArray(analysis.whatToWatchNext),
        strengths: toStringArray(analysis.strengths),
        weaknesses: toStringArray(analysis.weaknesses),

        // UI expects these strings
        whatThisIs: toStringOrNotEnoughData(analysis.whatThisIs),
        keyInsight: toStringOrNotEnoughData(analysis.keyInsight),
        disclaimer: toStringOrNotEnoughData(analysis.disclaimer),
        detailedAnalysis: (analysis.detailedAnalysis || '').toString().trim(),

        // Technical labels + levels
        fundamentalVerdict: (analysis.fundamentalVerdict || '').toString().trim(),
        technicalVerdict: (analysis.technicalVerdict || '').toString().trim(),
        rsiSignal: (analysis.rsiSignal || '').toString().trim(),
        macdSignal: (analysis.macdSignal || '').toString().trim(),
        volumeSignal: (analysis.volumeSignal || '').toString().trim(),
        candlestickSignal: (analysis.candlestickSignal || '').toString().trim(),
        trendAnalysis: (analysis.trendAnalysis || '').toString().trim(),
        supportLevels: toNumberArray(analysis.supportLevels),
        resistanceLevels: toNumberArray(analysis.resistanceLevels),

        // Optional narrative fields
        peerComparison: (analysis.peerComparison || '').toString().trim(),
        quarterlyTrend: (analysis.quarterlyTrend || '').toString().trim(),
        shareholdingInsight: (analysis.shareholdingInsight || '').toString().trim(),
        traderAdvice: typeof analysis.traderAdvice === 'object' && analysis.traderAdvice ? analysis.traderAdvice : null,

        asOf,
        currency: 'INR'
      };

      // Deterministic fallbacks so the UI doesn't show blanks
      if (!normalized.beginnerSummary) normalized.beginnerSummary = normalized.summary || normalized.actionReason || 'Not enough data';
      if (!normalized.summary) normalized.summary = normalized.beginnerSummary || normalized.actionReason || 'Not enough data';

      if (!normalized.detailedAnalysis) {
        const bullets = [];
        if (normalized.whyThisCall?.length) bullets.push(`Why: ${normalized.whyThisCall.slice(0, 3).join('; ')}`);
        if (normalized.keyRisks?.length) bullets.push(`Risks: ${normalized.keyRisks.slice(0, 3).join('; ')}`);
        if (normalized.whatToWatchNext?.length) bullets.push(`Watch: ${normalized.whatToWatchNext.slice(0, 3).join('; ')}`);
        normalized.detailedAnalysis = bullets.length ? bullets.join('\n\n') : normalized.beginnerSummary;
      }

      // Fill levels/signals from calculated indicators when AI omitted them
      if (technicalSummary) {
        if (!normalized.supportLevels?.length && Array.isArray(technicalSummary.support)) normalized.supportLevels = technicalSummary.support;
        if (!normalized.resistanceLevels?.length && Array.isArray(technicalSummary.resistance)) normalized.resistanceLevels = technicalSummary.resistance;

        if (!normalized.trendAnalysis && technicalSummary.trend) {
          normalized.trendAnalysis = `Trend looks like ${technicalSummary.trend}. Key support/resistance levels are shown above.`;
        }

        if (!normalized.rsiSignal && typeof technicalSummary.rsi === 'number') {
          normalized.rsiSignal = technicalSummary.rsi > 70 ? 'OVERBOUGHT — price may cool down' : technicalSummary.rsi < 30 ? 'OVERSOLD — price may bounce' : 'NEUTRAL — no extreme signal';
        }

        if (!normalized.macdSignal && typeof technicalSummary.macdHistogram === 'number') {
          normalized.macdSignal = technicalSummary.macdHistogram > 0 ? 'BULLISH — momentum improving' : technicalSummary.macdHistogram < 0 ? 'BEARISH — momentum weakening' : 'NEUTRAL — mixed momentum';
        }

        if (!normalized.technicalVerdict && technicalSummary.trend) {
          const t = technicalSummary.trend.toString().toUpperCase();
          normalized.technicalVerdict = t.includes('UP') ? 'BULLISH — trend is up' : t.includes('DOWN') ? 'BEARISH — trend is down' : 'NEUTRAL — trend is mixed';
        }
      }

      if (!normalized.fundamentalVerdict) normalized.fundamentalVerdict = 'AVERAGE — Not enough data';
      if (!normalized.volumeSignal) normalized.volumeSignal = 'NORMAL — Not enough data';
      if (!normalized.candlestickSignal) normalized.candlestickSignal = 'Not enough data';

      if (!normalized.strengths?.length) normalized.strengths = ['Not enough data'];
      if (!normalized.weaknesses?.length) normalized.weaknesses = ['Not enough data'];

      return {
        ...normalized,
        stock: quote,
        fundamentals,
        technicalSummary,
        dataSources: {
          screener: !!sc,
          moneycontrol: !!mc,
          nse: true,
          technicals: !!tech
        },
        screenerData: sc ? {
          pros: sc.pros,
          cons: sc.cons,
          growth: sc.growth,
          shareholding: sc.shareholding,
          peers: sc.peers,
          quarterlyResults: sc.quarterlyResults
        } : null,
        moneycontrolData: mc ? {
          pe: mc.peConsolidated,
          industryPE: mc.industryPE,
          pb: mc.pbConsolidated,
          eps: mc.epsConsolidated,
          dividendYield: mc.dividendYieldConsolidated,
          sma5: mc.sma5,
          sma30: mc.sma30,
          sma50: mc.sma50,
          sma150: mc.sma150,
          sma200: mc.sma200,
          aboveSma50: mc.aboveSma50,
          aboveSma200: mc.aboveSma200,
          deliveryPercent: mc.deliveryPercent,
          cagr1Y: mc.cagr1Y,
          cagr3Y: mc.cagr3Y,
          cagr5Y: mc.cagr5Y,
          cagr10Y: mc.cagr10Y,
          change1w: mc.change1w,
          change1m: mc.change1m,
          change3m: mc.change3m,
          change6m: mc.change6m,
          change1y: mc.change1y,
          changeYtd: mc.changeYtd
        } : null
      };
    } catch (error) {
      console.error('AI analysis error:', error.message);
      return this._getFallbackAnalysis(symbol);
    }
  }

  // Compare two stocks
  async compareStocks(symbol1, symbol2) {
    try {
      const [fund1, fund2] = await Promise.all([
        marketService.getFundamentals(symbol1),
        marketService.getFundamentals(symbol2)
      ]);

      const prompt = `Compare these two Indian stocks for a beginner investor:

Stock 1: ${symbol1} (${fund1.name})
Price: ₹${fund1.price}, P/E: ${fund1.pe?.toFixed(2)}, ROE: ${fund1.roe?.toFixed(2)}%, D/E: ${fund1.debtToEquity?.toFixed(2)}, MarketCap: ₹${(fund1.marketCap/10000000).toFixed(0)}Cr

Stock 2: ${symbol2} (${fund2.name})
Price: ₹${fund2.price}, P/E: ${fund2.pe?.toFixed(2)}, ROE: ${fund2.roe?.toFixed(2)}%, D/E: ${fund2.debtToEquity?.toFixed(2)}, MarketCap: ₹${(fund2.marketCap/10000000).toFixed(0)}Cr

Return ONLY valid JSON:
{
  "winner": "${symbol1} or ${symbol2}",
  "comparison": "2-3 sentence comparison",
  "metrics": {
    "valuation": "${symbol1} or ${symbol2}",
    "profitability": "${symbol1} or ${symbol2}",
    "safety": "${symbol1} or ${symbol2}",
    "growth": "${symbol1} or ${symbol2}"
  },
  "verdict": "Brief verdict for beginners"
}`;

      const client = this._getClient();
      const response = await client.models.generateContent({
        model: this.model,
        contents: prompt
      });

      const text = response.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return { ...JSON.parse(text), stock1: fund1, stock2: fund2 };
    } catch (error) {
      console.error('AI compare error:', error.message);
      return { error: 'AI comparison unavailable', stock1: null, stock2: null };
    }
  }

  // Chat with AI about markets
  async chat(message, context = {}) {
    try {
      const prompt = `You are a friendly Indian stock market tutor named "TradeGuru AI". 
You help complete beginners learn about trading and investing in the Indian stock market (NSE/BSE).
Keep responses concise (2-4 paragraphs max), use simple language, relatable Indian examples.
Use ₹ for currency. Reference real Indian companies/indices when helpful.

${context.portfolio ? `User's portfolio: Balance ₹${context.portfolio.balance}, ${context.portfolio.holdingsCount || 0} stocks held.` : ''}

User's question: ${message}

Answer helpfully and encourage learning. If they ask something dangerous (like "guaranteed returns"), warn them appropriately.`;

      const client = this._getClient();
      const response = await client.models.generateContent({
        model: this.model,
        contents: prompt
      });

      return { response: response.text, type: 'chat' };
    } catch (error) {
      console.error('AI chat error:', error.message);
      return {
        response: "I'm having trouble connecting right now. Here's a tip: Always research a company's fundamentals (P/E, ROE, Debt/Equity) before investing. Start with index funds if you're unsure!",
        type: 'fallback'
      };
    }
  }

  // Market sentiment analysis
  async getMarketSentiment() {
    try {
      const indices = await marketService.getIndices();
      const gainersLosers = await marketService.getGainersLosers();

      const prompt = `Analyze current Indian market sentiment:
NIFTY 50: ${indices.nifty50.value} (${indices.nifty50.changePercent?.toFixed(2)}%)
SENSEX: ${indices.sensex.value} (${indices.sensex.changePercent?.toFixed(2)}%)
Top gainers count: ${gainersLosers.gainers.length}
Top losers count: ${gainersLosers.losers.length}

Return ONLY valid JSON:
{
  "sentiment": "BULLISH/BEARISH/NEUTRAL",
  "score": 1-100,
  "summary": "2 sentence market summary",
  "advice": "Brief advice for beginners",
  "sectorTrends": ["trending sector 1", "trending sector 2"]
}`;

      const client = this._getClient();
      const response = await client.models.generateContent({
        model: this.model,
        contents: prompt
      });

      const text = response.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(text);
    } catch (error) {
      return {
        sentiment: 'NEUTRAL',
        score: 50,
        summary: 'Market data is being analyzed. Check back shortly.',
        advice: 'Focus on long-term investing with diversified stocks.',
        sectorTrends: ['Banking', 'IT']
      };
    }
  }

  // Get learning explanation for a concept
  async explainConcept(concept) {
    try {
      const prompt = `Explain "${concept}" for an Indian stock market beginner. 
Use simple Hindi-English mixed explanations like a friend would explain.
Include a real Indian market example.
Keep it under 200 words.
Format with clear paragraphs.`;

      const client = this._getClient();
      const response = await client.models.generateContent({
        model: this.model,
        contents: prompt
      });

      return { concept, explanation: response.text };
    } catch (error) {
      return { concept, explanation: `${concept} is an important market concept. Please check our education section for detailed explanations.` };
    }
  }

  // Portfolio analysis
  async analyzePortfolio(holdings, balance) {
    try {
      if (!holdings || holdings.length === 0) {
        return {
          analysis: "Your portfolio is empty! Start by investing in well-known large-cap stocks or index funds.",
          diversification: "N/A",
          risk: "NONE",
          suggestions: ["Start with NIFTY 50 index stocks", "Invest in 5-10 different sectors", "Keep 20% as cash reserve"]
        };
      }

      const holdingsSummary = holdings.map(h =>
        `${h.symbol}: ${h.quantity} shares @ ₹${h.avg_price?.toFixed(2)}, Current: ₹${h.currentPrice?.toFixed(2)}, P&L: ${h.pnlPercent?.toFixed(2)}%`
      ).join('\n');

      const prompt = `Analyze this Indian stock market portfolio for a beginner:

Holdings:
${holdingsSummary}

Cash Balance: ₹${balance}

Return ONLY valid JSON:
{
  "analysis": "2-3 sentence portfolio overview",
  "diversification": "GOOD/MODERATE/POOR",
  "risk": "LOW/MEDIUM/HIGH",
  "suggestions": ["suggestion1", "suggestion2", "suggestion3"],
  "topPerformer": "symbol",
  "concern": "main concern if any"
}`;

      const client = this._getClient();
      const response = await client.models.generateContent({
        model: this.model,
        contents: prompt
      });

      const text = response.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(text);
    } catch (error) {
      return {
        analysis: "Portfolio analysis temporarily unavailable.",
        diversification: "UNKNOWN",
        risk: "UNKNOWN",
        suggestions: ["Diversify across sectors", "Don't put all eggs in one basket", "Review quarterly"]
      };
    }
  }

  _getFallbackAnalysis(symbol) {
    return {
      beginnerSummary: `${symbol} analysis is temporarily unavailable right now. Please try again later.`,
      summary: `${symbol} analysis is temporarily unavailable right now. Please try again later.`,
      strengths: ['Data unavailable'],
      weaknesses: ['Data unavailable'],
      recommendation: 'HOLD',
      confidenceLevel: 'LOW',
      targetPrice: null,
      riskLevel: 'MEDIUM',
      keyInsight: 'Always do your own research before investing.',
      fundamentalRating: 'UNKNOWN',
      sectorOutlook: 'Check latest market news.',
      asOf: new Date().toISOString(),
      currency: 'INR'
    };
  }
}

module.exports = new AIService();
