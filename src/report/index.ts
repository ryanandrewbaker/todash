import type { Db } from "../db/client.js";

export type UsageFilters = {
  userEmail?: string;
  repository?: string;
  projectId?: string;
  workflowId?: string;
  model?: string;
  from?: number;
  to?: number;
};

function where(filters: UsageFilters): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.userEmail) {
    clauses.push("user_email = ?");
    params.push(filters.userEmail);
  }
  if (filters.repository) {
    clauses.push("repository = ?");
    params.push(filters.repository);
  }
  if (filters.projectId) {
    clauses.push("project_id = ?");
    params.push(filters.projectId);
  }
  if (filters.workflowId === "unclassified") {
    clauses.push("workflow_id IS NULL");
  } else if (filters.workflowId) {
    clauses.push("workflow_id = ?");
    params.push(filters.workflowId);
  }
  if (filters.model) {
    clauses.push("(executed_model = ? OR selected_model = ?)");
    params.push(filters.model, filters.model);
  }
  if (filters.from) {
    clauses.push("event_timestamp >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    clauses.push("event_timestamp <= ?");
    params.push(filters.to);
  }
  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export function listUsage(db: Db, filters: UsageFilters = {}) {
  const { sql, params } = where(filters);
  return db
    .prepare(
      `SELECT * FROM usage_records ${sql} ORDER BY COALESCE(event_timestamp, created_at) DESC LIMIT 500`,
    )
    .all(...params);
}

export function overview(db: Db) {
  const users = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  const observedUsers = db
    .prepare("SELECT COUNT(DISTINCT user_email) AS count FROM usage_records WHERE user_email IS NOT NULL")
    .get() as { count: number };
  const projects = db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number };
  const repositories = db
    .prepare("SELECT COUNT(DISTINCT repository) AS count FROM usage_records WHERE repository IS NOT NULL")
    .get() as { count: number };
  const workflows = db.prepare("SELECT COUNT(*) AS count FROM workflows").get() as { count: number };
  const monthStart = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const month = db
    .prepare(
      `SELECT
         COALESCE(SUM(attributed_consumption_cents), 0) AS attributed,
         COALESCE(SUM(billed_usage_cents), 0) AS billed,
         COUNT(*) AS events,
         SUM(CASE WHEN repository_confidence = 'unallocated' THEN 1 ELSE 0 END) AS unallocatedRepo,
         SUM(CASE WHEN workflow_id IS NULL THEN 1 ELSE 0 END) AS unclassified
       FROM usage_records
       WHERE COALESCE(event_timestamp, created_at) >= ?`,
    )
    .get(monthStart) as {
    attributed: number;
    billed: number;
    events: number;
    unallocatedRepo: number;
    unclassified: number;
  };
  const topProjects = db
    .prepare(
      `SELECT p.name AS name, COALESCE(SUM(u.attributed_consumption_cents), 0) AS cents
       FROM usage_records u
       JOIN projects p ON p.id = u.project_id
       WHERE COALESCE(u.event_timestamp, u.created_at) >= ?
       GROUP BY p.id
       ORDER BY cents DESC
       LIMIT 5`,
    )
    .all(monthStart);
  const alerts = db
    .prepare("SELECT COUNT(*) AS count FROM alerts WHERE acknowledged = 0")
    .get() as { count: number };
  const modelsUsed = db
    .prepare(
      "SELECT COUNT(DISTINCT executed_model) AS count FROM usage_records WHERE executed_model IS NOT NULL",
    )
    .get() as { count: number };
  return {
    users: Math.max(users.count, observedUsers.count),
    projects: projects.count,
    repositories: repositories.count,
    workflows: workflows.count,
    attributedCents: month.attributed,
    billedCents: month.billed,
    events: month.events,
    unclassified: month.unclassified,
    unallocatedRepo: month.unallocatedRepo,
    topProjects,
    openAlerts: alerts.count,
    modelsUsed: modelsUsed.count,
  };
}

export function breakdown(db: Db, dimension: string, filters: UsageFilters = {}) {
  const column =
    {
      user: "user_email",
      repository: "repository",
      project: "project_id",
      workflow: "workflow_id",
      model: "executed_model",
      selected: "selected_mode",
    }[dimension] ?? "workflow_id";
  const { sql, params } = where(filters);
  return db
    .prepare(
      `SELECT COALESCE(${column}, 'unallocated') AS key,
              COUNT(*) AS events,
              COALESCE(SUM(attributed_consumption_cents), 0) AS attributedCents,
              COALESCE(SUM(billed_usage_cents), 0) AS billedCents
       FROM usage_records
       ${sql}
       GROUP BY ${column}
       ORDER BY attributedCents DESC, events DESC`,
    )
    .all(...params);
}
