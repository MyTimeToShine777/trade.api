const marketService = require('./marketService');
const screenerService = require('./screenerService');

class FundamentalService {
  // Score a stock based on 7 key fundamental ratios (Zerodha/Groww style)
  async scoreStock(symbol, exchange = 'NSE') {
    const clean = symbol.toUpperCase().replace(/\.NS$|\.BO$/i, '');
    const [quote, fundamentals, screener] = await Promise.all([
      marketService.getQuote(clean, exchange).catch(() => null),
      marketService.getFundamentals(clean, exchange).catch(() => null),
      screenerService.getCompanyData(clean).catch(() => null)
    ]);

    if (!quote && !fundamentals && !screener) return this._getMockScore(clean);

    const currentPrice = (quote?.price || fundamentals?.price || 0);
    const pe = (screener?.ratios?.pe || fundamentals?.pe || 0);
    const eps = (screener?.ratios?.eps || fundamentals?.eps || 0);
    const debtToEquity = (screener?.ratios?.debtToEquity || fundamentals?.debtToEquity || 0);
    const roe = (screener?.ratios?.roe || fundamentals?.roe || 0);
    const marketCap = (fundamentals?.marketCap || quote?.marketCap || 0);
    const bookValue = (screener?.ratios?.bookValue || fundamentals?.bookValue || 0);
    const priceToBook = (fundamentals?.pb || (bookValue > 0 && currentPrice > 0 ? currentPrice / bookValue : 0));

    const revenueGrowth = (fundamentals?.revenueGrowth || 0);
    const earningsGrowth = 0;
    const profitMargin = (fundamentals?.profitMargin || 0);
    const operatingMargin = (fundamentals?.operatingMargin || 0);
    const currentRatio = (fundamentals?.currentRatio || 0);
    const quickRatio = 0;
    const dividendYield = (screener?.ratios?.dividendYield || fundamentals?.dividendYield || 0);
    const beta = null;
    const high52 = (fundamentals?.fiftyTwoWeekHigh || quote?.fiftyTwoWeekHigh || 0);
    const low52 = (fundamentals?.fiftyTwoWeekLow || quote?.fiftyTwoWeekLow || 0);

    const promoterHolding = Number.isFinite(screener?.shareholding?.promoters) ? Number(screener.shareholding.promoters) : null;
    const fiiHolding = Number.isFinite(screener?.shareholding?.fiis) ? Number(screener.shareholding.fiis) : null;

    // Extract ratios (already normalized above)

    // Cap classification
    let capCategory = 'Small Cap';
    if (marketCap > 200000000000) capCategory = 'Large Cap'; // > 20,000 Cr
    else if (marketCap > 50000000000) capCategory = 'Mid Cap'; // > 5,000 Cr

    // --- SCORING ENGINE ---
    // Each ratio scored 0-10, weighted to get total /100
    const scores = {};

    // 1. EPS Score (0-10)
    scores.eps = { value: eps, score: eps > 50 ? 10 : eps > 30 ? 8 : eps > 15 ? 6 : eps > 5 ? 4 : eps > 0 ? 3 : 1, weight: 12 };

    // 2. PE Ratio Score (lower is better for value) 
    scores.pe = {
      value: pe, weight: 15,
      score: pe <= 0 ? 1 : pe < 10 ? 10 : pe < 15 ? 9 : pe < 20 ? 7 : pe < 25 ? 6 : pe < 35 ? 4 : pe < 50 ? 3 : 1
    };

    // 3. Debt to Equity (lower is better, < 1 ideal)
    scores.debtToEquity = {
      value: debtToEquity, weight: 15,
      score: debtToEquity <= 0 ? 10 : debtToEquity < 0.3 ? 9 : debtToEquity < 0.5 ? 8 : debtToEquity < 0.8 ? 7 : debtToEquity < 1.0 ? 6 : debtToEquity < 1.5 ? 4 : debtToEquity < 2 ? 2 : 1
    };

    // 4. ROE (higher is better, > 15% ideal)
    scores.roe = {
      value: roe, weight: 15,
      score: roe > 25 ? 10 : roe > 20 ? 9 : roe > 15 ? 8 : roe > 10 ? 6 : roe > 5 ? 4 : roe > 0 ? 2 : 1
    };

    // 5. Market Cap (larger = more stable)
    scores.marketCap = {
      value: marketCap, category: capCategory, weight: 8,
      score: capCategory === 'Large Cap' ? 9 : capCategory === 'Mid Cap' ? 7 : 5
    };

    // 6. Book Value vs Price
    scores.bookValue = {
      value: bookValue, weight: 8,
      score: bookValue > 0 && currentPrice > 0 ? (priceToBook < 1 ? 10 : priceToBook < 2 ? 8 : priceToBook < 3 ? 6 : priceToBook < 5 ? 4 : 2) : 3
    };

    // 7. Price to Book (lower = undervalued)
    scores.priceToBook = {
      value: priceToBook, weight: 12,
      score: priceToBook < 1 ? 10 : priceToBook < 1.5 ? 9 : priceToBook < 2.5 ? 7 : priceToBook < 4 ? 5 : priceToBook < 7 ? 3 : 1
    };

    // Additional metrics for comprehensive analysis
    // 8. Profit Margin
    scores.profitMargin = {
      value: profitMargin, weight: 8,
      score: profitMargin > 25 ? 10 : profitMargin > 15 ? 8 : profitMargin > 10 ? 6 : profitMargin > 5 ? 4 : profitMargin > 0 ? 2 : 1
    };

    // 9. Revenue Growth
    scores.revenueGrowth = {
      value: revenueGrowth, weight: 7,
      score: revenueGrowth > 25 ? 10 : revenueGrowth > 15 ? 8 : revenueGrowth > 10 ? 7 : revenueGrowth > 5 ? 5 : revenueGrowth > 0 ? 3 : 1
    };

    // Calculate total weighted score
    let totalWeightedScore = 0;
    let totalWeight = 0;
    for (const [, s] of Object.entries(scores)) {
      totalWeightedScore += s.score * s.weight;
      totalWeight += s.weight;
    }
    const overallScore = Math.round((totalWeightedScore / totalWeight) * 10);

    // Red Flags
    const redFlags = [];
    if (debtToEquity > 1.5) redFlags.push({ flag: 'High Debt', detail: `Debt-to-Equity ratio is ${debtToEquity.toFixed(2)}, significantly above 1.0 threshold`, severity: 'high' });
    if (pe > 50) redFlags.push({ flag: 'Overvalued', detail: `PE ratio of ${pe.toFixed(1)} may indicate overvaluation`, severity: 'medium' });
    if (profitMargin < 0) redFlags.push({ flag: 'Loss Making', detail: `Negative profit margin of ${profitMargin.toFixed(1)}%`, severity: 'high' });
    if (earningsGrowth < -10) redFlags.push({ flag: 'Declining Earnings', detail: `Earnings declining at ${earningsGrowth.toFixed(1)}%`, severity: 'high' });
    if (currentRatio < 1) redFlags.push({ flag: 'Liquidity Risk', detail: `Current ratio of ${currentRatio.toFixed(2)} below 1.0`, severity: 'medium' });
    if (Number.isFinite(promoterHolding) && promoterHolding < 25) redFlags.push({ flag: 'Low Promoter Holding', detail: `Promoters hold only ${promoterHolding.toFixed(1)}%`, severity: 'medium' });
    if (Number.isFinite(beta) && beta > 1.5) redFlags.push({ flag: 'High Volatility', detail: `Beta of ${beta.toFixed(2)} indicates above-average market risk`, severity: 'low' });

    // Green Flags
    const greenFlags = [];
    if (debtToEquity < 0.5 && debtToEquity >= 0) greenFlags.push({ flag: 'Low Debt', detail: `Conservative D/E of ${debtToEquity.toFixed(2)}` });
    if (roe > 20) greenFlags.push({ flag: 'High ROE', detail: `ROE of ${roe.toFixed(1)}% shows efficient capital use` });
    if (revenueGrowth > 15) greenFlags.push({ flag: 'Strong Growth', detail: `Revenue growing at ${revenueGrowth.toFixed(1)}%` });
    if (dividendYield > 2) greenFlags.push({ flag: 'Good Dividend', detail: `Dividend yield of ${dividendYield.toFixed(2)}%` });
    if (profitMargin > 20) greenFlags.push({ flag: 'High Margin', detail: `Profit margin of ${profitMargin.toFixed(1)}%` });

    // Recommendation
    let recommendation = 'HOLD';
    if (overallScore >= 75 && redFlags.filter(r => r.severity === 'high').length === 0) recommendation = 'BUY';
    else if (overallScore >= 60) recommendation = 'HOLD';
    else if (overallScore < 40 || redFlags.filter(r => r.severity === 'high').length >= 2) recommendation = 'SELL';

    return {
      symbol: clean,
      exchange,
      name: quote?.name || fundamentals?.name || screener?.name || clean,
      currentPrice,
      overallScore,
      recommendation,
      capCategory,
      scores,
      ratios: {
        eps, pe, debtToEquity, roe, marketCap, bookValue, priceToBook,
        profitMargin, operatingMargin, revenueGrowth, earningsGrowth,
        currentRatio, quickRatio, dividendYield, beta,
        high52, low52, promoterHolding, fiiHolding
      },
      redFlags,
      greenFlags,
      riskLevel: overallScore >= 70 ? 'Low' : overallScore >= 50 ? 'Moderate' : 'High'
    };
  }

  _getMockScore(symbol) {
    return {
      symbol, exchange: 'NSE', name: symbol, currentPrice: 0,
      overallScore: 65, recommendation: 'HOLD', capCategory: 'Large Cap',
      scores: {}, ratios: {}, redFlags: [], greenFlags: [],
      riskLevel: 'Moderate', isMock: true
    };
  }

  // Compare multiple stocks fundamentally
  async compareStocks(symbols) {
    const results = await Promise.all(symbols.map(s => this.scoreStock(s)));
    const sorted = [...results].sort((a, b) => b.overallScore - a.overallScore);
    return {
      stocks: results,
      ranking: sorted.map((s, i) => ({ rank: i + 1, symbol: s.symbol, score: s.overallScore, recommendation: s.recommendation })),
      bestPick: sorted[0]?.symbol
    };
  }
}

module.exports = new FundamentalService();
