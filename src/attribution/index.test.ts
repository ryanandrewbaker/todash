import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client.js";
import { createProject, mapRepository } from "../db/org.js";
import { ingestHookPayload } from "../ingest/hooks/capture.js";
import { ingestBillingPayload } from "../ingest/admin-api/poller.js";
import { upsertWorkflow } from "../policy/index.js";
import { listUsage } from "../report/index.js";

function stopHook(overrides: Record<string, unknown> = {}) {
  return {
    hook_event_name: "stop",
    user_email: "ryan@example.com",
    conversation_id: "conv-1",
    generation_id: "gen-1",
    model: "composer-2.5",
    model_id: "composer-2.5",
    workspace_roots: ["/work/customer-api"],
    timestamp: 1_000_000,
    ...overrides,
  };
}

describe("derived usage records", () => {
  it("stores the raw hook event and a local usage record without inventing cost", () => {
    const db = openMemoryDb();
    ingestHookPayload(db, stopHook());
    const hooks = db.prepare("SELECT COUNT(*) AS count FROM hook_events").get() as { count: number };
    expect(hooks.count).toBe(1);
    const [record] = listUsage(db) as Array<Record<string, unknown>>;
    expect(record.user_email).toBe("ryan@example.com");
    expect(record.selected_model).toBe("composer-2.5");
    expect(record.executed_model).toBeNull();
    expect(record.attributed_consumption_cents).toBeNull();
    expect(record.billed_usage_cents).toBeNull();
    expect(record.workflow_id).toBeNull();
    expect(record.workflow_confidence).toBe("unallocated");
  });

  it("keeps workflow unclassified unless a Todash subagent identity maps", () => {
    const db = openMemoryDb();
    upsertWorkflow(db, { id: "testing", name: "Testing", subagentIdentity: "todash-testing" });
    ingestHookPayload(db, stopHook({ hook_event_name: "subagentStart", subagent_type: "generalPurpose" }));
    const [record] = listUsage(db) as Array<Record<string, unknown>>;
    expect(record.workflow_id).toBeNull();
  });

  it("attributes workflow exactly when the exposed identity maps", () => {
    const db = openMemoryDb();
    upsertWorkflow(db, { id: "testing", name: "Testing", subagentIdentity: "todash-testing" });
    ingestHookPayload(
      db,
      stopHook({ hook_event_name: "subagentStart", subagent_type: "todash-testing" }),
    );
    const [record] = listUsage(db) as Array<Record<string, unknown>>;
    expect(record.workflow_id).toBe("testing");
    expect(record.workflow_confidence).toBe("exact");
    expect(record.selected_mode).toBe("todash_subagent");
  });

  it("infers a project from a single repository mapping and never duplicates cost", () => {
    const db = openMemoryDb();
    const projectId = createProject(db, "Customer Portal");
    mapRepository(db, { projectId, repository: "/work/customer-api" });
    ingestHookPayload(db, stopHook());
    const records = listUsage(db) as Array<Record<string, unknown>>;
    expect(records).toHaveLength(1);
    expect(records[0]?.project_id).toBe(projectId);
    expect(records[0]?.project_confidence).toBe("inferred");
  });

  it("leaves project unallocated when two projects claim the same repository without a path boundary", () => {
    const db = openMemoryDb();
    const portal = createProject(db, "Customer Portal");
    const payments = createProject(db, "Payments");
    mapRepository(db, { projectId: portal, repository: "/work/shared" });
    mapRepository(db, { projectId: payments, repository: "/work/shared" });
    ingestHookPayload(db, stopHook({ workspace_roots: ["/work/shared"] }));
    const [record] = listUsage(db) as Array<Record<string, unknown>>;
    expect(record.project_id).toBeNull();
    expect(record.project_confidence).toBe("unallocated");
  });

  it("joins billing cost onto a unique hook generation without copying selected model into executed model", () => {
    const db = openMemoryDb();
    ingestHookPayload(db, stopHook({ model: "auto", model_id: "auto" }));
    ingestBillingPayload(db, {
      timestamp: 1_005_000,
      userEmail: "ryan@example.com",
      conversationId: "conv-1",
      model: "claude-4.5-sonnet",
      kind: "Usage-based",
      isChargeable: true,
      chargedCents: 21.3,
      tokenUsage: { totalCents: 20.1 },
    });
    const [record] = listUsage(db) as Array<Record<string, unknown>>;
    expect(record.correlation_status).toBe("exact");
    expect(record.selected_mode).toBe("auto");
    expect(record.selected_model).toBe("auto");
    expect(record.executed_model).toBe("claude-4.5-sonnet");
    expect(record.attributed_consumption_cents).toBe(20.1);
    expect(record.billed_usage_cents).toBe(21.3);
  });

  it("does not pick a billing candidate when two generations make the join ambiguous", () => {
    const db = openMemoryDb();
    ingestHookPayload(db, stopHook({ generation_id: "gen-1", timestamp: 1_000_000 }));
    ingestHookPayload(
      db,
      stopHook({ generation_id: "gen-2", conversation_id: "conv-1", timestamp: 1_010_000 }),
    );
    ingestBillingPayload(db, {
      timestamp: 1_005_000,
      userEmail: "ryan@example.com",
      conversationId: "conv-1",
      model: "claude-4.5-sonnet",
      chargedCents: 10,
      tokenUsage: { totalCents: 9 },
      isChargeable: true,
    });
    const records = listUsage(db) as Array<Record<string, unknown>>;
    const hookOnly = records.filter((row) => row.executed_model == null);
    const billingOnly = records.filter((row) => row.executed_model === "claude-4.5-sonnet");
    expect(hookOnly).toHaveLength(2);
    expect(billingOnly).toHaveLength(1);
    expect(billingOnly[0]?.correlation_status).toBe("unmatched");
    expect(hookOnly.every((row) => row.attributed_consumption_cents == null)).toBe(true);
  });

  it("keeps raw observations when derived records are rebuilt", () => {
    const db = openMemoryDb();
    ingestHookPayload(db, stopHook());
    expect((db.prepare("SELECT COUNT(*) AS c FROM hook_events").get() as { c: number }).c).toBe(1);
    db.exec("DELETE FROM usage_records");
    expect((db.prepare("SELECT COUNT(*) AS c FROM hook_events").get() as { c: number }).c).toBe(1);
  });
});
