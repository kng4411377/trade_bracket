import fs from 'node:fs/promises';
import path from 'node:path';

export async function readJsonSafe(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

export async function writeJsonAtomic(file, data) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = file + '.tmp-' + Date.now();
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, file); // atomic on same filesystem
}

export async function withLock(lockFile, fn) {
  const handle = await fs.open(lockFile, 'wx').catch(err => {
    if (err.code === 'EEXIST') throw new Error('Overrides file is locked'); else throw err;
  });
  try { return await fn(); }
  finally { await handle.close(); await fs.rm(lockFile, { force: true }); }
}
