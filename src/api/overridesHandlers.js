import { withScope } from '../utils/logging.mjs';
import { loadConfig } from '../utils/config.mjs';
import { readJsonSafe, writeJsonAtomic, withLock } from '../utils/atomicFile.js';

const log = withScope('overrides');

export async function setPercent(req, res) {
  const cfg = await loadConfig();
  const lock = cfg.files.overrides + '.lock';
  try {
    const result = await withLock(lock, async () => {
      const cur = await readJsonSafe(cfg.files.overrides);
      const next = { ...cur, [req.params.symbol]: { mode: 'percent', ...req.body } };
      await writeJsonAtomic(cfg.files.overrides, next);
      return next;
    });
    res.json({ ok: true, overrides: result });
  } catch (err) {
    log.error({ err }, 'setPercent failed');
    res.status(500).json({ ok: false, error: 'Failed to update overrides' });
  }
}
