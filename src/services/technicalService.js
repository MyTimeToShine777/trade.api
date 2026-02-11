const { SMA, EMA, RSI, BollingerBands, MACD, Stochastic } = require('technicalindicators');

class TechnicalService {
  // Calculate all indicators for chart overlay
  calculateIndicators(candles, options = {}) {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);

    return {
      sma: this.calculateSMA(closes, options.smaPeriods || [20, 50, 200]),
      ema: this.calculateEMA(closes, options.emaPeriods || [12, 26]),
      rsi: this.calculateRSI(closes, options.rsiPeriod || 14),
      bollinger: this.calculateBollinger(closes, options.bollingerPeriod || 20),
      macd: this.calculateMACD(closes),
      stochastic: this.calculateStochastic(highs, lows, closes),
      volumeSMA: this.calculateSMA(volumes, [20]),
      patterns: this.detectPatterns(candles),
      trend: this.detectTrend(closes),
      supportResistance: this.findSupportResistance(candles)
    };
  }

  calculateSMA(values, periods) {
    const result = {};
    for (const period of periods) {
      const sma = SMA.calculate({ values, period });
      // Pad with nulls to align with original data
      const padding = new Array(values.length - sma.length).fill(null);
      result[`sma${period}`] = [...padding, ...sma];
    }
    return result;
  }

  calculateEMA(values, periods) {
    const result = {};
    for (const period of periods) {
      const ema = EMA.calculate({ values, period });
      const padding = new Array(values.length - ema.length).fill(null);
      result[`ema${period}`] = [...padding, ...ema];
    }
    return result;
  }

  calculateRSI(values, period = 14) {
    const rsi = RSI.calculate({ values, period });
    const padding = new Array(values.length - rsi.length).fill(null);
    return {
      values: [...padding, ...rsi],
      overbought: 70,
      oversold: 30
    };
  }

  calculateBollinger(values, period = 20) {
    const bb = BollingerBands.calculate({ values, period, stdDev: 2 });
    const padding = new Array(values.length - bb.length).fill(null);
    return {
      upper: [...padding, ...bb.map(b => b.upper)],
      middle: [...padding, ...bb.map(b => b.middle)],
      lower: [...padding, ...bb.map(b => b.lower)]
    };
  }

  calculateMACD(values) {
    const macd = MACD.calculate({
      values,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });
    const padding = new Array(values.length - macd.length).fill(null);
    return {
      macd: [...padding, ...macd.map(m => m.MACD || 0)],
      signal: [...padding, ...macd.map(m => m.signal || 0)],
      histogram: [...padding, ...macd.map(m => m.histogram || 0)]
    };
  }

  calculateStochastic(highs, lows, closes) {
    const stoch = Stochastic.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
      signalPeriod: 3
    });
    const padding = new Array(closes.length - stoch.length).fill(null);
    return {
      k: [...padding, ...stoch.map(s => s.k)],
      d: [...padding, ...stoch.map(s => s.d)]
    };
  }

  // Detect candlestick patterns from Video 1
  detectPatterns(candles) {
    const patterns = [];
    for (let i = 1; i < candles.length; i++) {
      const curr = candles[i];
      const prev = candles[i - 1];
      const body = Math.abs(curr.close - curr.open);
      const upperWick = curr.high - Math.max(curr.close, curr.open);
      const lowerWick = Math.min(curr.close, curr.open) - curr.low;
      const totalRange = curr.high - curr.low;

      if (totalRange === 0) continue;

      // Marubozu - strong trend candle
      if (body / totalRange > 0.9) {
        patterns.push({
          index: i,
          date: curr.date,
          pattern: 'Marubozu',
          type: curr.close > curr.open ? 'bullish' : 'bearish',
          reliability: 'high'
        });
      }

      // Hammer - bullish reversal at bottom
      if (lowerWick >= body * 2 && upperWick < body * 0.3 && body > 0) {
        patterns.push({
          index: i,
          date: curr.date,
          pattern: 'Hammer',
          type: 'bullish',
          reliability: 'medium'
        });
      }

      // Shooting Star - bearish reversal at top
      if (upperWick >= body * 2 && lowerWick < body * 0.3 && body > 0) {
        patterns.push({
          index: i,
          date: curr.date,
          pattern: 'Shooting Star',
          type: 'bearish',
          reliability: 'medium'
        });
      }

      // Doji - indecision
      if (body / totalRange < 0.1 && totalRange > 0) {
        let dojiType = 'Doji';
        if (lowerWick > upperWick * 2) dojiType = 'Dragonfly Doji';
        if (upperWick > lowerWick * 2) dojiType = 'Gravestone Doji';
        patterns.push({
          index: i,
          date: curr.date,
          pattern: dojiType,
          type: 'neutral',
          reliability: 'low'
        });
      }

      // Bullish Engulfing
      if (prev.close < prev.open && curr.close > curr.open &&
          curr.open <= prev.close && curr.close >= prev.open) {
        patterns.push({
          index: i,
          date: curr.date,
          pattern: 'Bullish Engulfing',
          type: 'bullish',
          reliability: 'high'
        });
      }

      // Bearish Engulfing
      if (prev.close > prev.open && curr.close < curr.open &&
          curr.open >= prev.close && curr.close <= prev.open) {
        patterns.push({
          index: i,
          date: curr.date,
          pattern: 'Bearish Engulfing',
          type: 'bearish',
          reliability: 'high'
        });
      }
    }
    return patterns.slice(-20); // Return last 20 patterns
  }

  // Detect overall trend
  detectTrend(closes) {
    if (closes.length < 50) return { trend: 'INSUFFICIENT_DATA', strength: 0 };

    const sma20 = SMA.calculate({ values: closes, period: 20 });
    const sma50 = SMA.calculate({ values: closes, period: 50 });

    const latestPrice = closes[closes.length - 1];
    const latestSMA20 = sma20[sma20.length - 1];
    const latestSMA50 = sma50[sma50.length - 1];

    let trend = 'SIDEWAYS';
    let strength = 0;

    if (latestPrice > latestSMA20 && latestSMA20 > latestSMA50) {
      trend = 'UPTREND';
      strength = Math.min(100, ((latestPrice - latestSMA50) / latestSMA50) * 100);
    } else if (latestPrice < latestSMA20 && latestSMA20 < latestSMA50) {
      trend = 'DOWNTREND';
      strength = Math.min(100, ((latestSMA50 - latestPrice) / latestSMA50) * 100);
    }

    return {
      trend,
      strength: parseFloat(strength.toFixed(2)),
      priceVsSMA20: parseFloat(((latestPrice / latestSMA20 - 1) * 100).toFixed(2)),
      priceVsSMA50: parseFloat(((latestPrice / latestSMA50 - 1) * 100).toFixed(2))
    };
  }

  // Find support and resistance levels
  findSupportResistance(candles) {
    if (candles.length < 20) return { support: [], resistance: [] };

    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const support = [];
    const resistance = [];

    // Find local minima (support) and maxima (resistance)
    for (let i = 5; i < candles.length - 5; i++) {
      const localHighs = highs.slice(i - 5, i + 6);
      const localLows = lows.slice(i - 5, i + 6);

      if (highs[i] === Math.max(...localHighs)) {
        resistance.push(parseFloat(highs[i].toFixed(2)));
      }
      if (lows[i] === Math.min(...localLows)) {
        support.push(parseFloat(lows[i].toFixed(2)));
      }
    }

    // Cluster nearby levels
    return {
      support: this._clusterLevels(support).slice(-3),
      resistance: this._clusterLevels(resistance).slice(-3)
    };
  }

  _clusterLevels(levels) {
    if (levels.length === 0) return [];
    const sorted = [...levels].sort((a, b) => a - b);
    const clusters = [[sorted[0]]];

    for (let i = 1; i < sorted.length; i++) {
      const lastCluster = clusters[clusters.length - 1];
      const avg = lastCluster.reduce((a, b) => a + b, 0) / lastCluster.length;
      if (Math.abs(sorted[i] - avg) / avg < 0.02) { // 2% tolerance
        lastCluster.push(sorted[i]);
      } else {
        clusters.push([sorted[i]]);
      }
    }

    return clusters.map(c => parseFloat((c.reduce((a, b) => a + b, 0) / c.length).toFixed(2)));
  }
}

module.exports = new TechnicalService();
