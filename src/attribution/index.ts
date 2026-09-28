import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";
import {
  UNALLOCATED,
  exact,
  type Attribution,
  type CorrelationStatus,
  type ExecutionStrategy,
  type SelectedMode,
} from "../domain/types.js";
import { correlateEvent } from "./correlate.js";
import { resolveProject, type ProjectMapping } from "./project.js";
import { resolveRepository, type RepoLookup } from "./repository.js";
import { mapWorkflowIdentity, selectedModeFromHook } from "./workflow.js";
import { effectivePolicyFor } from "../policy/effective.js";
import { observeModel } from "../models/registry.js";
import { upsertUser } from "../db/org.js";

type HookRow = {
  id: string;
  event_timestamp: number | null;
  hook_type: string;
  user_email: string | null;
  workspace_roots: string;
  conversation_id: string | null;
  generation_id: string | null;
  selected_model: string | null;
  selected_model_id: string | null;
  cwd: string | null;
  file_path: string | null;
  subagent_id: string | null;
  subagent_type: string | null;
  subagent_task: string | null;
  subagent_model: string | null;
  payload: string;
};

type BillingRow = {
  id: string;
  event_timestamp: number | null;
  user_email: string | null;
  conversation_id: string | null;
  executed_model: string | null;
  kind: string | null;
  is_chargeable: number | null;
  charged_cents: number | null;
  attributed_cents: number | null;
  cursor_token_fee: number | null;
};

type UsageRow = {
  id: string;
  event_timestamp: number | null;
  correlation_status: CorrelationStatus;
  user_email: string | null;
  user_confidence: Attribution;
  repository: string | null;
  repository_confidence: Attribution;
  project_id: string | null;
  project_confidence: Attribution;
  workflow_id: string | null;
  workflow_confidence: Attribution;
  policy_strategy: string | null;
  policy_confidence: Attribution;
  selected_mode: SelectedMode | null;
  selected_model: string | null;
  selected_confidence: Attribution;
  executed_model: string | null;
  executed_confidence: Attribution;
  attributed_consumption_cents: number | null;
  billed_usage_cents: number | null;
  cost_confidence: Attribution;
};

const GENERATION_HOOKS = new Set([
  "stop",
  "beforeSubmitPrompt",
  "sessionStart",
  "sessionEnd",
  "subagentStart",
  "subagentStop",
  "afterAgentResponse",
]);

export function insertHookEvent(
  db: Db,
  row: Omit<HookRow, "id"> & { id?: string },
): string {
  const id = row.id ?? randomUUID();
  db.prepare(
    `INSERT INTO hook_events (
      id, received_at, event_timestamp, hook_type, user_email, workspace_roots,
      conversation_id, generation_id, selected_model, selected_model_id, cwd, file_path,
      subagent_id, subagent_type, subagent_task, subagent_model, payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    Date.now(),
    row.event_timestamp,
    row.hook_type,
    row.user_email,
    row.workspace_roots,
    row.conversation_id,
    row.generation_id,
    row.selected_model,
    row.selected_model_id,
    row.cwd,
    row.file_path,
    row.subagent_id,
    row.subagent_type,
    row.subagent_task,
    row.subagent_model,
    row.payload,
  );
  return id;
}

export function insertBillingObservation(
  db: Db,
  observation: Omit<BillingRow, "id"> & { payload: Record<string, unknown>; id?: string },
): string {
  const id = observation.id ?? randomUUID();
  db.prepare(
    `INSERT INTO billing_events (
      id, received_at, event_timestamp, user_email, conversation_id, executed_model,
      kind, is_chargeable, charged_cents, attributed_cents, cursor_token_fee, payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    Date.now(),
    observation.event_timestamp,
    observation.user_email,
    observation.conversation_id,
    observation.executed_model,
    observation.kind,
    observation.is_chargeable,
    observation.charged_cents,
    observation.attributed_cents,
    observation.cursor_token_fee,
    JSON.stringify(observation.payload),
  );
  return id;
}

function loadWorkflows(db: Db): { id: string; subagentIdentity: string | null }[] {
  return db
    .prepare("SELECT id, subagent_identity AS subagentIdentity FROM workflows")
    .all() as { id: string; subagentIdentity: string | null }[];
}

function loadProjectMappings(db: Db): ProjectMapping[] {
  return db
    .prepare(
      "SELECT project_id AS projectId, repository, path_prefix AS pathPrefix FROM project_repositories",
    )
    .all() as ProjectMapping[];
}

function attachSource(db: Db, usageId: string, kind: "hook" | "billing", sourceId: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO usage_record_sources (usage_record_id, source_kind, source_id) VALUES (?, ?, ?)",
  ).run(usageId, kind, sourceId);
}

