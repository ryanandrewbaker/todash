import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Db } from "../db/client.js";
import { todashSubagentIdentity } from "../attribution/workflow.js";
import { effectivePolicy, type PolicyContext } from "./effective.js";
import type { ExecutionStrategy, GovernanceMode } from "../domain/types.js";

function modelFrontmatter(strategy: ExecutionStrategy): string {
  if (strategy.kind === "specific_model" && strategy.modelId) {
    const params = Object.entries(strategy.parameters)
      .map(([key, value]) => `${key}=${value}`)
      .join(",");
    return params ? `${strategy.modelId}[${params}]` : strategy.modelId;
  }
  if (strategy.kind === "auto") {
    const params = Object.entries(strategy.parameters)
      .map(([key, value]) => `${key}=${value}`)
      .join(",");
    return params ? `auto[${params}]` : "auto";
  }
  return "inherit";
}

function renderSubagent(input: {
  workflowId: string;
  name: string;
  purpose: string | null;
  strategy: ExecutionStrategy;
}): string {
  const identity = todashSubagentIdentity(input.workflowId);
  return `---
name: ${identity}
description: Todash ${input.name} workflow. Use for ${input.purpose ?? input.name}.
model: ${modelFrontmatter(input.strategy)}
---

You are executing the Todash **${input.name}** workflow.

${input.purpose ?? ""}

Follow the organisation's preferred execution strategy for this category of work.
`;
}

export type CompiledAgent = {
  workflowId: string;
  identity: string;
  targetDir: string;
  path: string;
  contents: string;
};

export function compileRoutedAgents(
  db: Db,
  context: PolicyContext,
  targetDir: string,
): CompiledAgent[] {
  const policy = effectivePolicy(db, context);
  const compiled: CompiledAgent[] = [];
  for (const rule of Object.values(policy)) {
    if (rule.governanceMode !== "route" && rule.governanceMode !== "govern") continue;
    const workflow = db
      .prepare("SELECT id, name, purpose FROM workflows WHERE id = ?")
      .get(rule.workflowId) as { id: string; name: string; purpose: string | null } | undefined;
    if (!workflow) continue;
    const identity = todashSubagentIdentity(workflow.id);
    const contents = renderSubagent({
      workflowId: workflow.id,
      name: workflow.name,
      purpose: workflow.purpose,
      strategy: {
        kind: rule.strategyKind,
        modelId: rule.modelId,
        parameters: rule.parameters,
      },
    });
    compiled.push({
      workflowId: workflow.id,
      identity,
      targetDir,
      path: path.join(targetDir, `${identity}.md`),
      contents,
    });
  }
  return compiled;
}

export function writeCompiledAgents(agents: CompiledAgent[]): void {
  for (const agent of agents) {
    fs.mkdirSync(agent.targetDir, { recursive: true });
    fs.writeFileSync(agent.path, agent.contents);
  }
}

export function applyUserRuleset(db: Db, userEmail: string): CompiledAgent[] {
  const agents = compileRoutedAgents(db, { userEmail }, path.join(os.homedir(), ".cursor", "agents"));
  writeCompiledAgents(agents);
  return agents;
}

export function applyRepositoryRuleset(db: Db, repositoryPath: string, repositoryId: string): CompiledAgent[] {
  const agents = compileRoutedAgents(
    db,
    { repository: repositoryId },
    path.join(repositoryPath, ".cursor", "agents"),
  );
  writeCompiledAgents(agents);
  return agents;
}

export function governanceModes(): GovernanceMode[] {
  return ["observe", "recommend", "route", "govern"];
}
