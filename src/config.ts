import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export function todashHome(): string {
  const fromEnv = process.env.TODASH_HOME;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return path.join(os.homedir(), ".todash");
}

export function ensureHome(): string {
  const home = todashHome();
  fs.mkdirSync(home, { recursive: true });
  return home;
}

export function dbPath(): string {
  return path.join(ensureHome(), "todash.db");
}

export const DEFAULT_PORT = 4780;
