import type { Db } from "../db/client.js";
import {
  type GovernanceMode,
  type ScopeKind,
  type StrategyKind,
} from "../domain/types.js";

const SCOPE_ORDER: ScopeKind[] = [
  "organisation",
  "group",
  "project",
  "repository",
  "user",
];

export type EffectiveRule = {
  workflowId: string;
  rulesetId: string;
  rulesetName: string;
  scopeKind: ScopeKind;
  scopeId: string;
  strategyKind: StrategyKind;
  modelId: string | null;
  parameters: Record<string, string>;
  overridable: boolean;
  governanceMode: GovernanceMode;
};

type BindingRow = {
  bindingId: string;
  rulesetId: string;
  rulesetName: string;
  governanceMode: GovernanceMode;
  scopeKind: ScopeKind;
  scopeId: string;
};

type RuleRow = {
  workflowId: string;
  strategyKind: StrategyKind;
  modelId: string | null;
  parameters: string;
  overridable: number;
};

export type PolicyContext = {
  userEmail?: string | null;
  repository?: string | null;
  projectId?: string | null;
  groupId?: string | null;
};

function groupForUser(db: Db, email: string | null | undefined): string | null {
  if (!email) return null;
  const row = db
    .prepare("SELECT group_id FROM group_members WHERE user_email = ? LIMIT 1")
    .get(email) as { group_id: string } | undefined;
  return row?.group_id ?? null;
}

function applicableBindings(db: Db, context: PolicyContext): BindingRow[] {
  const groupId = context.groupId ?? groupForUser(db, context.userEmail);
  const rows = db
    .prepare(
      `SELECT b.id AS bindingId, b.ruleset_id AS rulesetId, r.name AS rulesetName,
              r.governance_mode AS governanceMode, b.scope_kind AS scopeKind, b.scope_id AS scopeId
       FROM ruleset_bindings b
       JOIN rulesets r ON r.id = b.ruleset_id`,
    )
    .all() as BindingRow[];

  return rows.filter((row) => {
    switch (row.scopeKind) {
      case "organisation":
        return true;
      case "group":
        return groupId != null && row.scopeId === groupId;
      case "project":
        return context.projectId != null && row.scopeId === context.projectId;
      case "repository":
        return context.repository != null && row.scopeId === context.repository;
      case "user":
        return context.userEmail != null && row.scopeId === context.userEmail;
      default:
        return false;
    }
  });
}

export function effectivePolicy(
  db: Db,
  context: PolicyContext,
): Record<string, EffectiveRule> {
  const bindings = applicableBindings(db, context);
  const byScope = new Map<ScopeKind, BindingRow[]>();
  for (const binding of bindings) {
    const list = byScope.get(binding.scopeKind) ?? [];
    list.push(binding);
    byScope.set(binding.scopeKind, list);
  }

  const effective: Record<string, EffectiveRule> = {};
  for (const scope of SCOPE_ORDER) {
    const scoped = byScope.get(scope) ?? [];
    for (const binding of scoped) {
      const rules = db
        .prepare(
          `SELECT workflow_id AS workflowId, strategy_kind AS strategyKind, model_id AS modelId,
                  parameters, overridable FROM ruleset_rules WHERE ruleset_id = ?`,
        )
        .all(binding.rulesetId) as RuleRow[];
      for (const rule of rules) {
        const current = effective[rule.workflowId];
        if (current && !current.overridable) continue;
        effective[rule.workflowId] = {
          workflowId: rule.workflowId,
          rulesetId: binding.rulesetId,
          rulesetName: binding.rulesetName,
          scopeKind: binding.scopeKind,
          scopeId: binding.scopeId,
          strategyKind: rule.strategyKind,
          modelId: rule.modelId,
          parameters: JSON.parse(rule.parameters || "{}") as Record<string, string>,
          overridable: rule.overridable === 1,
          governanceMode: binding.governanceMode,
        };
      }
    }
  }
  return effective;
}

export function effectivePolicyFor(
  db: Db,
  context: PolicyContext & { workflowId: string },
): EffectiveRule | null {
  return effectivePolicy(db, context)[context.workflowId] ?? null;
}
