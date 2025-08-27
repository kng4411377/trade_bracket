import { cfg } from './config.js';
import { consoleLog, fileLog, session } from './utils/logging.js';
import { startApi } from './api/server.js';
import { watchOverrides } from './core/overrides.js';
import * as RH from './services/robinhood.js';
import { startManager } from './core/bracketManager.js';

consoleLog.info({
  session,
  dryRun: cfg.dryRun,
  slippageBps: cfg.dryRunSlippageBps,
  feePerTrade: cfg.dryRunFee
}, 'Run config');

await RH.login();
consoleLog.info('Logged into Robinhood.'); fileLog.info('Logged into Robinhood.');

watchOverrides();
startApi();

const stop = startManager(cfg.tickers);

const shutdown = () => {
  stop();
  consoleLog.warn('Shutting down...');
  fileLog.warn('Shutting down...');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);