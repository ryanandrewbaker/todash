export const ATTRIBUTION = ["exact", "inferred", "unallocated"] as const;
export type Attribution = (typeof ATTRIBUTION)[number];

export const CORRELATION = ["exact", "inferred", "unmatched", "ambiguous"] as const;
export type CorrelationStatus = (typeof CORRELATION)[number];

export const SCOPE_KIND = [
  "organisation",
  "group",
  "project",
  "repository",
  "user",
] as const;
export type ScopeKind = (typeof SCOPE_KIND)[number];

export const STRATEGY_KIND = ["specific_model", "auto", "organisation_default"] as const;
export type StrategyKind = (typeof STRATEGY_KIND)[number];

export const GOVERNANCE_MODE = ["observe", "recommend", "route", "govern"] as const;
export type GovernanceMode = (typeof GOVERNANCE_MODE)[number];

export const SELECTED_MODE = [
  "specific_model",
  "auto",
  "todash_subagent",
  "organisation_default",
] as const;
export type SelectedMode = (typeof SELECTED_MODE)[number];

export const MODEL_SOURCE = ["catalog", "observed", "admin"] as const;
export type ModelSource = (typeof MODEL_SOURCE)[number];

export type ExecutionStrategy = {
  kind: StrategyKind;
  modelId?: string | null;
  parameters: Record<string, string>;
};

export type HookObservation = {
  timestamp?: number | null;
  hookType: string;
  userEmail?: string | null;
  workspaceRoots: string[];
  conversationId?: string | null;
  generationId?: string | null;
  selectedModel?: string | null;
  selectedModelId?: string | null;
  cwd?: string | null;
  filePath?: string | null;
  subagentId?: string | null;
  subagentType?: string | null;
  subagentTask?: string | null;
  subagentModel?: string | null;
  payload: Record<string, unknown>;
};

export type BillingObservation = {
  timestamp?: number | null;
  userEmail?: string | null;
  conversationId?: string | null;
  executedModel?: string | null;
  kind?: string | null;
  isChargeable?: boolean | null;
  chargedCents?: number | null;
  attributedCents?: number | null;
  cursorTokenFee?: number | null;
  payload: Record<string, unknown>;
};

export type Dimension<T> = {
  value: T | null;
  confidence: Attribution;
};

export type UsageRecord = {
  id: string;
  eventTimestamp: number | null;
  correlation: CorrelationStatus;
  user: Dimension<string>;
  repository: Dimension<string>;
  project: Dimension<string>;
  workflow: Dimension<string>;
  policyStrategy: Dimension<ExecutionStrategy>;
  selectedMode: Dimension<SelectedMode>;
  selectedModel: Dimension<string>;
  executedModel: Dimension<string>;
  attributedConsumptionCents: Dimension<number>;
  billedUsageCents: Dimension<number>;
  hookEventIds: string[];
  billingEventIds: string[];
};

export const UNALLOCATED = <T>(): Dimension<T> => ({
  value: null,
  confidence: "unallocated",
});

export const exact = <T>(value: T): Dimension<T> => ({
  value,
  confidence: "exact",
});

export const inferred = <T>(value: T): Dimension<T> => ({
  value,
  confidence: "inferred",
});