function writeUsage(db: Db, row: UsageRow): void {
  const existing = db.prepare("SELECT id FROM usage_records WHERE id = ?").get(row.id);
  if (existing) {
    db.prepare(
      `UPDATE usage_records SET
        event_timestamp = ?, correlation_status = ?, user_email = ?, user_confidence = ?,
        repository = ?, repository_confidence = ?, project_id = ?, project_confidence = ?,
        workflow_id = ?, workflow_confidence = ?, policy_strategy = ?, policy_confidence = ?,
        selected_mode = ?, selected_model = ?, selected_confidence = ?,
        executed_model = ?, executed_confidence = ?,
        attributed_consumption_cents = ?, billed_usage_cents = ?, cost_confidence = ?
      WHERE id = ?`,
    ).run(
      row.event_timestamp,
      row.correlation_status,
      row.user_email,
      row.user_confidence,
      row.repository,
      row.repository_confidence,
      row.project_id,
      row.project_confidence,
      row.workflow_id,
      row.workflow_confidence,
      row.policy_strategy,
      row.policy_confidence,
      row.selected_mode,
      row.selected_model,
      row.selected_confidence,
      row.executed_model,
      row.executed_confidence,
      row.attributed_consumption_cents,
      row.billed_usage_cents,
      row.cost_confidence,
      row.id,
    );
    return;
  }
  db.prepare(
    `INSERT INTO usage_records (
      id, created_at, event_timestamp, correlation_status, user_email, user_confidence,
      repository, repository_confidence, project_id, project_confidence, workflow_id,
      workflow_confidence, policy_strategy, policy_confidence, selected_mode, selected_model,
      selected_confidence, executed_model, executed_confidence, attributed_consumption_cents,
      billed_usage_cents, cost_confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    Date.now(),
    row.event_timestamp,
    row.correlation_status,
    row.user_email,
    row.user_confidence,
    row.repository,
    row.repository_confidence,
    row.project_id,
    row.project_confidence,
    row.workflow_id,
    row.workflow_confidence,
    row.policy_strategy,
    row.policy_confidence,
    row.selected_mode,
    row.selected_model,
    row.selected_confidence,
    row.executed_model,
    row.executed_confidence,
    row.attributed_consumption_cents,
    row.billed_usage_cents,
    row.cost_confidence,
  );
}

function emptyUsage(id: string): UsageRow {
  return {
    id,
    event_timestamp: null,
    correlation_status: "unmatched",
    user_email: null,
    user_confidence: "unallocated",
    repository: null,
    repository_confidence: "unallocated",
    project_id: null,
    project_confidence: "unallocated",
    workflow_id: null,
    workflow_confidence: "unallocated",
    policy_strategy: null,
    policy_confidence: "unallocated",
    selected_mode: null,
    selected_model: null,
    selected_confidence: "unallocated",
    executed_model: null,
    executed_confidence: "unallocated",
    attributed_consumption_cents: null,
    billed_usage_cents: null,
    cost_confidence: "unallocated",
  };
}

function findHookUsageRecord(db: Db, hook: HookRow): UsageRow | undefined {
  if (hook.generation_id && hook.user_email) {
    const sources = db
      .prepare(
        `SELECT u.* FROM usage_records u
         JOIN usage_record_sources s ON s.usage_record_id = u.id
         JOIN hook_events h ON h.id = s.source_id AND s.source_kind = 'hook'
         WHERE h.generation_id = ? AND h.user_email = ?`,
      )
      .all(hook.generation_id, hook.user_email) as UsageRow[];
    if (sources[0]) return sources[0];
  }
  if (hook.hook_type === "subagentStart" && hook.conversation_id && hook.user_email) {
    const latest = db
      .prepare(
        `SELECT u.* FROM usage_records u
         JOIN usage_record_sources s ON s.usage_record_id = u.id
         JOIN hook_events h ON h.id = s.source_id AND s.source_kind = 'hook'
         WHERE h.conversation_id = ? AND h.user_email = ?
         ORDER BY COALESCE(u.event_timestamp, 0) DESC LIMIT 1`,
      )
      .get(hook.conversation_id, hook.user_email) as UsageRow | undefined;
    return latest;
  }
  return undefined;
}

function applyPolicy(
  db: Db,
  row: UsageRow,
): UsageRow {
  if (!row.workflow_id || row.workflow_confidence !== "exact") {
    return {
      ...row,
      policy_strategy: null,
      policy_confidence: "unallocated",
    };
  }
  const policy = effectivePolicyFor(db, {
    userEmail: row.user_email,
    repository: row.repository,
    projectId: row.project_id,
    workflowId: row.workflow_id,
  });
  if (!policy) {
    return { ...row, policy_strategy: null, policy_confidence: "unallocated" };
  }
  const strategy: ExecutionStrategy = {
    kind: policy.strategyKind,
    modelId: policy.modelId,
    parameters: policy.parameters,
  };
  return {
    ...row,
    policy_strategy: JSON.stringify(strategy),
    policy_confidence: "exact",
  };
}

export function deriveFromHook(
  db: Db,
  hookId: string,
  options: { lookup?: RepoLookup } = {},
): string | null {
  const hook = db.prepare("SELECT * FROM hook_events WHERE id = ?").get(hookId) as HookRow | undefined;
  if (!hook) return null;
  if (!GENERATION_HOOKS.has(hook.hook_type) && !hook.generation_id) return null;

  const existing = findHookUsageRecord(db, hook);
  const row = existing ? { ...existing } : emptyUsage(randomUUID());

  row.event_timestamp = hook.event_timestamp ?? row.event_timestamp;
  if (hook.user_email) {
    row.user_email = hook.user_email;
    row.user_confidence = "exact";
    upsertUser(db, { email: hook.user_email });
  }

  const roots = JSON.parse(hook.workspace_roots || "[]") as string[];
  const repository = resolveRepository(roots, {
    cwd: hook.cwd,
    filePath: hook.file_path,
    lookup: options.lookup,
  });
  if (repository.confidence !== "unallocated") {
    row.repository = repository.value;
    row.repository_confidence = repository.confidence;
  }

  const project = resolveProject(
    { value: row.repository, confidence: row.repository_confidence },
    loadProjectMappings(db),
  );
  row.project_id = project.value;
  row.project_confidence = project.confidence;

  const workflowId = mapWorkflowIdentity(hook.subagent_type, loadWorkflows(db));
  if (workflowId) {
    row.workflow_id = workflowId;
    row.workflow_confidence = "exact";
  }

  const selected = selectedModeFromHook({
    selectedModel: hook.selected_model,
    selectedModelId: hook.selected_model_id,
    subagentType: hook.subagent_type,
    mappedWorkflowId: workflowId,
  });
  if (selected.mode) {
    row.selected_mode = selected.mode;
    row.selected_model = selected.model;
    row.selected_confidence = "exact";
  } else if (selected.model) {
    row.selected_model = selected.model;
    row.selected_confidence = "exact";
  }

  const next = applyPolicy(db, row);
  if (next.selected_model) observeModel(db, next.selected_model);
  writeUsage(db, next);
  attachSource(db, next.id, "hook", hookId);
  return next.id;
}

function loadUsage(db: Db, id: string): UsageRow {
  return db.prepare("SELECT * FROM usage_records WHERE id = ?").get(id) as UsageRow;
}

function hookDerivedRecords(db: Db): Array<UsageRow & { conversation_id: string | null }> {
  return db
    .prepare(
      `SELECT DISTINCT u.*, h.conversation_id AS conversation_id
       FROM usage_records u
       JOIN usage_record_sources s ON s.usage_record_id = u.id AND s.source_kind = 'hook'
       JOIN hook_events h ON h.id = s.source_id`,
    )
    .all() as Array<UsageRow & { conversation_id: string | null }>;
}

function applyBillingToUsage(db: Db, usage: UsageRow, billing: BillingRow, status: CorrelationStatus): void {
  const next: UsageRow = { ...usage, correlation_status: status };
  if (billing.user_email && next.user_confidence === "unallocated") {
    next.user_email = billing.user_email;
    next.user_confidence = "exact";
    upsertUser(db, { email: billing.user_email });
  }
  if (billing.executed_model) {
    next.executed_model = billing.executed_model;
    next.executed_confidence = status === "inferred" ? "inferred" : "exact";
  }
  if (billing.attributed_cents != null) {
    next.attributed_consumption_cents = billing.attributed_cents;
  }
  if (billing.is_chargeable && billing.charged_cents != null) {
    next.billed_usage_cents = billing.charged_cents;
  } else if (billing.charged_cents != null && billing.is_chargeable == null) {
    next.billed_usage_cents = billing.charged_cents;
  }
  if (billing.attributed_cents != null || billing.charged_cents != null) {
    next.cost_confidence = status === "inferred" ? "inferred" : "exact";
  }
  writeUsage(db, next);
  if (next.executed_model) observeModel(db, next.executed_model);
  attachSource(db, next.id, "billing", billing.id);
}

function billingOnlyRecord(db: Db, billing: BillingRow): string {
  const row = emptyUsage(randomUUID());
  row.event_timestamp = billing.event_timestamp;
  row.correlation_status = "unmatched";
  if (billing.user_email) {
    row.user_email = billing.user_email;
    row.user_confidence = "exact";
    upsertUser(db, { email: billing.user_email });
  }
  if (billing.executed_model) {
    row.executed_model = billing.executed_model;
    row.executed_confidence = "exact";
  }
  if (billing.attributed_cents != null) {
    row.attributed_consumption_cents = billing.attributed_cents;
  }
  if (billing.charged_cents != null && billing.is_chargeable !== 0) {
    row.billed_usage_cents = billing.charged_cents;
  }
  if (billing.attributed_cents != null || billing.charged_cents != null) {
    row.cost_confidence = "exact";
  }
  writeUsage(db, row);
  if (row.executed_model) observeModel(db, row.executed_model);
  attachSource(db, row.id, "billing", billing.id);
  return row.id;
}

export function deriveFromBilling(db: Db, billingId: string): string {
  const billing = db.prepare("SELECT * FROM billing_events WHERE id = ?").get(billingId) as
    | BillingRow
    | undefined;
  if (!billing) throw new Error(`unknown billing event ${billingId}`);

  const already = db
    .prepare(
      "SELECT usage_record_id FROM usage_record_sources WHERE source_kind = 'billing' AND source_id = ?",
    )
    .get(billingId) as { usage_record_id: string } | undefined;
  if (already) return already.usage_record_id;

  const hookRecords = hookDerivedRecords(db);
  const result = correlateEvent(
    {
      id: billing.id,
      userEmail: billing.user_email,
      conversationId: billing.conversation_id,
      timestamp: billing.event_timestamp,
    },
    hookRecords.map((record) => ({
      id: record.id,
      userEmail: record.user_email,
      conversationId: record.conversation_id,
      timestamp: record.event_timestamp,
    })),
  );

  if (result.status === "exact" || result.status === "inferred") {
    const usage = loadUsage(db, result.matchId);
    applyBillingToUsage(db, usage, billing, result.status);
    return usage.id;
  }

  return billingOnlyRecord(db, billing);
}

export function rebuildUsageRecords(db: Db, options: { lookup?: RepoLookup } = {}): void {
  db.exec("DELETE FROM usage_record_sources");
  db.exec("DELETE FROM usage_records");
  const hooks = db.prepare("SELECT id FROM hook_events ORDER BY received_at").all() as { id: string }[];
  for (const hook of hooks) deriveFromHook(db, hook.id, options);
  const bills = db.prepare("SELECT id FROM billing_events ORDER BY received_at").all() as { id: string }[];
  for (const bill of bills) deriveFromBilling(db, bill.id);
}

export { UNALLOCATED, exact };
