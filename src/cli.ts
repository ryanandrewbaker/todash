#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { openDb } from "./db/client.js";
import { DEFAULT_PORT, dbPath, ensureHome } from "./config.js";
import { createApp } from "./server/app.js";
import { ingestHookPayload } from "./ingest/hooks/capture.js";
import { installUserHooks } from "./ingest/hooks/install.js";
import { ingestBillingPayload, pollBilling } from "./ingest/admin-api/poller.js";
import { applyRepositoryRuleset, applyUserRuleset } from "./policy/compiler.js";
import { getOrg } from "./db/org.js";
import { refreshCatalog, refreshObservedRegistry } from "./models/registry.js";
import { rebuildUsageRecords } from "./attribution/index.js";

function help(): string {
  return `Todash — govern, route and understand agentic software development.

Usage:
  todash serve [--port 4780]
  todash hook install
  todash hook capture
  todash apply [--user email] [--repo path --repository-id id]
  todash ingest billing [--file events.json]
  todash models refresh
  todash rebuild
`;
}

function captureCommandLine(): string {
  const entry = fileURLToPath(import.meta.url);
  if (entry.endsWith(".ts")) {
    const tsxCli = path.resolve(path.dirname(entry), "../node_modules/tsx/dist/cli.mjs");
    return `${process.execPath} ${tsxCli} ${entry} hook capture`;
  }
  return `${process.execPath} ${entry} hook capture`;
}

async function main(argv: string[]): Promise<void> {
  const [command, subcommand, ...rest] = argv;
  ensureHome();

  if (!command || command === "help" || command === "--help") {
    process.stdout.write(help());
    return;
  }

  if (command === "serve") {
    const portFlag = rest.includes("--port") ? rest[rest.indexOf("--port") + 1] : undefined;
    const port = Number(portFlag ?? process.env.PORT ?? DEFAULT_PORT);
    const db = openDb();
    const app = createApp(db);
    serve({ fetch: app.fetch, port });
    process.stdout.write(`Todash listening on http://127.0.0.1:${port}\n`);
    process.stdout.write(`Database ${dbPath()}\n`);
    return;
  }

  if (command === "hook" && subcommand === "install") {
    const commandLine = captureCommandLine();
    const result = installUserHooks(commandLine);
    process.stdout.write(`Installed observe hooks in ${result.path}\n`);
    process.stdout.write(`Command: ${commandLine}\n`);
    return;
  }

  if (command === "hook" && subcommand === "capture") {
    const raw = fs.readFileSync(0, "utf8");
    if (!raw.trim()) {
      process.stdout.write("{}\n");
      return;
    }
    try {
      const payload = JSON.parse(raw) as Record<string, unknown>;
      const db = openDb();
      ingestHookPayload(db, payload);
    } catch {
      // Fail open: never block the agent loop.
    }
    process.stdout.write("{}\n");
    return;
  }

  if (command === "apply") {
    const db = openDb();
    const userIndex = rest.indexOf("--user");
    const repoIndex = rest.indexOf("--repo");
    const repoIdIndex = rest.indexOf("--repository-id");
    if (repoIndex >= 0 && repoIdIndex >= 0) {
      const written = applyRepositoryRuleset(db, rest[repoIndex + 1]!, rest[repoIdIndex + 1]!);
      process.stdout.write(`Wrote ${written.length} repository subagents\n`);
      return;
    }
    const email = userIndex >= 0 ? rest[userIndex + 1]! : "local";
    const written = applyUserRuleset(db, email);
    process.stdout.write(`Wrote ${written.length} user subagents\n`);
    return;
  }

  if (command === "ingest" && subcommand === "billing") {
    const db = openDb();
    const fileIndex = rest.indexOf("--file");
    if (fileIndex >= 0) {
      const payload = JSON.parse(fs.readFileSync(rest[fileIndex + 1]!, "utf8")) as
        | Record<string, unknown>
        | { events: Record<string, unknown>[] };
      const events = Array.isArray((payload as { events?: unknown }).events)
        ? (payload as { events: Record<string, unknown>[] }).events
        : [payload as Record<string, unknown>];
      for (const event of events) ingestBillingPayload(db, event);
      process.stdout.write(`Ingested ${events.length} billing events\n`);
      return;
    }
    const org = getOrg(db);
    if (!org.cursor_api_key) {
      process.stderr.write("Configure a Cursor Admin API key first.\n");
      process.exitCode = 1;
      return;
    }
    const endDate = Date.now();
    const count = await pollBilling(
      db,
      { apiKey: org.cursor_api_key },
      { startDate: endDate - 24 * 60 * 60 * 1000, endDate },
    );
    process.stdout.write(`Polled ${count} billing events\n`);
    return;
  }

  if (command === "models" && subcommand === "refresh") {
    const db = openDb();
    const org = getOrg(db);
    if (org.cursor_api_key) {
      const result = await refreshCatalog(db, { apiKey: org.cursor_api_key });
      process.stdout.write(
        result.available
          ? `Catalog snapshot stored (${result.alerts} alerts)\n`
          : `Catalog unavailable; refreshed observed registry (${result.alerts} alerts)\n`,
      );
      return;
    }
    const alerts = refreshObservedRegistry(db);
    process.stdout.write(`Observed registry snapshot stored (${alerts} alerts)\n`);
    return;
  }

  if (command === "rebuild") {
    const db = openDb();
    rebuildUsageRecords(db);
    process.stdout.write("Rebuilt derived usage records from raw observations.\n");
    return;
  }

  process.stderr.write(help());
  process.exitCode = 1;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
