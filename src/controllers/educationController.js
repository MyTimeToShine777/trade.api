const db = require('../config/database');

// Education content based on the 3 videos
const educationContent = {
  modules: [
    {
      id: 'basics',
      title: 'Stock Market Basics',
      description: 'Understanding shares, exchanges, and how the market works',
      icon: '📊',
      lessons: [
        {
          id: 'what-is-share',
          title: 'What is a Share?',
          duration: '5 min',
          content: `A **Share** represents fractional ownership of a company. Think of it like dividing a piece of land into equal parts.\n\nIf a company is worth ₹25,000 Cr and has 25,000 shares, each share is worth ₹1 Cr. When the company grows (like a mall opening nearby), each share's value increases.\n\n**Key Points:**\n- A share = ownership in a company\n- More shares you own = more ownership\n- Share price reflects company's perceived value\n- You earn through price appreciation + dividends`
        },
        {
          id: 'ipo-explained',
          title: 'IPO - Initial Public Offering',
          duration: '5 min',
          content: `Companies list on the stock market through an **IPO (Initial Public Offering)** to raise capital for expansion.\n\n**Why IPO instead of Bank Loans?**\n- No interest payments required\n- No obligation to repay capital\n- Company shares risk with investors\n- Builds public trust and visibility\n\n**IPO Process:**\n1. Company files with SEBI\n2. Sets price band\n3. Investors bid for shares\n4. Shares get listed on exchange`
        },
        {
          id: 'exchanges-indices',
          title: 'Exchanges & Indices',
          duration: '5 min',
          content: `**Exchanges** are marketplaces where shares are traded:\n- **NSE** (National Stock Exchange) - Largest in India\n- **BSE** (Bombay Stock Exchange) - Oldest in Asia\n\n**Indices** track overall market performance:\n- **Nifty 50** - Top 50 companies by market cap on NSE\n- **Sensex** - Top 30 companies on BSE\n\nIf Nifty goes up, it means the top 50 companies are collectively doing well.`
        },
        {
          id: 'demat-trading',
          title: 'Demat & Trading Accounts',
          duration: '5 min',
          content: `To trade stocks, you need two accounts:\n\n**Demat Account** (Dematerialized)\n- Stores your shares digitally\n- Like a warehouse for your stocks\n- No physical certificates needed\n\n**Trading Account**\n- Used to buy and sell shares\n- Connected to your Demat account\n- Linked to your bank account\n\n**Popular Brokers:** Zerodha, Groww, Angel One, Upstox`
        }
      ]
    },
    {
      id: 'fundamental',
      title: 'Fundamental Analysis',
      description: 'Learn to evaluate company health using 7 key ratios',
      icon: '📈',
      lessons: [
        {
          id: 'fa-overview',
          title: 'What is Fundamental Analysis?',
          duration: '5 min',
          content: `Fundamental Analysis helps you decide **WHAT** to buy by evaluating a company's financial health.\n\n**Three Pillars:**\n1. **P&L Statement** - Revenue, expenses, profit\n2. **Balance Sheet** - Assets, liabilities, equity\n3. **Market News** - Industry trends, management decisions\n\n**Tools:** Use screener.in or moneycontrol.com to check these ratios.`
        },
        {
          id: 'eps',
          title: 'EPS - Earnings Per Share',
          duration: '5 min',
          content: `**EPS = Net Profit / Total Shares**\n\nTells you how much profit the company makes for each share.\n\n**Example:**\n- Company profit: ₹100 Cr\n- Total shares: 10 Cr\n- EPS = ₹10 per share\n\n**Rules:**\n- Higher EPS = More profitable\n- Growing EPS year-over-year = Good sign\n- Compare within same industry`
        },
        {
          id: 'pe-ratio',
          title: 'P/E Ratio - Price to Earnings',
          duration: '5 min',
          content: `**P/E = Share Price / EPS**\n\nTells you how much you're paying for every ₹1 of earnings.\n\n**Example:**\n- Share Price: ₹500, EPS: ₹25\n- P/E = 20 (You pay ₹20 for every ₹1 earned)\n\n**Rules:**\n- Lower P/E = Potentially undervalued (Value Buying)\n- Very high P/E (>40) = May be overvalued\n- Compare P/E within same industry\n- Negative P/E = Company is making losses`
        },
        {
          id: 'debt-equity',
          title: 'Debt-to-Equity Ratio',
          duration: '5 min',
          content: `**D/E = Total Debt / Shareholder Equity**\n\nShows how much the company relies on borrowed money.\n\n**Rules:**\n- D/E < 1 = Conservative (Good)\n- D/E > 2 = Highly leveraged (Risky)\n- Some industries naturally have higher D/E (Banks)\n\n**Red Flag Example (Ola Electric):**\n- Increasing losses (-₹200 Cr to -₹1,500 Cr)\n- Rising debt despite being popular\n- Brand popularity ≠ Financial health`
        },
        {
          id: 'roe',
          title: 'ROE - Return on Equity',
          duration: '5 min',
          content: `**ROE = Net Profit / Shareholder Equity × 100**\n\nMeasures how efficiently a company generates profit from shareholders' money.\n\n**Rules:**\n- ROE > 15% = Good\n- ROE > 20% = Excellent\n- Consistently high ROE = Well-managed company\n- Declining ROE = Declining efficiency`
        },
        {
          id: 'market-cap-book',
          title: 'Market Cap, Book Value & P/B',
          duration: '5 min',
          content: `**Market Cap = Share Price × Total Shares**\n\n**Classification:**\n- Large Cap (>₹20,000 Cr) = Stable, lower growth\n- Mid Cap (₹5,000-20,000 Cr) = Moderate risk/reward\n- Small Cap (<₹5,000 Cr) = High risk, high potential\n\n**Book Value** = Net worth if company sold everything today\n\n**P/B Ratio = Price / Book Value**\n- P/B near 1 = Fair valued\n- P/B >> 1 = Potentially overvalued\n- P/B < 1 = Potentially undervalued (or troubled)`
        }
      ]
    },
    {
      id: 'technical',
      title: 'Technical Analysis',
      description: 'Chart patterns, indicators, and timing your trades',
      icon: '🕯️',
      lessons: [
        {
          id: 'candlesticks',
          title: 'Understanding Candlesticks',
          duration: '8 min',
          content: `Each candlestick shows **OHLC** data:\n- **O**pen - Price at start\n- **H**igh - Highest price\n- **L**ow - Lowest price\n- **C**lose - Price at end\n\n**Green candle:** Close > Open (Price went UP)\n**Red candle:** Close < Open (Price went DOWN)\n\n**Body** = Difference between Open & Close\n**Wicks/Shadows** = High/Low extensions`
        },
        {
          id: 'reversal-patterns',
          title: 'Reversal Patterns',
          duration: '10 min',
          content: `**Single Candle Patterns:**\n\n1. **Hammer** 🔨 - Small body, long lower wick\n   - Found at bottom of downtrend\n   - Signal: Bullish reversal\n\n2. **Shooting Star** ⭐ - Small body, long upper wick\n   - Found at top of uptrend\n   - Signal: Bearish reversal\n\n3. **Hanging Man** - Looks like Hammer but at top\n   - Signal: Bearish reversal\n\n**Two Candle Patterns:**\n\n4. **Bullish Engulfing** - Green candle swallows previous red\n   - Signal: Strong bullish reversal\n\n5. **Bearish Engulfing** - Red candle swallows previous green\n   - Signal: Strong bearish reversal\n\n6. **Harami** - Small candle inside previous candle\n   - Signal: Potential reversal`
        },
        {
          id: 'indecision-patterns',
          title: 'Indecision Patterns',
          duration: '5 min',
          content: `**Doji** - Open ≈ Close (tiny body)\n- Represents market indecision\n- Types:\n  - **Standard Doji** - Equal wicks\n  - **Gravestone Doji** - Long upper wick (Bearish)\n  - **Dragonfly Doji** - Long lower wick (Bullish)\n\n**Spinning Top** - Small body, equal wicks\n- Neither buyers nor sellers are in control\n- Wait for confirmation before trading`
        },
        {
          id: 'trends',
          title: 'Identifying Trends',
          duration: '8 min',
          content: `**Uptrend** 📈\n- Higher Highs + Higher Lows\n- Buyers are in control\n- Look for buying opportunities on dips\n\n**Downtrend** 📉\n- Lower Lows + Lower Highs\n- Sellers are in control\n- Avoid buying, look for shorting opportunities\n\n**Sideways/Range** ↔️\n- Price moves between support and resistance\n- Happens 70% of the time!\n- Best strategy: Buy at support, sell at resistance\n- Or simply WAIT for a breakout`
        },
        {
          id: 'moving-averages',
          title: 'Moving Averages (SMA & EMA)',
          duration: '8 min',
          content: `**Simple Moving Average (SMA)**\n- Average of last N closing prices\n- Common periods: 20, 50, 200\n\n**Exponential Moving Average (EMA)**\n- Gives more weight to recent prices\n- Reacts faster to price changes\n\n**Trading Rules:**\n- Price > MA = Bullish trend\n- Price < MA = Bearish trend\n- Golden Cross (50 SMA > 200 SMA) = Strong Buy\n- Death Cross (50 SMA < 200 SMA) = Strong Sell`
        },
        {
          id: 'rsi',
          title: 'RSI - Relative Strength Index',
          duration: '5 min',
          content: `**RSI** measures momentum on a scale of 0-100.\n\n**Key Levels:**\n- RSI < 30 = **Oversold** (Potential Buy signal)\n- RSI > 70 = **Overbought** (Potential Sell signal)\n- RSI = 50 = Neutral\n\n**Usage:**\n- RSI divergence with price = strong reversal signal\n- Use with other indicators for confirmation\n- Don't blindly buy/sell at 30/70, wait for confirmation`
        },
        {
          id: 'bollinger',
          title: 'Bollinger Bands & Volume',
          duration: '5 min',
          content: `**Bollinger Bands** measure volatility:\n- Upper Band = SMA + 2 Standard Deviations\n- Middle Band = 20 SMA\n- Lower Band = SMA - 2 Standard Deviations\n\n**Rules:**\n- Price at Upper Band = Overbought\n- Price at Lower Band = Oversold\n- Bands squeezing = Big move incoming\n\n**Volume Analysis:**\n- Price Up + Volume Up = Strong bullish trend\n- Price Up + Volume Down = Weak rally (potential reversal)\n- High volume at support/resistance = Breakout likely`
        }
      ]
    },
    {
      id: 'risk',
      title: 'Risk Management',
      description: 'Stop losses, position sizing, and the 1:2 rule',
      icon: '🛡️',
      lessons: [
        {
          id: 'stop-loss',
          title: 'Stop Loss - Your Safety Net',
          duration: '5 min',
          content: `A **Stop Loss** automatically sells your stock if it falls to a certain price.\n\n**Example:**\n- Buy at ₹100\n- Stop Loss at ₹95\n- Maximum loss = ₹5 per share (5%)\n\n**Types:**\n- **Fixed Stop Loss** - Set at a specific price\n- **Trailing Stop Loss** - Moves up with price\n\n**Rule:** NEVER trade without a stop loss. It's your insurance against big losses.`
        },
        {
          id: 'risk-reward',
          title: 'Risk-Reward Ratio',
          duration: '5 min',
          content: `**Always aim for minimum 1:2 Risk:Reward**\n\nIf you risk ₹1, aim to make ₹2.\n\n**NHPC Trade Example (from the Challenge):**\n- Entry: ₹90\n- Stop Loss: ₹77 (Risk: ₹13 = ~14%)\n- Target: ₹118 (Reward: ₹28 = ~31%)\n- Risk:Reward ≈ 1:2.15\n- Result: 30% profit in 3 months\n\n**Why this works:**\nEven if you win only 40% of trades:\n- 4 wins × ₹2 = ₹8\n- 6 losses × ₹1 = ₹6\n- Net Profit = ₹2 (still profitable!)`
        },
        {
          id: 'position-sizing',
          title: 'Position Sizing',
          duration: '5 min',
          content: `**Never risk more than 2-5% of your capital on a single trade.**\n\n**Example with ₹10,00,000 capital:**\n- Max risk per trade: ₹20,000-50,000 (2-5%)\n- If stop loss = 10%, max position = ₹2,00,000-5,00,000\n\n**Diversification Rules:**\n- Don't put all money in one stock\n- Spread across 8-15 stocks\n- Mix of large, mid, and small cap\n- Different sectors (IT, Banking, Pharma, FMCG)`
        }
      ]
    },
    {
      id: 'options',
      title: 'Options Trading (F&O)',
      description: 'Understanding derivatives, Greeks, and why 90% lose',
      icon: '⚠️',
      lessons: [
        {
          id: 'derivatives-basics',
          title: 'What are Derivatives?',
          duration: '8 min',
          content: `**Derivatives** are contracts that derive value from an underlying asset.\n\nAnalogy: If Milk is the asset, Curd is the derivative.\n\n**Types:**\n- **Forwards** - Private, customizable agreements\n- **Futures** - Standardized exchange-traded contracts (OBLIGATION)\n- **Options** - Right but NOT obligation to buy/sell\n\n**Options are like insurance:**\n- You pay a small premium\n- Get protection/opportunity for a limited time\n- Premium expires worthless if not used`
        },
        {
          id: 'call-put',
          title: 'Call (CE) vs Put (PE)',
          duration: '5 min',
          content: `**Call Option (CE - Call European):**\n- Buy if you think market goes UP ⬆️\n- Gives RIGHT to BUY at a specific price\n\n**Put Option (PE - Put European):**\n- Buy if you think market goes DOWN ⬇️\n- Gives RIGHT to SELL at a specific price\n\n**Example:**\n- Nifty at 24,000\n- Buy 24,100 CE for ₹100 premium\n- If Nifty goes to 24,300 → You profit\n- If Nifty stays below 24,100 → You lose ₹100`
        },
        {
          id: 'buyer-vs-seller',
          title: 'Why 90% of Buyers Lose',
          duration: '10 min',
          content: `**Option Buying:**\n- Low capital needed (₹5,000-10,000)\n- Unlimited profit potential\n- Limited loss (premium paid)\n- ⚠️ LOW probability of winning (20-30%)\n\n**Option Selling:**\n- High capital needed (₹1,00,000+)\n- Limited profit (premium earned)\n- Unlimited risk\n- ✅ HIGH probability of winning (70-80%)\n\n**Why sellers win:**\nSellers profit if market goes their way OR stays sideways.\nBuyers ONLY profit if market moves significantly in their direction.\nSince markets are sideways 70% of the time, sellers win 70% of the time.`
        },
        {
          id: 'greeks',
          title: 'Option Greeks & Time Decay',
          duration: '10 min',
          content: `**The Greeks explain how option prices move:**\n\n**Delta** - Speed\n- How much option price moves per ₹1 stock move\n- CE Delta: 0 to 1, PE Delta: -1 to 0\n\n**Gamma** - Acceleration\n- Rate of change of Delta\n\n**Theta** - Time Decay ⏰ (THE ENEMY)\n- Every day, options lose value automatically\n- As expiry approaches, decay accelerates\n- This is WHY 90% of buyers lose!\n\n**Vega** - Volatility\n- Higher volatility = Higher option prices\n\n**Premium = Intrinsic Value + Time Value**\nAt expiry, Time Value = 0. Only Intrinsic Value remains.`
        },
        {
          id: 'moneyness',
          title: 'ITM, ATM, OTM',
          duration: '5 min',
          content: `**In The Money (ITM):**\n- Has intrinsic value\n- Safest but most expensive\n- CE: Strike < Market Price\n- PE: Strike > Market Price\n\n**At The Money (ATM):**\n- Strike ≈ Market Price\n- Highest time value\n\n**Out of The Money (OTM):**\n- Only has time value\n- Cheapest but RISKIEST\n- Often expires worthless (₹0)\n\n**⚠️ Warning:** OTM options are the #1 reason beginners lose money. They're cheap but almost always expire zero.`
        }
      ]
    }
  ]
};

