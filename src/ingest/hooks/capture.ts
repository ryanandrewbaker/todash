import { deriveFromHook, insertHookEvent } from "../../attribution/index.js";
import type { Db } from "../../db/client.js";
import type { HookObservation } from "../../domain/types.js";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function parseHookPayload(payload: Record<string, unknown>): HookObservation {
  const hookType =
    asString(payload.hook_event_name) ?? asString(payload.hookEventName) ?? "unknown";
  return {
    timestamp: asNumber(payload.timestamp) ?? Date.now(),
    hookType,
    userEmail: asString(payload.user_email) ?? asString(payload.userEmail),
    workspaceRoots: asStringArray(payload.workspace_roots ?? payload.workspaceRoots),
    conversationId: asString(payload.conversation_id) ?? asString(payload.conversationId),
    generationId: asString(payload.generation_id) ?? asString(payload.generationId),
    selectedModel: asString(payload.model),
    selectedModelId: asString(payload.model_id) ?? asString(payload.modelId),
    cwd: asString(payload.cwd),
    filePath: asString(payload.file_path) ?? asString(payload.filePath),
    subagentId: asString(payload.subagent_id) ?? asString(payload.subagentId),
    subagentType: asString(payload.subagent_type) ?? asString(payload.subagentType),
    subagentTask: asString(payload.task),
    subagentModel: asString(payload.subagent_model) ?? asString(payload.subagentModel),
    payload,
  };
}

export function ingestHookPayload(db: Db, raw: Record<string, unknown>): string {
  const observation = parseHookPayload(raw);
  const id = insertHookEvent(db, {
    event_timestamp: observation.timestamp ?? Date.now(),
    hook_type: observation.hookType,
    user_email: observation.userEmail ?? null,
    workspace_roots: JSON.stringify(observation.workspaceRoots),
    conversation_id: observation.conversationId ?? null,
    generation_id: observation.generationId ?? null,
    selected_model: observation.selectedModel ?? null,
    selected_model_id: observation.selectedModelId ?? null,
    cwd: observation.cwd ?? null,
    file_path: observation.filePath ?? null,
    subagent_id: observation.subagentId ?? null,
    subagent_type: observation.subagentType ?? null,
    subagent_task: observation.subagentTask ?? null,
    subagent_model: observation.subagentModel ?? null,
    payload: JSON.stringify(raw),
  });
  deriveFromHook(db, id);
  return id;
}
