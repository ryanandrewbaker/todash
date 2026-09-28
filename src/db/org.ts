import { randomUUID } from "node:crypto";
import type { Db } from "./client.js";

export function upsertUser(
  db: Db,
  input: { email: string; displayName?: string; seatCostCents?: number | null },
): void {
  db.prepare(
    `INSERT INTO users (email, display_name, seat_cost_cents) VALUES (?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       display_name = COALESCE(excluded.display_name, users.display_name),
       seat_cost_cents = COALESCE(excluded.seat_cost_cents, users.seat_cost_cents)`,
  ).run(input.email, input.displayName ?? null, input.seatCostCents ?? null);
}

export function createGroup(db: Db, name: string): string {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  db.prepare("INSERT OR IGNORE INTO groups (id, name) VALUES (?, ?)").run(id, name);
  db.prepare("UPDATE groups SET name = ? WHERE id = ?").run(name, id);
  return id;
}

export function addGroupMember(db: Db, groupId: string, email: string): void {
  upsertUser(db, { email });
  db.prepare("INSERT OR IGNORE INTO group_members (group_id, user_email) VALUES (?, ?)").run(
    groupId,
    email,
  );
}

export function createProject(db: Db, name: string, id?: string): string {
  const projectId = id ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  db.prepare("INSERT OR IGNORE INTO projects (id, name) VALUES (?, ?)").run(projectId, name);
  db.prepare("UPDATE projects SET name = ? WHERE id = ?").run(name, projectId);
  return projectId;
}

export function mapRepository(
  db: Db,
  input: { projectId: string; repository: string; pathPrefix?: string | null },
): string {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO project_repositories (id, project_id, repository, path_prefix) VALUES (?, ?, ?, ?)",
  ).run(id, input.projectId, input.repository, input.pathPrefix ?? null);
  return id;
}

export function getOrg(db: Db) {
  return db.prepare("SELECT * FROM org WHERE id = 'org'").get() as {
    id: string;
    name: string;
    seat_cost_cents: number | null;
    cursor_api_key: string | null;
  };
}

export function updateOrg(
  db: Db,
  input: { name?: string; seatCostCents?: number | null; cursorApiKey?: string | null },
): void {
  const current = getOrg(db);
  db.prepare("UPDATE org SET name = ?, seat_cost_cents = ?, cursor_api_key = ? WHERE id = 'org'").run(
    input.name ?? current.name,
    input.seatCostCents === undefined ? current.seat_cost_cents : input.seatCostCents,
    input.cursorApiKey === undefined ? current.cursor_api_key : input.cursorApiKey,
  );
}
