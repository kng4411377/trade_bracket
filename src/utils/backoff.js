export const withBackoff = async (fn, name, { retries = 5, baseMs = 1000 } = {}) => {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); }
    catch (err) {
      if (attempt >= retries) throw err;
      const delay = Math.min(30000, baseMs * 2 ** (attempt - 1));
      await new Promise(r => setTimeout(r, delay));
    }
  }
};