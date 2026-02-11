const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Pool } = require('pg');
const config = require('./index');

let dbPath = path.resolve(__dirname, '../../', config.dbPath);
let warnedFallback = false;

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || process.env.SUPABASE_DATABASE_URL;

function parseDatabaseUrl(connectionString) {
  if (!connectionString) return null;
  try {
    const url = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) return null;
    if (!url.hostname) return null;
    return url;
  } catch (_) {
    return null;
  }
}

const PARSED_DATABASE_URL = parseDatabaseUrl(DATABASE_URL);

function shouldUsePg() {
  return Boolean(PARSED_DATABASE_URL);
}

function shouldUseSsl(connectionString) {
  if (!connectionString) return false;
  if (/sslmode=require/i.test(connectionString)) return true;
  if (process.env.PGSSLMODE === 'require') return true;
  // Most hosted Postgres providers require TLS.
  if (/supabase|neon|render\.com|railway|aws|gcp|azure/i.test(connectionString)) return true;
  return false;
}

function toPgPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

class PostgresDatabaseWrapper {
  constructor() {
    const ssl = shouldUseSsl(DATABASE_URL) ? { rejectUnauthorized: false } : undefined;
    this.pool = new Pool({ connectionString: DATABASE_URL, ssl });
    this._ready = this._init();
  }

  async _init() {
    await this._createTables();
    return this;
  }

