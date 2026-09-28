import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "../db/client.js";
import {
  addGroupMember,
  createGroup,
  createProject,
  getOrg,
  mapRepository,
  updateOrg,
  upsertUser,
} from "../db/org.js";
import { ingestHookPayload } from "../ingest/hooks/capture.js";
import { ingestBillingPayload, pollBilling } from "../ingest/admin-api/poller.js";
import { breakdown, listUsage, overview } from "../report/index.js";
import { bindRuleset, setRule, upsertRuleset, upsertWorkflow } from "../policy/index.js";
import { applyUserRuleset } from "../policy/compiler.js";
import { effectivePolicy } from "../policy/effective.js";
import { alertImpact, refreshCatalog, refreshObservedRegistry, upsertAdminModel } from "../models/registry.js";
import { rebuildUsageRecords } from "../attribution/index.js";
import type { GovernanceMode, ScopeKind, StrategyKind } from "../domain/types.js";

export function createApp(db: Db): Hono {
  const app = new Hono();

  app.get("/api/overview", (c) => c.json(overview(db)));

  app.get("/api/usage", (c) => {
    const query = c.req.query();
    return c.json({
      records: listUsage(db, {
        userEmail: query.user,
        repository: query.repository,
        projectId: query.project,
        workflowId: query.workflow,
        model: query.model,
      }),
      breakdown: {
        workflow: breakdown(db, "workflow"),
        model: breakdown(db, "model"),
        user: breakdown(db, "user"),
        project: breakdown(db, "project"),
        repository: breakdown(db, "repository"),
        selected: breakdown(db, "selected"),
      },
    });
  });

  app.get("/api/people", (c) => {
    const users = db.prepare("SELECT * FROM users ORDER BY email").all();
    const groups = db.prepare("SELECT * FROM groups ORDER BY name").all();
    const members = db.prepare("SELECT * FROM group_members").all();
    return c.json({ users, groups, members });
  });

  app.post("/api/people", async (c) => {
    const body = await c.req.json<{ email: string; displayName?: string; seatCostCents?: number }>();
    upsertUser(db, body);
    return c.json({ ok: true });
  });

  app.post("/api/groups", async (c) => {
    const body = await c.req.json<{ name: string }>();
    const id = createGroup(db, body.name);
    return c.json({ id });
  });

  app.post("/api/groups/:id/members", async (c) => {
    const body = await c.req.json<{ email: string }>();
    addGroupMember(db, c.req.param("id"), body.email);
    return c.json({ ok: true });
  });

  app.get("/api/projects", (c) => {
    const projects = db.prepare("SELECT * FROM projects ORDER BY name").all();
    const mappings = db.prepare("SELECT * FROM project_repositories").all();
    return c.json({ projects, mappings });
  });

  app.post("/api/projects", async (c) => {
    const body = await c.req.json<{ name: string }>();
    const id = createProject(db, body.name);
    return c.json({ id });
  });

  app.post("/api/projects/:id/repositories", async (c) => {
    const body = await c.req.json<{ repository: string; pathPrefix?: string }>();
    const id = mapRepository(db, {
      projectId: c.req.param("id"),
      repository: body.repository,
      pathPrefix: body.pathPrefix,
    });
    rebuildUsageRecords(db);
    return c.json({ id });
  });

  app.get("/api/rules", (c) => {
    const workflows = db.prepare("SELECT * FROM workflows ORDER BY name").all();
    const rulesets = db.prepare("SELECT * FROM rulesets ORDER BY name").all();
    const rules = db.prepare("SELECT * FROM ruleset_rules").all();
    const bindings = db.prepare("SELECT * FROM ruleset_bindings").all();
    const audit = db.prepare("SELECT * FROM audit_log ORDER BY at DESC LIMIT 50").all();
    return c.json({ workflows, rulesets, rules, bindings, audit });
  });

  app.post("/api/workflows", async (c) => {
    const body = await c.req.json<{ name: string; purpose?: string; subagentIdentity?: string }>();
    const id = upsertWorkflow(db, body);
    return c.json({ id });
  });

  app.post("/api/rulesets", async (c) => {
    const body = await c.req.json<{
      name: string;
      governanceMode: GovernanceMode;
    }>();
    const id = upsertRuleset(db, body);
    return c.json({ id });
  });

  app.post("/api/rulesets/:id/rules", async (c) => {
    const body = await c.req.json<{
      workflowId: string;
      strategyKind: StrategyKind;
      modelId?: string;
      parameters?: Record<string, string>;
      overridable?: boolean;
    }>();
    setRule(db, { ...body, rulesetId: c.req.param("id") });
    rebuildUsageRecords(db);
    return c.json({ ok: true });
  });

  app.post("/api/rulesets/:id/bind", async (c) => {
    const body = await c.req.json<{ scopeKind: ScopeKind; scopeId: string }>();
    const id = bindRuleset(db, { ...body, rulesetId: c.req.param("id") });
    rebuildUsageRecords(db);
    return c.json({ id });
  });

  app.get("/api/effective-policy", (c) => {
    const query = c.req.query();
    return c.json(
      effectivePolicy(db, {
        userEmail: query.user,
        repository: query.repository,
        projectId: query.project,
      }),
    );
  });

  app.post("/api/apply", async (c) => {
    const body = await c.req.json<{ userEmail?: string }>();
    const org = getOrg(db);
    const email = body.userEmail ?? "local";
    const agents = applyUserRuleset(db, email);
    return c.json({ written: agents.map((agent) => agent.path), org: org.name });
  });

  app.get("/api/models", (c) => {
    const models = db.prepare("SELECT * FROM models ORDER BY id").all();
    const snapshots = db
      .prepare("SELECT id, at, source FROM model_snapshots ORDER BY at DESC LIMIT 20")
      .all();
    return c.json({ models, snapshots });
  });

  app.post("/api/models", async (c) => {
    const body = await c.req.json<{
      id: string;
      displayName?: string;
      notes?: string;
      adminPriceNote?: string;
    }>();
    upsertAdminModel(db, body);
    return c.json({ ok: true });
  });

  app.post("/api/models/refresh", async (c) => {
    const org = getOrg(db);
    if (org.cursor_api_key) {
      const result = await refreshCatalog(db, { apiKey: org.cursor_api_key });
      return c.json(result);
    }
    const alerts = refreshObservedRegistry(db);
    return c.json({ available: false, alerts });
  });

  app.get("/api/alerts", (c) => {
    const rows = db
      .prepare("SELECT * FROM alerts ORDER BY created_at DESC LIMIT 100")
      .all() as Array<{ model_id: string | null; details: string }>;
    return c.json(
      rows.map((row) => ({
        ...row,
        impact: row.model_id ? alertImpact(db, row.model_id) : null,
      })),
    );
  });

  app.post("/api/alerts/:id/ack", (c) => {
    db.prepare("UPDATE alerts SET acknowledged = 1 WHERE id = ?").run(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.get("/api/settings", (c) => {
    const org = getOrg(db);
    return c.json({
      name: org.name,
      seatCostCents: org.seat_cost_cents,
      hasApiKey: Boolean(org.cursor_api_key),
    });
  });

  app.post("/api/settings", async (c) => {
    const body = await c.req.json<{
      name?: string;
      seatCostCents?: number | null;
      cursorApiKey?: string | null;
    }>();
    updateOrg(db, body);
    return c.json({ ok: true });
  });

  app.post("/api/ingest/hook", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const id = ingestHookPayload(db, body);
    return c.json({ id });
  });

  app.post("/api/ingest/billing", async (c) => {
    const body = await c.req.json<Record<string, unknown> | { events: Record<string, unknown>[] }>();
    const events = Array.isArray((body as { events?: unknown }).events)
      ? (body as { events: Record<string, unknown>[] }).events
      : [body as Record<string, unknown>];
    const ids = events.map((event) => ingestBillingPayload(db, event));
    return c.json({ ids });
  });

  app.post("/api/ingest/billing/poll", async (c) => {
    const org = getOrg(db);
    if (!org.cursor_api_key) return c.json({ error: "No Cursor Admin API key configured." }, 400);
    const endDate = Date.now();
    const startDate = endDate - 24 * 60 * 60 * 1000;
    const count = await pollBilling(db, { apiKey: org.cursor_api_key }, { startDate, endDate });
    refreshObservedRegistry(db);
    return c.json({ ingested: count });
  });

  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (fs.existsSync(webRoot)) {
    app.use("/*", serveStatic({ root: webRoot }));
    app.get("*", serveStatic({ path: path.join(webRoot, "index.html") }));
  }

  return app;
}
