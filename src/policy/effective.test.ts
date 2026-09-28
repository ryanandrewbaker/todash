import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client.js";
import { addGroupMember, createGroup } from "../db/org.js";
import { bindRuleset, setRule, upsertRuleset, upsertWorkflow } from "./index.js";
import { effectivePolicy } from "./effective.js";
import { compileRoutedAgents } from "./compiler.js";

describe("effective policy", () => {
  it("lets a more specific scope win unless the parent rule is not overridable", () => {
    const db = openMemoryDb();
    upsertWorkflow(db, { id: "testing", name: "Testing" });
    upsertRuleset(db, { id: "org-default", name: "Org", governanceMode: "recommend" });
    upsertRuleset(db, { id: "frontend", name: "Frontend", governanceMode: "route" });
    setRule(db, {
      rulesetId: "org-default",
      workflowId: "testing",
      strategyKind: "specific_model",
      modelId: "model-b",
      overridable: true,
    });
    setRule(db, {
      rulesetId: "frontend",
      workflowId: "testing",
      strategyKind: "specific_model",
      modelId: "model-a",
    });
    bindRuleset(db, { rulesetId: "org-default", scopeKind: "organisation", scopeId: "org" });
    const groupId = createGroup(db, "Frontend");
    addGroupMember(db, groupId, "ryan@example.com");
    bindRuleset(db, { rulesetId: "frontend", scopeKind: "group", scopeId: groupId });

    const policy = effectivePolicy(db, { userEmail: "ryan@example.com" });
    expect(policy.testing?.modelId).toBe("model-a");
    expect(policy.testing?.scopeKind).toBe("group");
  });

  it("keeps a non-overridable parent rule", () => {
    const db = openMemoryDb();
    upsertWorkflow(db, { id: "review", name: "Review" });
    upsertRuleset(db, { id: "org-default", name: "Org", governanceMode: "govern" });
    upsertRuleset(db, { id: "user", name: "Ryan", governanceMode: "route" });
    setRule(db, {
      rulesetId: "org-default",
      workflowId: "review",
      strategyKind: "specific_model",
      modelId: "model-c",
      overridable: false,
    });
    setRule(db, {
      rulesetId: "user",
      workflowId: "review",
      strategyKind: "specific_model",
      modelId: "model-d",
    });
    bindRuleset(db, { rulesetId: "org-default", scopeKind: "organisation", scopeId: "org" });
    bindRuleset(db, { rulesetId: "user", scopeKind: "user", scopeId: "ryan@example.com" });
    const policy = effectivePolicy(db, { userEmail: "ryan@example.com" });
    expect(policy.review?.modelId).toBe("model-c");
    expect(policy.review?.scopeKind).toBe("organisation");
  });

  it("compiles routed workflows and skips recommend-only ones", () => {
    const db = openMemoryDb();
    upsertWorkflow(db, { id: "testing", name: "Testing", purpose: "Write tests." });
    upsertRuleset(db, { id: "org-default", name: "Org", governanceMode: "route" });
    setRule(db, {
      rulesetId: "org-default",
      workflowId: "testing",
      strategyKind: "specific_model",
      modelId: "composer-2.5",
      parameters: { effort: "high" },
    });
    bindRuleset(db, { rulesetId: "org-default", scopeKind: "organisation", scopeId: "org" });
    const agents = compileRoutedAgents(db, { userEmail: "ryan@example.com" }, "/tmp/todash-agents");
    expect(agents).toHaveLength(1);
    expect(agents[0]?.contents).toContain("model: composer-2.5[effort=high]");
    expect(agents[0]?.identity).toBe("todash-testing");
  });
});
