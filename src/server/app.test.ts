import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client.js";
import { createApp } from "./app.js";
import { ingestHookPayload } from "../ingest/hooks/capture.js";

describe("admin API", () => {
  it("reports unclassified local usage on the overview", async () => {
    const db = openMemoryDb();
    ingestHookPayload(db, {
      hook_event_name: "stop",
      user_email: "ryan@example.com",
      conversation_id: "c1",
      generation_id: "g1",
      model: "composer-2.5",
      workspace_roots: ["/repo"],
      timestamp: Date.now(),
    });
    const app = createApp(db);
    const response = await app.request("/api/overview");
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.events).toBe(1);
    expect(body.unclassified).toBe(1);
    expect(body.attributedCents).toBe(0);
  });
});
