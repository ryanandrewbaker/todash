#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist/cli.js");
const src = path.join(root, "src/cli.ts");
const tsx = path.join(root, "node_modules/tsx/dist/cli.mjs");
const args = process.argv.slice(2);

if (existsSync(dist)) {
  const result = spawnSync(process.execPath, [dist, ...args], { stdio: "inherit", env: process.env });
  process.exit(result.status ?? 1);
}

const result = spawnSync(process.execPath, [tsx, src, ...args], { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
