export async function tryOrWarn(taskName, fn, { logger, fallback = undefined, rethrow = false } = {}) {
  try { return await fn(); }
  catch (err) {
    (logger?.error ?? console.error)({ err, task: taskName }, `${taskName} failed`);
    if (rethrow) throw err;
    return fallback;
  }
}
