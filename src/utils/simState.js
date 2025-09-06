// src/utils/simState.js
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve(".data");
const STATE_FILE = path.join(DATA_DIR, "sim_state.json");

function defaultState() {
  return { positions: {}, orders: [], trades: [] };
}

export async function loadState() {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const raw = await fsp.readFile(STATE_FILE, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === "ENOENT") {
      const s = defaultState();
      await saveState(s);
      return s;
    }
    throw e;
  }
}

export async function saveState(state) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

export function statePath() { return STATE_FILE; }
