require('dotenv').config();

module.exports = {
  port: process.env.PORT || 5000,
  jwtSecret: process.env.JWT_SECRET || 'fallback-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  initialBalance: parseInt(process.env.INITIAL_BALANCE) || 1000000,
  dbPath: process.env.DB_PATH || './database.sqlite',
  nodeEnv: process.env.NODE_ENV || 'development'
};
