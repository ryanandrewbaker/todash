import Database from "better-sqlite3";
import { dbPath } from "../config.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS org (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  seat_cost_cents INTEGER,
  cursor_api_key TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hook_events (
  id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL,
  event_timestamp INTEGER,
  hook_type TEXT NOT NULL,
  user_email TEXT,
  workspace_roots TEXT NOT NULL,
  conversation_id TEXT,
  generation_id TEXT,
  selected_model TEXT,
  selected_model_id TEXT,
  cwd TEXT,
  file_path TEXT,
  subagent_id TEXT,
  subagent_type TEXT,
  subagent_task TEXT,
  subagent_model TEXT,
  payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hook_conversation ON hook_events (user_email, conversation_id, event_timestamp);
CREATE INDEX IF NOT EXISTS idx_hook_generation ON hook_events (generation_id);

CREATE TABLE IF NOT EXISTS billing_events (
  id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL,
  event_timestamp INTEGER,
  user_email TEXT,
  conversation_id TEXT,
  executed_model TEXT,
  kind TEXT,
  is_chargeable INTEGER,
  charged_cents REAL,
  attributed_cents REAL,
  cursor_token_fee REAL,
  payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_conversation ON billing_events (user_email, conversation_id, event_timestamp);

CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  event_timestamp INTEGER,
  correlation_status TEXT NOT NULL,
  user_email TEXT,
  user_confidence TEXT NOT NULL,
  repository TEXT,
  repository_confidence TEXT NOT NULL,
  project_id TEXT,
  project_confidence TEXT NOT NULL,
  workflow_id TEXT,
  workflow_confidence TEXT NOT NULL,
  policy_strategy TEXT,
  policy_confidence TEXT NOT NULL,
  selected_mode TEXT,
  selected_model TEXT,
  selected_confidence TEXT NOT NULL,
  executed_model TEXT,
  executed_confidence TEXT NOT NULL,
  attributed_consumption_cents REAL,
  billed_usage_cents REAL,
  cost_confidence TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_record_sources (
  usage_record_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  PRIMARY KEY (usage_record_id, source_kind, source_id)
);

CREATE INDEX IF NOT EXISTS idx_usage_conversation_time ON usage_records (user_email, event_timestamp);

CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  display_name TEXT,
  seat_cost_cents INTEGER
);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  PRIMARY KEY (group_id, user_email)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_repositories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  repository TEXT NOT NULL,
  path_prefix TEXT
);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purpose TEXT,
  subagent_identity TEXT
);

CREATE TABLE IF NOT EXISTS rulesets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  governance_mode TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ruleset_rules (
  id TEXT PRIMARY KEY,
  ruleset_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  strategy_kind TEXT NOT NULL,
  model_id TEXT,
  parameters TEXT NOT NULL,
  overridable INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ruleset_bindings (
  id TEXT PRIMARY KEY,
  ruleset_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  actor TEXT,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT
);

CREATE TABLE IF NOT EXISTS model_snapshots (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  source TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  source TEXT NOT NULL,
  notes TEXT,
  last_seen_at INTEGER,
  admin_price_note TEXT
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  model_id TEXT,
  summary TEXT NOT NULL,
  details TEXT NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0
);
`;

export type Db = Database.Database;

export function openDb(file = dbPath()): Db {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  seedOrg(db);
  return db;
}

export function openMemoryDb(): Db {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  seedOrg(db);
  return db;
}

function seedOrg(db: Db): void {
  const row = db.prepare("SELECT id FROM org LIMIT 1").get();
  if (row) return;
  db.prepare(
    "INSERT INTO org (id, name, seat_cost_cents, cursor_api_key, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run("org", "Todash", null, null, Date.now());
}
