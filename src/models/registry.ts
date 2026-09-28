import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";
import type { ModelSource } from "../domain/types.js";
import { fetchModelCatalog, type AdminApiConfig } from "../ingest/admin-api/client.js";

type RegistryModel = {
  id: string;
  displayName?: string | null;
  source: ModelSource;
};

export function observeModel(db: Db, modelId: string, at = Date.now()): void {
  if (!modelId) return;
  const existing = db.prepare("SELECT id FROM models WHERE id = ?").get(modelId);
  if (existing) {
    db.prepare("UPDATE models SET last_seen_at = ? WHERE id = ?").run(at, modelId);
    return;
  }
  db.prepare(
    "INSERT INTO models (id, display_name, source, notes, last_seen_at, admin_price_note) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(modelId, modelId, "observed", null, at, null);
}

export function upsertAdminModel(
  db: Db,
  input: { id: string; displayName?: string; notes?: string; adminPriceNote?: string },
): void {
  const existing = db.prepare("SELECT id FROM models WHERE id = ?").get(input.id);
  if (existing) {
    db.prepare(
      "UPDATE models SET display_name = COALESCE(?, display_name), notes = COALESCE(?, notes), admin_price_note = COALESCE(?, admin_price_note), source = CASE WHEN source = 'catalog' THEN source ELSE 'admin' END WHERE id = ?",
    ).run(input.displayName ?? null, input.notes ?? null, input.adminPriceNote ?? null, input.id);
    return;
  }
  db.prepare(
    "INSERT INTO models (id, display_name, source, notes, last_seen_at, admin_price_note) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    input.id,
    input.displayName ?? input.id,
    "admin",
    input.notes ?? null,
    Date.now(),
    input.adminPriceNote ?? null,
  );
}

function currentRegistry(db: Db): RegistryModel[] {
  return db
    .prepare("SELECT id, display_name AS displayName, source FROM models")
    .all() as RegistryModel[];
}

function snapshotIds(payload: string): Set<string> {
  const parsed = JSON.parse(payload) as { models?: Array<{ id: string }> };
  return new Set((parsed.models ?? []).map((model) => model.id));
}

export function snapshotRegistry(
  db: Db,
  source: "catalog" | "observed",
  models: RegistryModel[],
): string {
  const id = randomUUID();
  db.prepare("INSERT INTO model_snapshots (id, at, source, payload) VALUES (?, ?, ?, ?)").run(
    id,
    Date.now(),
    source,
    JSON.stringify({ models }),
  );
  return id;
}

export function diffAgainstPrevious(
  db: Db,
  source: "catalog" | "observed",
  current: RegistryModel[],
): Array<{ kind: string; modelId: string; summary: string; details: Record<string, unknown> }> {
  const previous = db
    .prepare(
      "SELECT payload FROM model_snapshots WHERE source = ? ORDER BY at DESC LIMIT 1",
    )
    .get(source) as { payload: string } | undefined;
  if (!previous) return [];
  const before = snapshotIds(previous.payload);
  const after = new Set(current.map((model) => model.id));
  const alerts: Array<{
    kind: string;
    modelId: string;
    summary: string;
    details: Record<string, unknown>;
  }> = [];
  for (const id of after) {
    if (!before.has(id)) {
      alerts.push({
        kind: "new_model",
        modelId: id,
        summary: `Model identifier ${id} appeared that was not in the previous ${source} snapshot.`,
        details: { source, modelId: id },
      });
    }
  }
  for (const id of before) {
    if (!after.has(id)) {
      alerts.push({
        kind: "model_removed",
        modelId: id,
        summary: `Model identifier ${id} is absent from the current ${source} snapshot.`,
        details: { source, modelId: id },
      });
    }
  }
  return alerts;
}

function recordAlerts(
  db: Db,
  alerts: Array<{ kind: string; modelId: string; summary: string; details: Record<string, unknown> }>,
): void {
  const insert = db.prepare(
    "INSERT INTO alerts (id, created_at, kind, model_id, summary, details, acknowledged) VALUES (?, ?, ?, ?, ?, ?, 0)",
  );
  for (const alert of alerts) {
    insert.run(
      randomUUID(),
      Date.now(),
      alert.kind,
      alert.modelId,
      alert.summary,
      JSON.stringify(alert.details),
    );
  }
}

export function refreshObservedRegistry(db: Db): number {
  const executed = db
    .prepare(
      "SELECT DISTINCT executed_model AS id FROM usage_records WHERE executed_model IS NOT NULL",
    )
    .all() as { id: string }[];
  const selected = db
    .prepare(
      "SELECT DISTINCT selected_model AS id FROM usage_records WHERE selected_model IS NOT NULL",
    )
    .all() as { id: string }[];
  for (const row of [...executed, ...selected]) observeModel(db, row.id);
  const current = currentRegistry(db);
  const alerts = diffAgainstPrevious(db, "observed", current);
  snapshotRegistry(db, "observed", current);
  recordAlerts(db, alerts);
  return alerts.length;
}

function catalogModels(payload: Record<string, unknown>): RegistryModel[] {
  const providers = (payload.providers ?? []) as Array<{
    models?: Array<{ id: string; displayName?: string }>;
  }>;
  const models: RegistryModel[] = [];
  for (const provider of providers) {
    for (const model of provider.models ?? []) {
      models.push({ id: model.id, displayName: model.displayName ?? model.id, source: "catalog" });
    }
  }
  return models;
}

export async function refreshCatalog(
  db: Db,
  config: AdminApiConfig,
): Promise<{ available: boolean; alerts: number }> {
  const result = await fetchModelCatalog(config);
  if (!result.available || !result.payload) {
    refreshObservedRegistry(db);
    return { available: false, alerts: 0 };
  }
  const models = catalogModels(result.payload);
  for (const model of models) {
    const existing = db.prepare("SELECT id FROM models WHERE id = ?").get(model.id);
    if (existing) {
      db.prepare(
        "UPDATE models SET display_name = ?, source = 'catalog', last_seen_at = ? WHERE id = ?",
      ).run(model.displayName ?? model.id, Date.now(), model.id);
    } else {
      db.prepare(
        "INSERT INTO models (id, display_name, source, notes, last_seen_at, admin_price_note) VALUES (?, ?, 'catalog', NULL, ?, NULL)",
      ).run(model.id, model.displayName ?? model.id, Date.now());
    }
  }
  const alerts = diffAgainstPrevious(db, "catalog", models);
  snapshotRegistry(db, "catalog", models);
  recordAlerts(db, alerts);
  return { available: true, alerts: alerts.length };
}

export function alertImpact(db: Db, modelId: string): Record<string, unknown> {
  const workflows = db
    .prepare("SELECT DISTINCT workflow_id AS id FROM ruleset_rules WHERE model_id = ?")
    .all(modelId) as { id: string }[];
  const users = db
    .prepare(
      "SELECT COUNT(DISTINCT user_email) AS count FROM usage_records WHERE executed_model = ? OR selected_model = ?",
    )
    .get(modelId, modelId) as { count: number };
  const projects = db
    .prepare(
      "SELECT COUNT(DISTINCT project_id) AS count FROM usage_records WHERE (executed_model = ? OR selected_model = ?) AND project_id IS NOT NULL",
    )
    .get(modelId, modelId) as { count: number };
  const consumption = db
    .prepare(
      "SELECT COALESCE(SUM(attributed_consumption_cents), 0) AS cents FROM usage_records WHERE executed_model = ? AND event_timestamp >= ?",
    )
    .get(modelId, Date.now() - 30 * 24 * 60 * 60 * 1000) as { cents: number };
  return {
    workflows: workflows.map((row) => row.id),
    usersAffected: users.count,
    projectsWithActivity: projects.count,
    previous30DayAttributedCents: consumption.cents,
  };
}