exports.getModules = (req, res) => {
  const modules = educationContent.modules.map(m => ({
    id: m.id,
    title: m.title,
    description: m.description,
    icon: m.icon,
    lessonCount: m.lessons.length,
    totalDuration: m.lessons.reduce((sum, l) => sum + parseInt(l.duration), 0) + ' min'
  }));
  res.json(modules);
};

exports.getModule = async (req, res) => {
  const module = educationContent.modules.find(m => m.id === req.params.moduleId);
  if (!module) return res.status(404).json({ error: 'Module not found' });

  // Get user progress if authenticated
  let progress = [];
  if (req.user) {
    progress = await db
      .prepare('SELECT lesson_id, completed FROM education_progress WHERE user_id = ? AND module_id = ?')
      .all(req.user.id, req.params.moduleId);
  }

  const lessonsWithProgress = module.lessons.map(l => ({
    ...l,
    completed: progress.some(p => p.lesson_id === l.id && p.completed)
  }));

  res.json({ ...module, lessons: lessonsWithProgress });
};

exports.getLesson = (req, res) => {
  const module = educationContent.modules.find(m => m.id === req.params.moduleId);
  if (!module) return res.status(404).json({ error: 'Module not found' });

  const lesson = module.lessons.find(l => l.id === req.params.lessonId);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

  res.json({ moduleId: module.id, moduleTitle: module.title, ...lesson });
};

exports.markComplete = async (req, res) => {
  try {
    const { moduleId, lessonId } = req.params;
    const { v4: uuidv4 } = require('uuid');

    await db.prepare(`
      INSERT INTO education_progress (id, user_id, module_id, lesson_id, completed, completed_at)
      VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, module_id, lesson_id) DO UPDATE SET completed = 1, completed_at = CURRENT_TIMESTAMP
    `).run(uuidv4(), req.user.id, moduleId, lessonId);

    res.json({ message: 'Lesson marked as complete' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
