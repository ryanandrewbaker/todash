import type { SelectedMode } from "../domain/types.js";

const AUTO_PATTERN = /(^|[^a-z])auto([^a-z]|$)/i;

export function selectedModeFromHook(input: {
  selectedModel?: string | null;
  selectedModelId?: string | null;
  subagentType?: string | null;
  mappedWorkflowId?: string | null;
}): { mode: SelectedMode | null; model: string | null } {
  const model = input.selectedModelId || input.selectedModel || null;

  if (input.mappedWorkflowId) {
    return { mode: "todash_subagent", model };
  }

  if (model && AUTO_PATTERN.test(model)) {
    return { mode: "auto", model };
  }

  if (model) {
    return { mode: "specific_model", model };
  }

  return { mode: null, model: null };
}

export function mapWorkflowIdentity(
  subagentType: string | null | undefined,
  workflows: { id: string; subagentIdentity: string | null }[],
): string | null {
  if (!subagentType) return null;
  const match = workflows.find(
    (workflow) =>
      workflow.subagentIdentity &&
      workflow.subagentIdentity.toLowerCase() === subagentType.toLowerCase(),
  );
  return match?.id ?? null;
}

export function todashSubagentIdentity(workflowId: string): string {
  return `todash-${workflowId}`;
}
