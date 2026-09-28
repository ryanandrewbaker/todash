import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_EVENTS = [
  "sessionStart",
  "sessionEnd",
  "beforeSubmitPrompt",
  "stop",
  "subagentStart",
  "subagentStop",
  "afterAgentResponse",
  "workspaceOpen",
];

export function hookScriptPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../hooks/observe.sh");
}

export function userHooksJsonPath(): string {
  return path.join(os.homedir(), ".cursor", "hooks.json");
}

export function installUserHooks(command: string): { path: string; events: string[] } {
  const hooksPath = userHooksJsonPath();
  fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
  let existing: { version?: number; hooks?: Record<string, Array<{ command: string }>> } = {
    version: 1,
    hooks: {},
  };
  if (fs.existsSync(hooksPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    } catch {
      existing = { version: 1, hooks: {} };
    }
  }
  existing.version = existing.version ?? 1;
  existing.hooks = existing.hooks ?? {};
  for (const event of HOOK_EVENTS) {
    const list = existing.hooks[event] ?? [];
    const already = list.some((entry) => entry.command === command);
    if (!already) list.push({ command });
    existing.hooks[event] = list;
  }
  fs.writeFileSync(hooksPath, JSON.stringify(existing, null, 2) + "\n");
  return { path: hooksPath, events: HOOK_EVENTS };
}

export function captureCommand(cliPath: string): string {
  return `${process.execPath} ${cliPath} hook capture`;
}
