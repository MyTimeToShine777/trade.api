require('dotenv').config({ override: true });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const config = require('./config');
const errorHandler = require('./middleware/errorHandler');

const autoInvestService = require('./services/autoInvestService');

// Initialize database
const db = require('./config/database');

const app = express();

// Ensure database is ready before handling requests
app.use(async (req, res, next) => {
  try {
    await db._ready;
    next();
  } catch (e) {
    res.status(503).json({ error: 'Database not ready' });
  }
});

// Security middleware
app.use(helmet());
app.set('trust proxy', 1);

const defaultAllowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5000',
  'http://localhost:8080',
  'https://pugazhstockssimai.vercel.app',
];

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const isAllowedOrigin = (origin) => {
  if (!origin) return true; // curl/postman
  if (allowedOrigins.includes(origin)) return true;
  if (defaultAllowedOrigins.includes(origin)) return true;
  // Allow any Vercel preview/prod domain by default
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return true;
  return false;
};

app.use(
  cors({
    origin: (origin, cb) => {
      if (isAllowedOrigin(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500 // limit each IP
});
app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
if (config.nodeEnv === 'development') {
  app.use(morgan('dev'));
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: config.nodeEnv
  });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/market', require('./routes/market'));
app.use('/api/trading', require('./routes/trading'));
app.use('/api/watchlist', require('./routes/watchlist'));
app.use('/api/education', require('./routes/education'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/sip', require('./routes/sip'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/commodities', require('./routes/commodity'));
app.use('/api/mutual-funds', require('./routes/mutualfund'));
app.use('/api/fundamental', require('./routes/fundamental'));
app.use('/api/risk', require('./routes/risk'));
app.use('/api/journal', require('./routes/journal'));
app.use('/api/challenge', require('./routes/challenge'));
app.use('/api/auto-invest', require('./routes/autoinvest'));
app.use('/api/blog', require('./routes/blog'));

// Error handler
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
const PORT = config.port;
app.listen(PORT, () => {
  console.log(`
  🚀 Trading App Backend Server
  ================================
  Environment: ${config.nodeEnv}
  Port: ${PORT}
  API Base: http://localhost:${PORT}/api
  ================================
  Endpoints:
    Auth:         /api/auth
    Market:       /api/market
    Trading:      /api/trading
    Watchlist:    /api/watchlist
    Education:    /api/education
    AI:           /api/ai
    SIP:          /api/sip
    Wallet:       /api/wallet
    Commodities:  /api/commodities
    Mutual Funds: /api/mutual-funds
    Fundamental:  /api/fundamental
    Risk:         /api/risk
    Journal:      /api/journal
    Challenge:    /api/challenge
    Auto-Invest:  /api/auto-invest
    Blog:         /api/blog
  ================================
  Initial Paper Trading Balance: ₹${config.initialBalance.toLocaleString('en-IN')}
  `);

  // Auto-Invest scheduling (optional)
  // - Research job: runs before market open (default 08:45 on weekdays)
  // - Execute job: runs after market open (default 09:16 on weekdays)
  const enableAutoInvestCron = process.env.AUTO_INVEST_CRON_ENABLED !== 'false';
  if (enableAutoInvestCron) {
    const researchCron = process.env.AUTO_INVEST_RESEARCH_CRON || '45 8 * * 1-5';
    const executeCron = process.env.AUTO_INVEST_EXECUTE_CRON || '16 9 * * 1-5';

    let researchRunning = false;
    let executeRunning = false;

    const runResearchForActivePlans = async () => {
      if (researchRunning) return;
      researchRunning = true;
      try {
        await db._ready;
        const plans = await db.prepare("SELECT id, user_id FROM auto_invest_plans WHERE status = 'ACTIVE'").all();
        for (const p of plans) {
          const pending = await db
            .prepare("SELECT COUNT(1) AS c FROM auto_invest_picks WHERE plan_id = ? AND user_id = ? AND status = 'PENDING'")
            .get(p.id, p.user_id);
          if ((pending?.c || 0) > 0) continue;
          try {
            await autoInvestService.runResearch(p.user_id);
          } catch (e) {
            // Ignore individual plan failures; keep the job running for others
            console.warn('[Auto-Invest Cron] Research failed:', e.message);
          }
        }
      } finally {
        researchRunning = false;
      }
    };

    const executePendingForActivePlans = async () => {
      if (executeRunning) return;
      executeRunning = true;
      try {
        await db._ready;
        const plans = await db.prepare("SELECT id, user_id FROM auto_invest_plans WHERE status = 'ACTIVE'").all();
        for (const p of plans) {
          const pending = await db
            .prepare("SELECT COUNT(1) AS c FROM auto_invest_picks WHERE plan_id = ? AND user_id = ? AND status = 'PENDING'")
            .get(p.id, p.user_id);
          if ((pending?.c || 0) < 1) continue;
          try {
            await autoInvestService.executePicks(p.user_id);
          } catch (e) {
            console.warn('[Auto-Invest Cron] Execute failed:', e.message);
          }
        }
      } finally {
        executeRunning = false;
      }
    };

    try {
      cron.schedule(researchCron, () => runResearchForActivePlans().catch(() => {}));
      cron.schedule(executeCron, () => executePendingForActivePlans().catch(() => {}));
      console.log(`[Auto-Invest Cron] Enabled. Research: "${researchCron}" Execute: "${executeCron}"`);
    } catch (e) {
      console.warn('[Auto-Invest Cron] Failed to start schedules:', e.message);
    }
  } else {
    console.log('[Auto-Invest Cron] Disabled (AUTO_INVEST_CRON_ENABLED=false)');
  }

  // Keep-alive: ping own health endpoint every 14 min to prevent Render free-tier sleep
  const selfUrl = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL;
  if (selfUrl) {
    cron.schedule('*/14 * * * *', async () => {
      try {
        const res = await fetch(`${selfUrl}/api/health`);
        console.log(`[Keep-Alive] Pinged ${selfUrl}/api/health → ${res.status}`);
      } catch (e) {
        console.warn('[Keep-Alive] Ping failed:', e.message);
      }
    });
    console.log(`[Keep-Alive] Enabled — pinging ${selfUrl} every 14 min`);
  }

  // Blog auto-generation: seed niches on startup + generate posts on schedule
  const blogEnabled = process.env.BLOG_CRON_ENABLED !== 'false';
  if (blogEnabled) {
    const blogService = require('./services/blogGeneratorService');
    // Seed niches on first boot (idempotent)
    db._ready.then(() => blogService.seedNiches()).catch(e => console.warn('[Blog] Seed failed:', e.message));

    // Generate 2 posts every 6 hours (at minute 10 to avoid other crons)
    const blogCron = process.env.BLOG_CRON || '10 */6 * * *';
    const postsPerBatch = parseInt(process.env.BLOG_POSTS_PER_BATCH || '2');
    let blogRunning = false;
    cron.schedule(blogCron, async () => {
      if (blogRunning) return;
      blogRunning = true;
      try {
        console.log(`[Blog Cron] Generating ${postsPerBatch} posts...`);
        const results = await blogService.batchGenerate(postsPerBatch);
        console.log(`[Blog Cron] Done — ${results.length} posts created`);
      } catch (e) {
        console.error('[Blog Cron] Failed:', e.message);
      } finally {
        blogRunning = false;
      }
    });
    console.log(`[Blog Cron] Enabled — "${blogCron}" generating ${postsPerBatch} posts`);
  }
});

module.exports = app;
