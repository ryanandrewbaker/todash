import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";
import type { GovernanceMode, ScopeKind, StrategyKind } from "../domain/types.js";

export function appendAudit(
  db: Db,
  entry: {
    actor?: string | null;
    entityKind: string;
    entityId: string;
    field: string;
    previousValue?: string | null;
    newValue?: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO audit_log (id, at, actor, entity_kind, entity_id, field, previous_value, new_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    Date.now(),
    entry.actor ?? "local",
    entry.entityKind,
    entry.entityId,
    entry.field,
    entry.previousValue ?? null,
    entry.newValue ?? null,
  );
}

export function upsertWorkflow(
  db: Db,
  input: { id?: string; name: string; purpose?: string; subagentIdentity?: string | null; actor?: string },
): string {
  const id = input.id ?? slug(input.name);
  const existing = db.prepare("SELECT * FROM workflows WHERE id = ?").get(id) as
    | { name: string; purpose: string | null; subagent_identity: string | null }
    | undefined;
  if (existing) {
    db.prepare(
      "UPDATE workflows SET name = ?, purpose = ?, subagent_identity = ? WHERE id = ?",
    ).run(input.name, input.purpose ?? null, input.subagentIdentity ?? existing.subagent_identity, id);
    if (existing.name !== input.name) {
      appendAudit(db, {
        actor: input.actor,
        entityKind: "workflow",
        entityId: id,
        field: "name",
        previousValue: existing.name,
        newValue: input.name,
      });
    }
    return id;
  }
  db.prepare(
    "INSERT INTO workflows (id, name, purpose, subagent_identity) VALUES (?, ?, ?, ?)",
  ).run(id, input.name, input.purpose ?? null, input.subagentIdentity ?? `todash-${id}`);
  appendAudit(db, {
    actor: input.actor,
    entityKind: "workflow",
    entityId: id,
    field: "created",
    newValue: input.name,
  });
  return id;
}

export function upsertRuleset(
  db: Db,
  input: { id?: string; name: string; governanceMode: GovernanceMode; actor?: string },
): string {
  const id = input.id ?? slug(input.name);
  const existing = db.prepare("SELECT governance_mode FROM rulesets WHERE id = ?").get(id) as
    | { governance_mode: string }
    | undefined;
  if (existing) {
    db.prepare("UPDATE rulesets SET name = ?, governance_mode = ? WHERE id = ?").run(
      input.name,
      input.governanceMode,
      id,
    );
    if (existing.governance_mode !== input.governanceMode) {
      appendAudit(db, {
        actor: input.actor,
        entityKind: "ruleset",
        entityId: id,
        field: "governance_mode",
        previousValue: existing.governance_mode,
        newValue: input.governanceMode,
      });
    }
    return id;
  }
  db.prepare("INSERT INTO rulesets (id, name, governance_mode) VALUES (?, ?, ?)").run(
    id,
    input.name,
    input.governanceMode,
  );
  appendAudit(db, {
    actor: input.actor,
    entityKind: "ruleset",
    entityId: id,
    field: "created",
    newValue: input.name,
  });
  return id;
}

export function setRule(
  db: Db,
  input: {
    rulesetId: string;
    workflowId: string;
    strategyKind: StrategyKind;
    modelId?: string | null;
    parameters?: Record<string, string>;
    overridable?: boolean;
    actor?: string;
  },
): void {
  const existing = db
    .prepare("SELECT * FROM ruleset_rules WHERE ruleset_id = ? AND workflow_id = ?")
    .get(input.rulesetId, input.workflowId) as
    | { id: string; strategy_kind: string; model_id: string | null; parameters: string }
    | undefined;
  const parameters = JSON.stringify(input.parameters ?? {});
  if (existing) {
    db.prepare(
      `UPDATE ruleset_rules SET strategy_kind = ?, model_id = ?, parameters = ?, overridable = ?
       WHERE id = ?`,
    ).run(
      input.strategyKind,
      input.modelId ?? null,
      parameters,
      input.overridable === false ? 0 : 1,
      existing.id,
    );
    appendAudit(db, {
      actor: input.actor,
      entityKind: "rule",
      entityId: existing.id,
      field: "strategy",
      previousValue: JSON.stringify({
        kind: existing.strategy_kind,
        modelId: existing.model_id,
        parameters: existing.parameters,
      }),
      newValue: JSON.stringify({
        kind: input.strategyKind,
        modelId: input.modelId ?? null,
        parameters,
      }),
    });
    return;
  }
  const id = randomUUID();
  db.prepare(
    `INSERT INTO ruleset_rules (id, ruleset_id, workflow_id, strategy_kind, model_id, parameters, overridable)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.rulesetId,
    input.workflowId,
    input.strategyKind,
    input.modelId ?? null,
    parameters,
    input.overridable === false ? 0 : 1,
  );
  appendAudit(db, {
    actor: input.actor,
    entityKind: "rule",
    entityId: id,
    field: "created",
    newValue: JSON.stringify({
      workflowId: input.workflowId,
      kind: input.strategyKind,
      modelId: input.modelId ?? null,
    }),
  });
}

export function bindRuleset(
  db: Db,
  input: { rulesetId: string; scopeKind: ScopeKind; scopeId: string; actor?: string },
): string {
  const existing = db
    .prepare(
      "SELECT id FROM ruleset_bindings WHERE ruleset_id = ? AND scope_kind = ? AND scope_id = ?",
    )
    .get(input.rulesetId, input.scopeKind, input.scopeId) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = randomUUID();
  db.prepare(
    "INSERT INTO ruleset_bindings (id, ruleset_id, scope_kind, scope_id, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, input.rulesetId, input.scopeKind, input.scopeId, Date.now());
  appendAudit(db, {
    actor: input.actor,
    entityKind: "binding",
    entityId: id,
    field: "created",
    newValue: `${input.scopeKind}:${input.scopeId}`,
  });
  return id;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
