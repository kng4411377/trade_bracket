import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import baseConfig from '../config/config.json' assert { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const cfg = {
  pollMs: parseInt(process.env.POLL_INTERVAL_MS || '30000', 10),

  dryRun: (process.env.DRY_RUN || 'false').toLowerCase() === 'true',
  dryRunSlippageBps: parseFloat(process.env.DRY_RUN_SLIPPAGE_BPS || '0'),
  dryRunFee: parseFloat(process.env.DRY_RUN_FEE_PER_TRADE || '0'),

  marketHoursOnly: (process.env.MARKET_HOURS_ONLY || 'false').toLowerCase() === 'true',

  eodCloseEnabled: (process.env.EOD_CLOSE_ENABLED || 'false').toLowerCase() === 'true',
  eodCutoffMin: parseInt(process.env.EOD_CUTOFF_MINUTES || '5', 10),
  eodClosePartialPct: parseFloat(process.env.EOD_CLOSE_PARTIAL_PCT || '100'),

  apiHost: process.env.API_HOST || '127.0.0.1',
  apiPort: parseInt(process.env.API_PORT || '7070', 10),
  apiToken: process.env.API_TOKEN || '',

  rhUser: process.env.RH_USERNAME,
  rhPass: process.env.RH_PASSWORD,

  maxConcurrentCrypto: parseInt(process.env.MAX_CONCURRENT_CRYPTO || '3', 10),

  files: {
    overrides: path.join(__dirname, '..', 'config', 'overrides.json'),
    tradesCsv: path.join(__dirname, '..', 'var', 'trades.csv'),
    mtmCsv: path.join(__dirname, '..', 'var', 'mtm.csv'),
    logFile: path.join(__dirname, '..', 'var', 'trade.log')
  },

  tickers: baseConfig.tickers || []
};