  async _createTables() {
    const initialBalance = Number(config.initialBalance) || 0;

    // Keep schema as close to the existing SQLite(sql.js) schema as possible.
    // All ids are TEXT (UUID stored as string) to avoid migrations at app-layer.
    const statements = [
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        full_name TEXT NOT NULL,
        avatar_url TEXT DEFAULT '',
        balance DOUBLE PRECISION DEFAULT ${initialBalance},
        initial_balance DOUBLE PRECISION DEFAULT ${initialBalance},
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS watchlists (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        exchange TEXT DEFAULT 'NSE',
        added_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, symbol)
      )`,
      `CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        exchange TEXT DEFAULT 'NSE',
        order_type TEXT NOT NULL,
        side TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        price DOUBLE PRECISION,
        trigger_price DOUBLE PRECISION,
        status TEXT DEFAULT 'PENDING',
        filled_quantity INTEGER DEFAULT 0,
        filled_price DOUBLE PRECISION,
        trade_type TEXT DEFAULT 'DELIVERY',
        stop_loss DOUBLE PRECISION,
        target DOUBLE PRECISION,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        executed_at TIMESTAMPTZ
      )`,
      `CREATE TABLE IF NOT EXISTS holdings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        exchange TEXT DEFAULT 'NSE',
        quantity INTEGER NOT NULL DEFAULT 0,
        avg_price DOUBLE PRECISION NOT NULL DEFAULT 0,
        invested_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, symbol)
      )`,
      `CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        order_id TEXT,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        price DOUBLE PRECISION NOT NULL,
        total_amount DOUBLE PRECISION NOT NULL,
        trade_type TEXT DEFAULT 'DELIVERY',
        pnl DOUBLE PRECISION DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS portfolio_snapshots (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        total_value DOUBLE PRECISION NOT NULL,
        invested_value DOUBLE PRECISION NOT NULL,
        cash_balance DOUBLE PRECISION NOT NULL,
        pnl DOUBLE PRECISION NOT NULL,
        pnl_percentage DOUBLE PRECISION NOT NULL,
        snapshot_date DATE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, snapshot_date)
      )`,
      `CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        condition TEXT NOT NULL,
        target_price DOUBLE PRECISION NOT NULL,
        is_triggered INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        triggered_at TIMESTAMPTZ
      )`,
      `CREATE TABLE IF NOT EXISTS education_progress (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        module_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        completed INTEGER DEFAULT 0,
        completed_at TIMESTAMPTZ,
        UNIQUE(user_id, module_id, lesson_id)
      )`,
      `CREATE TABLE IF NOT EXISTS sip_plans (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        exchange TEXT DEFAULT 'NSE',
        amount DOUBLE PRECISION NOT NULL,
        frequency TEXT DEFAULT 'MONTHLY',
        day_of_month INTEGER DEFAULT 1,
        status TEXT DEFAULT 'ACTIVE',
        total_invested DOUBLE PRECISION DEFAULT 0,
        installments_done INTEGER DEFAULT 0,
        next_execution TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS sip_transactions (
        id TEXT PRIMARY KEY,
        sip_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        quantity INTEGER DEFAULT 0,
        price DOUBLE PRECISION DEFAULT 0,
        status TEXT DEFAULT 'PENDING',
        notes TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS wallet_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        balance_after DOUBLE PRECISION DEFAULT 0,
        description TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS trade_journal (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        order_id TEXT,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        trade_type TEXT DEFAULT 'DELIVERY',
        reason TEXT NOT NULL,
        strategy TEXT DEFAULT 'OTHER',
        emotions TEXT DEFAULT 'CALM',
        setup_quality INTEGER DEFAULT 3,
        notes TEXT DEFAULT '',
        tags TEXT DEFAULT '[]',
        outcome TEXT,
        pnl DOUBLE PRECISION DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS challenges (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        starting_capital DOUBLE PRECISION NOT NULL,
        current_value DOUBLE PRECISION NOT NULL,
        duration_days INTEGER DEFAULT 100,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        benchmark_index TEXT DEFAULT 'NIFTY50',
        benchmark_start DOUBLE PRECISION DEFAULT 0,
        status TEXT DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS challenge_snapshots (
        id TEXT PRIMARY KEY,
        challenge_id TEXT NOT NULL,
        day_number INTEGER NOT NULL,
        portfolio_value DOUBLE PRECISION NOT NULL,
        pnl DOUBLE PRECISION DEFAULT 0,
        pnl_percent DOUBLE PRECISION DEFAULT 0,
        trades_today INTEGER DEFAULT 0,
        benchmark_value DOUBLE PRECISION DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS auto_invest_plans (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT DEFAULT 'My Auto-Invest Plan',
        monthly_budget DOUBLE PRECISION NOT NULL DEFAULT 0,
        stock_pct DOUBLE PRECISION DEFAULT 50,
        mf_pct DOUBLE PRECISION DEFAULT 30,
        commodity_pct DOUBLE PRECISION DEFAULT 20,
        risk_level TEXT DEFAULT 'MODERATE',
        status TEXT DEFAULT 'ACTIVE',
        last_research_at TEXT,
        last_invest_at TEXT,
        total_invested DOUBLE PRECISION DEFAULT 0,
        months_active INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS auto_invest_picks (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT NOT NULL,
        allocated_amount DOUBLE PRECISION DEFAULT 0,
        quantity INTEGER DEFAULT 0,
        price DOUBLE PRECISION DEFAULT 0,
        confidence TEXT DEFAULT 'MEDIUM',
        status TEXT DEFAULT 'PENDING',
        executed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS auto_invest_research (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        research_date TEXT NOT NULL,
        market_sentiment TEXT,
        top_stock_picks TEXT,
        top_mf_picks TEXT,
        top_commodity_picks TEXT,
        news_summary TEXT,
        ai_strategy TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS auto_invest_lessons (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        buy_price DOUBLE PRECISION NOT NULL,
        current_price DOUBLE PRECISION NOT NULL,
        pnl_percent DOUBLE PRECISION NOT NULL,
        lesson TEXT NOT NULL,
        category TEXT DEFAULT 'LOSS',
        severity TEXT DEFAULT 'MINOR',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS auto_invest_monthly (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        month TEXT NOT NULL,
        budget DOUBLE PRECISION NOT NULL,
        spent DOUBLE PRECISION DEFAULT 0,
        remaining DOUBLE PRECISION NOT NULL,
        investments_count INTEGER DEFAULT 0,
        pnl DOUBLE PRECISION DEFAULT 0,
        status TEXT DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(plan_id, month)
      )`,

      // ── Blog tables ──
      `CREATE TABLE IF NOT EXISTS blog_niches (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        avg_cpc DOUBLE PRECISION DEFAULT 0,
        keywords TEXT,
        market TEXT DEFAULT 'global',
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS blog_posts (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        excerpt TEXT,
        content TEXT NOT NULL,
        niche_id TEXT REFERENCES blog_niches(id),
        tags TEXT,
        image_url TEXT,
        image_alt TEXT,
        author TEXT DEFAULT 'Editorial Team',
        reading_time INTEGER DEFAULT 5,
        status TEXT DEFAULT 'published',
        meta_title TEXT,
        meta_description TEXT,
        market TEXT DEFAULT 'global',
        is_trending INTEGER DEFAULT 0,
        source_url TEXT,
        views INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS blog_generation_log (
        id SERIAL PRIMARY KEY,
        niche_id TEXT,
        topic TEXT,
        status TEXT DEFAULT 'success',
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
    ];

    const client = await this.pool.connect();
    try {
      for (const sql of statements) {
        // eslint-disable-next-line no-await-in-loop
        await client.query(sql);
      }
    } finally {
      client.release();
    }
  }

  prepare(sql) {
    const preparedSql = toPgPlaceholders(sql);
    const self = this;

    return {
      async get(...params) {
        try {
          const result = await self.pool.query(preparedSql, params);
          return result.rows[0];
        } catch (e) {
          console.error('DB get error:', e.message || e, preparedSql);
          return undefined;
        }
      },
      async all(...params) {
        try {
          const result = await self.pool.query(preparedSql, params);
          return result.rows;
        } catch (e) {
          console.error('DB all error:', e.message || e, preparedSql);
          return [];
        }
      },
      async run(...params) {
        try {
          const result = await self.pool.query(preparedSql, params);
          return { changes: result.rowCount };
        } catch (e) {
          console.error('DB run error:', e.message || e, preparedSql);
          throw e;
        }
      },
    };
  }

  async exec(sql) {
    await this.pool.query(sql);
  }
}

// Wrapper to give sql.js a better-sqlite3-like API
class DatabaseWrapper {
  constructor() {
    this.db = null;
    this._ready = this._init();
  }

  async _init() {
    const SQL = await initSqlJs();
    if (fs.existsSync(dbPath)) {
      const buffer = fs.readFileSync(dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }
    this._createTables();
    this._save();
    return this;
  }

  _save() {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    try {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.writeFileSync(dbPath, buffer);
    } catch (e) {
      // Render will throw EACCES if DB_PATH points to something like /var/data
      // but no persistent disk is mounted there.
      if (!warnedFallback) {
        warnedFallback = true;
        console.warn(
          `[DB] Failed to write database at "${dbPath}" (${e.code || e.message}). Falling back to temp storage. ` +
          `For persistence on Render, mount a Disk (e.g. /var/data) and set DB_PATH accordingly.`
        );
      }

      dbPath = path.join(os.tmpdir(), 'trading-app-database.sqlite');
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.writeFileSync(dbPath, buffer);
    }
  }

  _createTables() {
    this.db.run(`PRAGMA foreign_keys = ON`);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        full_name TEXT NOT NULL,
        avatar_url TEXT DEFAULT '',
        balance REAL DEFAULT ${config.initialBalance},
        initial_balance REAL DEFAULT ${config.initialBalance},
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS watchlists (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        exchange TEXT DEFAULT 'NSE',
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, symbol)
      )`);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        exchange TEXT DEFAULT 'NSE',
        order_type TEXT NOT NULL,
        side TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        price REAL,
        trigger_price REAL,
        status TEXT DEFAULT 'PENDING',
        filled_quantity INTEGER DEFAULT 0,
        filled_price REAL,
        trade_type TEXT DEFAULT 'DELIVERY',
        stop_loss REAL,
        target REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        executed_at DATETIME
      )`);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS holdings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        exchange TEXT DEFAULT 'NSE',
        quantity INTEGER NOT NULL DEFAULT 0,
        avg_price REAL NOT NULL DEFAULT 0,
        invested_amount REAL NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, symbol)
      )`);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        order_id TEXT,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        price REAL NOT NULL,
        total_amount REAL NOT NULL,
        trade_type TEXT DEFAULT 'DELIVERY',
        pnl REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS portfolio_snapshots (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        total_value REAL NOT NULL,
        invested_value REAL NOT NULL,
        cash_balance REAL NOT NULL,
        pnl REAL NOT NULL,
        pnl_percentage REAL NOT NULL,
        snapshot_date DATE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, snapshot_date)
      )`);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        condition TEXT NOT NULL,
        target_price REAL NOT NULL,
        is_triggered INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        triggered_at DATETIME
      )`);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS education_progress (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        module_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        completed INTEGER DEFAULT 0,
        completed_at DATETIME,
        UNIQUE(user_id, module_id, lesson_id)
      )`);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sip_plans (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        exchange TEXT DEFAULT 'NSE',
        amount REAL NOT NULL,
        frequency TEXT DEFAULT 'MONTHLY',
        day_of_month INTEGER DEFAULT 1,
        status TEXT DEFAULT 'ACTIVE',
        total_invested REAL DEFAULT 0,
        installments_done INTEGER DEFAULT 0,
        next_execution TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sip_transactions (
        id TEXT PRIMARY KEY,
        sip_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        amount REAL NOT NULL,
        quantity INTEGER DEFAULT 0,
        price REAL DEFAULT 0,
        status TEXT DEFAULT 'PENDING',
        notes TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

    // Wallet transactions
    this.db.run(`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        balance_after REAL DEFAULT 0,
        description TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

    // Trade journal
    this.db.run(`
      CREATE TABLE IF NOT EXISTS trade_journal (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        order_id TEXT,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        trade_type TEXT DEFAULT 'DELIVERY',
        reason TEXT NOT NULL,
        strategy TEXT DEFAULT 'OTHER',
        emotions TEXT DEFAULT 'CALM',
        setup_quality INTEGER DEFAULT 3,
        notes TEXT DEFAULT '',
        tags TEXT DEFAULT '[]',
        outcome TEXT,
        pnl REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

    // Challenges (100-day challenge)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS challenges (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        starting_capital REAL NOT NULL,
        current_value REAL NOT NULL,
        duration_days INTEGER DEFAULT 100,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        benchmark_index TEXT DEFAULT 'NIFTY50',
        benchmark_start REAL DEFAULT 0,
        status TEXT DEFAULT 'ACTIVE',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

    // Challenge daily snapshots
    this.db.run(`
      CREATE TABLE IF NOT EXISTS challenge_snapshots (
        id TEXT PRIMARY KEY,
        challenge_id TEXT NOT NULL,
        day_number INTEGER NOT NULL,
        portfolio_value REAL NOT NULL,
        pnl REAL DEFAULT 0,
        pnl_percent REAL DEFAULT 0,
        trades_today INTEGER DEFAULT 0,
        benchmark_value REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

    // Auto-invest plans
    this.db.run(`
      CREATE TABLE IF NOT EXISTS auto_invest_plans (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT DEFAULT 'My Auto-Invest Plan',
        monthly_budget REAL NOT NULL DEFAULT 0,
        stock_pct REAL DEFAULT 50,
        mf_pct REAL DEFAULT 30,
        commodity_pct REAL DEFAULT 20,
        risk_level TEXT DEFAULT 'MODERATE',
        status TEXT DEFAULT 'ACTIVE',
        last_research_at TEXT,
        last_invest_at TEXT,
        total_invested REAL DEFAULT 0,
        months_active INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

    // Auto-invest AI picks
    this.db.run(`
      CREATE TABLE IF NOT EXISTS auto_invest_picks (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT NOT NULL,
        allocated_amount REAL DEFAULT 0,
        quantity INTEGER DEFAULT 0,
        price REAL DEFAULT 0,
        confidence TEXT DEFAULT 'MEDIUM',
        status TEXT DEFAULT 'PENDING',
        executed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

    // Auto-invest research logs
    this.db.run(`
      CREATE TABLE IF NOT EXISTS auto_invest_research (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        research_date TEXT NOT NULL,
        market_sentiment TEXT,
        top_stock_picks TEXT,
        top_mf_picks TEXT,
        top_commodity_picks TEXT,
        news_summary TEXT,
        ai_strategy TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

    // AI loss learning — lessons from past picks
    this.db.run(`
      CREATE TABLE IF NOT EXISTS auto_invest_lessons (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        buy_price REAL NOT NULL,
        current_price REAL NOT NULL,
        pnl_percent REAL NOT NULL,
        lesson TEXT NOT NULL,
        category TEXT DEFAULT 'LOSS',
        severity TEXT DEFAULT 'MINOR',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

    // Monthly budget tracking
    this.db.run(`
      CREATE TABLE IF NOT EXISTS auto_invest_monthly (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        month TEXT NOT NULL,
        budget REAL NOT NULL,
        spent REAL DEFAULT 0,
        remaining REAL NOT NULL,
        investments_count INTEGER DEFAULT 0,
        pnl REAL DEFAULT 0,
        status TEXT DEFAULT 'ACTIVE',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(plan_id, month)
      )`);
  }

  prepare(sql) {
    const self = this;
    return {
      get(...params) {
        try {
          const stmt = self.db.prepare(sql);
          if (params.length) stmt.bind(params);
          if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row;
          }
          stmt.free();
          return undefined;
        } catch (e) {
          console.error('DB get error:', e.message || e, sql);
          return undefined;
        }
      },
      all(...params) {
        try {
          const results = [];
          const stmt = self.db.prepare(sql);
          if (params.length) stmt.bind(params);
          while (stmt.step()) {
            results.push(stmt.getAsObject());
          }
          stmt.free();
          return results;
        } catch (e) {
          console.error('DB all error:', e.message, sql);
          return [];
        }
      },
      run(...params) {
        try {
          self.db.run(sql, params);
          self._save();
          return { changes: self.db.getRowsModified() };
        } catch (e) {
          console.error('DB run error:', e.message || e, sql);
          throw e;
        }
      }
    };
  }

  exec(sql) {
    this.db.run(sql);
    this._save();
  }
}

const dbWrapper = new DatabaseWrapper();

const pgWrapper = shouldUsePg() ? new PostgresDatabaseWrapper() : null;

if (pgWrapper) {
  const host = PARSED_DATABASE_URL?.host || 'unknown-host';
  console.log(`[DB] Using Postgres (DATABASE_URL) @ ${host}`);
} else {
  if (DATABASE_URL && !PARSED_DATABASE_URL) {
    console.warn('[DB] DATABASE_URL is set but invalid (must be a full postgresql:// URL with a hostname). Falling back to SQLite/sql.js.');
  }
  console.log(`[DB] Using SQLite/sql.js (DB_PATH file)`);
}

module.exports = pgWrapper || dbWrapper;
