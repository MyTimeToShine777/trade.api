const https = require('https');
const http = require('http');

class ScreenerService {
  constructor() {
    this.cache = new Map();
    this.CACHE_TTL = 30 * 60 * 1000; // 30 min cache
  }

  _getTimeoutForUrl(url) {
    try {
      const host = new URL(url).hostname;
      if (host.includes('screener.in')) return 30000;
      if (host.includes('moneycontrol.com') || host.includes('priceapi.moneycontrol.com')) return 15000;
    } catch {}
    return 15000;
  }

  _shouldRetryFetchError(err) {
    const msg = String(err?.message || '').toLowerCase();
    return (
      msg.includes('aborted') ||
      msg.includes('timeout') ||
      msg.includes('fetch failed') ||
      msg.includes('econnreset') ||
      msg.includes('socket hang up') ||
      msg.includes('etimedout') ||
      msg.includes('enotfound')
    );
  }

  _getCached(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.time < this.CACHE_TTL) return cached.data;
    return null;
  }

  _setCache(key, data) {
    this.cache.set(key, { data, time: Date.now() });
  }

  // Fetch webpage HTML
  async _fetchHTML(url, options = {}) {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : this._getTimeoutForUrl(url);
    const retries = Number.isFinite(options.retries) ? options.retries : 2;
    const maxAttempts = Math.max(1, retries + 1);

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'identity',
      'Connection': 'keep-alive'
    };

    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Prefer fetch (Undici) because some endpoints (Moneycontrol) reject Node's https.get
        if (typeof fetch === 'function') {
          const controller = new AbortController();
          const t = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const res = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
            return await res.text();
          } finally {
            clearTimeout(t);
          }
        }

        // Fallback to https/http
        return await new Promise((resolve, reject) => {
          const protocol = url.startsWith('https') ? https : http;
          const req = protocol.get(url, { headers, timeout: timeoutMs }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              return this._fetchHTML(res.headers.location, options).then(resolve).catch(reject);
            }
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve(data));
          });
          req.on('error', reject);
          req.on('timeout', () => {
            req.destroy();
            reject(new Error('Timeout'));
          });
        });
      } catch (err) {
        lastError = err;
        const retryable = this._shouldRetryFetchError(err);
        if (!retryable || attempt >= maxAttempts) break;
        const delay = 400 * attempt;
        await new Promise(r => setTimeout(r, delay));
      }
    }

    throw lastError || new Error('Fetch failed');
  }

  // Extract text between patterns (simple HTML parsing without dependencies)
  _extractBetween(html, startMarker, endMarker) {
    const startIdx = html.indexOf(startMarker);
    if (startIdx === -1) return '';
    const afterStart = startIdx + startMarker.length;
    const endIdx = html.indexOf(endMarker, afterStart);
    if (endIdx === -1) return html.substring(afterStart);
    return html.substring(afterStart, endIdx);
  }

  // Strip HTML tags
  _stripTags(html) {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Extract number from text
  _extractNumber(text) {
    if (!text) return null;
    const cleaned = text.replace(/,/g, '').replace(/₹/g, '').replace(/Rs\.?/g, '').replace(/Cr\.?/g, '').trim();
    const match = cleaned.match(/-?[\d.]+/);
    return match ? parseFloat(match[0]) : null;
  }

  // Get comprehensive company data from screener.in
  async getCompanyData(symbol) {
    const cacheKey = `screener_${symbol}`;
    const cached = this._getCached(cacheKey);
    if (cached) return cached;

    try {
      const cleanSymbol = symbol.replace(/\.NS$|\.BO$/i, '');
      const url = `https://www.screener.in/company/${cleanSymbol}/consolidated/`;
      const html = await this._fetchHTML(url);

      if (!html || html.length < 1000) {
        // Try standalone
        const url2 = `https://www.screener.in/company/${cleanSymbol}/`;
        const html2 = await this._fetchHTML(url2);
        if (!html2 || html2.length < 1000) {
          return null;
        }
        const data2 = this._parseScreenerHTML(html2, cleanSymbol);
        this._setCache(cacheKey, data2);
        return data2;
      }

      const data = this._parseScreenerHTML(html, cleanSymbol);
      this._setCache(cacheKey, data);
      return data;
    } catch (error) {
      console.error(`Screener fetch error for ${symbol}:`, error.message);
      return null;
    }
  }

  _parseScreenerHTML(html, symbol) {
    const result = {
      symbol,
      source: 'screener.in',
      fetchedAt: new Date().toISOString()
    };

    // ---- Key Ratios from the top section ----
    result.ratios = this._extractKeyRatios(html);

    // ---- Pros and Cons ----
    result.pros = this._extractList(html, 'PROS', 'CONS');
    result.cons = this._extractList(html, 'CONS', 'Peer comparison');

    // ---- Company description ----
    result.about = this._extractAbout(html);

    // ---- Quarterly results ----
    result.quarterlyResults = this._extractQuarterlyResults(html);

    // ---- Growth rates ----
    result.growth = this._extractGrowthRates(html);

    // ---- Shareholding ----
    result.shareholding = this._extractShareholding(html);

    // ---- Peer comparison ----
    result.peers = this._extractPeers(html);

    return result;
  }

  _extractKeyRatios(html) {
    const ratios = {};

    // Screener.in structure: <span class="name">Label</span> ... <span class="number">Value</span>
    // Each ratio is in a <li> with the label in span.name and value in span.number
    // Search full HTML with a bounded lookahead to avoid greedy matching

    const extractRatio = (label) => {
      const re = new RegExp(label + '[\\s\\S]{0,300}?class="number">[\\s]*([-\\d,.]+)[\\s]*<', 'i');
      const m = html.match(re);
      return m ? this._extractNumber(m[1]) : null;
    };

    ratios.marketCapCr = extractRatio('Market\\s*Cap');
    ratios.currentPrice = extractRatio('Current\\s*Price');

    // High / Low has TWO numbers
    const hlRe = /High\s*\/\s*Low[\s\S]{0,300}?class="number">\s*([\d,.]+)\s*<[\s\S]{0,100}?class="number">\s*([\d,.]+)\s*</i;
    const hlMatch = html.match(hlRe);
    if (hlMatch) {
      ratios.fiftyTwoWeekHigh = this._extractNumber(hlMatch[1]);
      ratios.fiftyTwoWeekLow = this._extractNumber(hlMatch[2]);
    }

    ratios.pe = extractRatio('Stock\\s*P\\/E');
    ratios.bookValue = extractRatio('Book\\s*Value');
    ratios.dividendYield = extractRatio('Dividend\\s*Yield');
    ratios.roce = extractRatio('ROCE[^a-zA-Z]');
    ratios.roe = extractRatio('\\bROE[^a-zA-Z]');
    ratios.faceValue = extractRatio('Face\\s*Value');

    return ratios;
  }

  _extractList(html, startSection, endSection) {
    const items = [];
    try {
      const section = this._extractBetween(html, startSection, endSection);
      // Try <li> tags first
      const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let match;
      while ((match = liRegex.exec(section)) !== null) {
        const text = this._stripTags(match[1]).trim();
        if (text && text.length > 5) items.push(text);
      }
      // If no <li> found, try <p> or raw bullet points
      if (items.length === 0) {
        const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
        while ((match = pRegex.exec(section)) !== null) {
          const text = this._stripTags(match[1]).trim();
          if (text && text.length > 10 && !text.startsWith('*')) items.push(text);
        }
      }
      // Fallback: extract from plain text with bullet marks
      if (items.length === 0) {
        const plainText = this._stripTags(section);
        const bullets = plainText.split(/[•·●\n]/).map(s => s.trim()).filter(s => s.length > 10);
        items.push(...bullets.slice(0, 5));
      }
    } catch (e) {}
    return items;
  }

  _extractAbout(html) {
    try {
      // Look for the "about" or company description section
      const aboutMatch = html.match(/ABOUT[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
      if (aboutMatch) return this._stripTags(aboutMatch[1]).substring(0, 500);
      
      // Fallback: look for description meta tag
      const metaMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
      if (metaMatch) return metaMatch[1];
    } catch (e) {}
    return '';
  }

  _extractQuarterlyResults(html) {
    const results = [];
    try {
      // Extract quarterly section
      const qSection = this._extractBetween(html, 'Quarterly Results', 'Profit &amp; Loss');
      if (!qSection) return results;

      // Extract Sales row numbers
      const salesMatch = qSection.match(/Sales[\s\S]*?<\/tr>/i);
      if (salesMatch) {
        const numbers = [];
        const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let m;
        while ((m = tdRegex.exec(salesMatch[0])) !== null) {
          const val = this._extractNumber(this._stripTags(m[1]));
          if (val !== null) numbers.push(val);
        }
        if (numbers.length >= 2) {
          results.push({ metric: 'Sales (Cr)', latest: numbers[numbers.length - 1], previous: numbers[numbers.length - 2] });
        }
      }

      // Extract Net Profit row
      const npMatch = qSection.match(/Net Profit[\s\S]*?<\/tr>/i);
      if (npMatch) {
        const numbers = [];
        const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let m;
        while ((m = tdRegex.exec(npMatch[0])) !== null) {
          const val = this._extractNumber(this._stripTags(m[1]));
          if (val !== null) numbers.push(val);
        }
        if (numbers.length >= 2) {
          results.push({ metric: 'Net Profit (Cr)', latest: numbers[numbers.length - 1], previous: numbers[numbers.length - 2] });
        }
      }

      // Extract OPM
      const opmMatch = qSection.match(/OPM\s*%[\s\S]*?<\/tr>/i);
      if (opmMatch) {
        const numbers = [];
        const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let m;
        while ((m = tdRegex.exec(opmMatch[0])) !== null) {
          const text = this._stripTags(m[1]).replace('%', '').trim();
          const val = parseFloat(text);
          if (!isNaN(val)) numbers.push(val);
        }
        if (numbers.length >= 2) {
          results.push({ metric: 'OPM %', latest: numbers[numbers.length - 1], previous: numbers[numbers.length - 2] });
        }
      }

      // Extract EPS
      const epsMatch = qSection.match(/EPS[\s\S]*?<\/tr>/i);
      if (epsMatch) {
        const numbers = [];
        const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let m;
        while ((m = tdRegex.exec(epsMatch[0])) !== null) {
          const val = this._extractNumber(this._stripTags(m[1]));
          if (val !== null) numbers.push(val);
        }
        if (numbers.length >= 2) {
          results.push({ metric: 'EPS (Rs)', latest: numbers[numbers.length - 1], previous: numbers[numbers.length - 2] });
        }
      }
    } catch (e) {}
    return results;
  }

  _extractGrowthRates(html) {
    const growth = {};
    try {
      // Compounded Sales Growth
      const salesGrowth = this._extractBetween(html, 'Compounded Sales Growth', 'Compounded Profit Growth');
      if (salesGrowth) {
        const matches = [...salesGrowth.matchAll(/([\d]+)\s*Years?:\s*<\/td>\s*<td[^>]*>\s*([-\d.]+)%/gi)];
        growth.salesGrowth = {};
        matches.forEach(m => {
          growth.salesGrowth[`${m[1]}yr`] = parseFloat(m[2]);
        });
        const ttmMatch = salesGrowth.match(/TTM:\s*<\/td>\s*<td[^>]*>\s*([-\d.]+)%/i);
        if (ttmMatch) growth.salesGrowth.ttm = parseFloat(ttmMatch[1]);
      }

      // Compounded Profit Growth
      const profitGrowth = this._extractBetween(html, 'Compounded Profit Growth', 'Stock Price CAGR');
      if (profitGrowth) {
        const matches = [...profitGrowth.matchAll(/([\d]+)\s*Years?:\s*<\/td>\s*<td[^>]*>\s*([-\d.]+)%/gi)];
        growth.profitGrowth = {};
        matches.forEach(m => {
          growth.profitGrowth[`${m[1]}yr`] = parseFloat(m[2]);
        });
        const ttmMatch = profitGrowth.match(/TTM:\s*<\/td>\s*<td[^>]*>\s*([-\d.]+)%/i);
        if (ttmMatch) growth.profitGrowth.ttm = parseFloat(ttmMatch[1]);
      }

      // Stock Price CAGR
      const priceCagr = this._extractBetween(html, 'Stock Price CAGR', 'Return on Equity');
      if (priceCagr) {
        const matches = [...priceCagr.matchAll(/([\d]+)\s*Years?:\s*<\/td>\s*<td[^>]*>\s*([-\d.]+)%/gi)];
        growth.priceCagr = {};
        matches.forEach(m => {
          growth.priceCagr[`${m[1]}yr`] = parseFloat(m[2]);
        });
      }

      // ROE history
      const roeSection = this._extractBetween(html, 'Return on Equity', 'Balance Sheet');
      if (roeSection) {
        const matches = [...roeSection.matchAll(/([\d]+)\s*Years?:\s*<\/td>\s*<td[^>]*>\s*([-\d.]+)%/gi)];
        growth.roeHistory = {};
        matches.forEach(m => {
          growth.roeHistory[`${m[1]}yr`] = parseFloat(m[2]);
        });
        const lastMatch = roeSection.match(/Last\s*Year:\s*<\/td>\s*<td[^>]*>\s*([-\d.]+)%/i);
        if (lastMatch) growth.roeHistory.lastYear = parseFloat(lastMatch[1]);
      }
    } catch (e) {}
    return growth;
  }

  _extractShareholding(html) {
    const holding = {};
    try {
      const section = this._extractBetween(html, 'Shareholding Pattern', 'Documents');
      if (!section) return holding;

      // Promoters
      const proMatch = section.match(/Promoters[^<]*<\/td>([\s\S]*?)<\/tr>/i);
      if (proMatch) {
        const pcts = [...proMatch[1].matchAll(/([\d.]+)%/g)];
        if (pcts.length > 0) holding.promoters = parseFloat(pcts[pcts.length - 1][1]);
      }

      // FIIs
      const fiiMatch = section.match(/FIIs[^<]*<\/td>([\s\S]*?)<\/tr>/i);
      if (fiiMatch) {
        const pcts = [...fiiMatch[1].matchAll(/([\d.]+)%/g)];
        if (pcts.length > 0) holding.fiis = parseFloat(pcts[pcts.length - 1][1]);
      }

      // DIIs
      const diiMatch = section.match(/DIIs[^<]*<\/td>([\s\S]*?)<\/tr>/i);
      if (diiMatch) {
        const pcts = [...diiMatch[1].matchAll(/([\d.]+)%/g)];
        if (pcts.length > 0) holding.diis = parseFloat(pcts[pcts.length - 1][1]);
      }

      // Public
      const pubMatch = section.match(/Public[^<]*<\/td>([\s\S]*?)<\/tr>/i);
      if (pubMatch) {
        const pcts = [...pubMatch[1].matchAll(/([\d.]+)%/g)];
        if (pcts.length > 0) holding.public = parseFloat(pcts[pcts.length - 1][1]);
      }
    } catch (e) {}
    return holding;
  }

  _extractPeers(html) {
    const peers = [];
    try {
      const section = this._extractBetween(html, 'Peer comparison', 'Quarterly Results');
      if (!section) return peers;

      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let match;
      let rowIndex = 0;
      while ((match = rowRegex.exec(section)) !== null) {
        rowIndex++;
        if (rowIndex <= 1) continue; // skip header
        
        const cells = [];
        const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cellMatch;
        while ((cellMatch = cellRegex.exec(match[1])) !== null) {
          cells.push(this._stripTags(cellMatch[1]).trim());
        }

        // Extract link text for company name
        const nameMatch = match[1].match(/<a[^>]*>([\s\S]*?)<\/a>/i);
        const name = nameMatch ? this._stripTags(nameMatch[1]).trim() : (cells[1] || '');

        if (cells.length >= 5 && name) {
          peers.push({
            name,
            price: this._extractNumber(cells[2]),
            pe: this._extractNumber(cells[3]),
            marketCapCr: this._extractNumber(cells[4]),
            divYield: cells[5] ? this._extractNumber(cells[5]) : null,
            roce: cells[cells.length - 1] ? this._extractNumber(cells[cells.length - 1]) : null
          });
        }
        if (peers.length >= 6) break;
      }
    } catch (e) {}
    return peers;
  }

  // ====== MONEYCONTROL DATA ======

  async _resolveMoneyControlScId(symbol) {
    const cleanSymbol = String(symbol || '').replace(/\.NS$|\.BO$/i, '').toUpperCase();
    if (!cleanSymbol) return null;

    const cacheKey = `mcid_${cleanSymbol}`;
    const cached = this._getCached(cacheKey);
    if (cached) return cached;

    try {
      const url = `https://www.moneycontrol.com/mccode/common/autosuggestion_solr.php?query=${encodeURIComponent(cleanSymbol)}&type=1&format=json`;
      const response = await this._fetchHTML(url);
      if (!response || response.length < 10) return null;

      const suggestions = JSON.parse(response);
      if (!Array.isArray(suggestions) || suggestions.length === 0) return null;

      const upper = cleanSymbol.toUpperCase();
      const best =
        suggestions.find((s) => String(s?.pdt_dis_nm || '').toUpperCase().includes(`, ${upper},`)) ||
        suggestions.find((s) => String(s?.pdt_dis_nm || '').toUpperCase().includes(`,${upper},`)) ||
        suggestions.find((s) => String(s?.pdt_dis_nm || '').toUpperCase().includes(` ${upper},`)) ||
        suggestions[0];

      const scId = best?.sc_id ? String(best.sc_id).trim() : null;
      if (scId) this._setCache(cacheKey, scId);
      return scId;
    } catch (e) {
      return null;
    }
  }

  // MoneyControl price API — very rich real-time data
  async getMoneyControlData(symbol) {
    const cacheKey = `mc_${symbol}`;
    const cached = this._getCached(cacheKey);
    if (cached) return cached;

    try {
      const cleanSymbol = symbol.replace(/\.NS$|\.BO$/i, '');

      const scId = await this._resolveMoneyControlScId(cleanSymbol);
      if (!scId) return null;

      const url = `https://priceapi.moneycontrol.com/pricefeed/nse/equitycash/${scId}`;
      const response = await this._fetchHTML(url);

      if (!response || response.length < 50) return null;

      const json = JSON.parse(response);
      if (json.code !== '200' || !json.data) return null;

      const d = json.data;
      const data = {
        symbol: cleanSymbol,
        moneycontrolId: scId,
        source: 'moneycontrol',
        name: d.SC_FULLNM || '',
        sector: d.main_sector || d.SC_SUBSEC || '',
        subSector: d.newSubsector || d.SC_SUBSEC || '',
        price: parseFloat(d.pricecurrent) || 0,
        prevClose: parseFloat(d.priceprevclose) || 0,
        change: parseFloat(d.pricechange) || 0,
        changePercent: parseFloat(d.pricepercentchange) || 0,
        open: parseFloat(d.OPN) || 0,
        dayHigh: parseFloat(d.HP) || 0,
        dayLow: parseFloat(d.LP) || 0,
        high52: parseFloat(d['52H']) || 0,
        low52: parseFloat(d['52L']) || 0,
        high52Date: d['52HDate'] || '',
        low52Date: d['52LDate'] || '',
        marketCapCr: parseFloat(d.MKTCAP) || 0,
        pe: parseFloat(d.PE) || 0,
        peConsolidated: parseFloat(d.PECONS) || 0,
        pb: parseFloat(d.PB) || 0,
        pbConsolidated: parseFloat(d.PBCONS) || 0,
        bookValue: parseFloat(d.BV) || 0,
        bookValueConsolidated: parseFloat(d.BVCONS) || 0,
        eps: parseFloat(d.SC_TTM) || 0,
        epsConsolidated: parseFloat(d.sc_ttm_cons) || 0,
        dividendYield: parseFloat(d.DY) || 0,
        dividendYieldConsolidated: parseFloat(d.DYCONS) || 0,
        faceValue: parseFloat(d.FV) || 0,
        ceps: parseFloat(d.CEPS) || 0,
        volume: parseInt(d.VOL) || 0,
        deliveryPercent: parseFloat(d.DELV) || 0,
        totalShares: parseInt(d.SHRS) || 0,
        industryPE: parseFloat(d.IND_PE) || 0,
        sma5: parseFloat(d['5DayAvg']) || 0,
        sma30: parseFloat(d['30DayAvg']) || 0,
        sma50: parseFloat(d['50DayAvg']) || 0,
        sma150: parseFloat(d['150DayAvg']) || 0,
        sma200: parseFloat(d['200DayAvg']) || 0,
        // Performance / CAGR
        cagr1Y: parseFloat(d.cagr1Y) || 0,
        cagr2Y: parseFloat(d.cagr2Y) || 0,
        cagr3Y: parseFloat(d.cagr3Y) || 0,
        cagr5Y: parseFloat(d.cagr5Y) || 0,
        cagr7Y: parseFloat(d.cagr7Y) || 0,
        cagr10Y: parseFloat(d.cagr10Y) || 0,
        // Period changes
        change1w: parseFloat(d.cl1wPerChange) || 0,
        change1m: parseFloat(d.cl1mPerChange) || 0,
        change3m: parseFloat(d.cl3mPerChange) || 0,
        change6m: parseFloat(d.cl6mPerChange) || 0,
        change1y: parseFloat(d.cl1yPerChange) || 0,
        changeYtd: parseFloat(d.clYtdPerChange) || 0,
        // Moving avg position
        aboveSma50: (parseFloat(d.pricecurrent) || 0) > (parseFloat(d['50DayAvg']) || 0),
        aboveSma200: (parseFloat(d.pricecurrent) || 0) > (parseFloat(d['200DayAvg']) || 0),
        // Exchange IDs
        bseId: d.BSEID || '',
        nseId: d.NSEID || '',
        isin: d.isinid || '',
        slug: d.slug || '',
        fetchedAt: new Date().toISOString()
      };

      this._setCache(cacheKey, data);
      return data;
    } catch (error) {
      console.error(`MoneyControl fetch error for ${symbol}:`, error.message);
      return null;
    }
  }

  // ====== COMBINED: Merge data from all sources ======

  async getFullAnalysisData(symbol) {
    const cleanSymbol = symbol.replace(/\.NS$|\.BO$/i, '');

    // Fetch from both sources in parallel
    const [screenerData, mcData] = await Promise.allSettled([
      this.getCompanyData(cleanSymbol),
      this.getMoneyControlData(cleanSymbol)
    ]);

    const screener = screenerData.status === 'fulfilled' ? screenerData.value : null;
    const mc = mcData.status === 'fulfilled' ? mcData.value : null;

    return {
      symbol: cleanSymbol,
      screener,
      moneycontrol: mc,
      hasSources: {
        screener: !!screener,
        moneycontrol: !!mc
      }
    };
  }
}

module.exports = new ScreenerService();
