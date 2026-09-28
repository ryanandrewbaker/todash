import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, money, stamp } from "./api";

const NAV = [
  ["#/", "Survey"],
  ["#/usage", "Usage"],
  ["#/people", "People"],
  ["#/projects", "Projects"],
  ["#/rules", "Rules"],
  ["#/models", "Models"],
  ["#/alerts", "Alerts"],
] as const;

type Overview = {
  users: number;
  projects: number;
  repositories: number;
  workflows: number;
  attributedCents: number;
  billedCents: number;
  events: number;
  unclassified: number;
  unallocatedRepo: number;
  topProjects: Array<{ name: string; cents: number }>;
  openAlerts: number;
  modelsUsed: number;
};

function Stamp({ value }: { value: string | null | undefined }) {
  const cls = stamp(value);
  return <span className={`stamp ${cls}`}>{cls}</span>;
}

export function App() {
  const [hash, setHash] = useState(window.location.hash || "#/");
  useEffect(() => {
    const onHash = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const page = hash.replace("#", "") || "/";

  return (
    <div className="shell">
      <nav>
        <div className="mark">
          Todash
          <span>Between intent and model</span>
        </div>
        <ul>
          {NAV.map(([href, label]) => (
            <li key={href}>
              <a className={hash === href || (href === "#/" && page === "/") ? "active" : ""} href={href}>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <main>
        {page === "/" && <Home />}
        {page === "/usage" && <Usage />}
        {page === "/people" && <People />}
        {page === "/projects" && <Projects />}
        {page === "/rules" && <Rules />}
        {page === "/models" && <Models />}
        {page === "/alerts" && <Alerts />}
      </main>
    </div>
  );
}

function Home() {
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => {
    api<Overview>("/api/overview").then(setData);
  }, []);
  if (!data) return <p className="muted">Opening the ledger…</p>;
  return (
    <>
      <p className="kicker">Organisation</p>
      <h1 className="display">Survey</h1>
      <div className="metrics">
        <div className="metric"><span>Users</span><b>{data.users}</b></div>
        <div className="metric"><span>Projects</span><b>{data.projects}</b></div>
        <div className="metric"><span>Repositories</span><b>{data.repositories}</b></div>
        <div className="metric"><span>Workflows</span><b>{data.workflows}</b></div>
        <div className="metric"><span>Attributed consumption</span><b>{money(data.attributedCents)}</b></div>
        <div className="metric"><span>Incremental billed</span><b>{money(data.billedCents)}</b></div>
        <div className="metric"><span>Unclassified events</span><b>{data.unclassified}</b></div>
        <div className="metric"><span>Open model alerts</span><b>{data.openAlerts}</b></div>
      </div>
      <p className="muted">
        Seat cost, attributed consumption, and billed usage stay separate. Unknown work stays unclassified.
      </p>
      <h2>Top projects</h2>
      <table>
        <thead><tr><th>Project</th><th>Attributed</th></tr></thead>
        <tbody>
          {data.topProjects.length === 0 && (
            <tr><td colSpan={2} className="muted">No project-attributed consumption yet.</td></tr>
          )}
          {data.topProjects.map((row) => (
            <tr key={row.name}><td>{row.name}</td><td>{money(row.cents)}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Usage() {
  const [data, setData] = useState<{
    records: Array<Record<string, unknown>>;
    breakdown: Record<string, Array<{ key: string; events: number; attributedCents: number; billedCents: number }>>;
  } | null>(null);
  useEffect(() => {
    api("/api/usage").then(setData);
  }, []);
  if (!data) return <p className="muted">Reading observations…</p>;
  return (
    <>
      <p className="kicker">Reporting</p>
      <h1>Usage</h1>
      <div className="split">
        <div>
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Repo</th>
                <th>Project</th>
                <th>Workflow</th>
                <th>Selected</th>
                <th>Executed</th>
                <th>Attributed</th>
                <th>Billed</th>
                <th>Join</th>
              </tr>
            </thead>
            <tbody>
              {data.records.length === 0 && (
                <tr><td colSpan={9} className="muted">Install hooks and use Cursor normally. Records appear here even without Todash workflows.</td></tr>
              )}
              {data.records.map((row) => (
                <tr key={String(row.id)}>
                  <td>{String(row.user_email ?? "—")}</td>
                  <td>{String(row.repository ?? "—")}<div><Stamp value={String(row.repository_confidence)} /></div></td>
                  <td>{String(row.project_id ?? "—")}<div><Stamp value={String(row.project_confidence)} /></div></td>
                  <td>{String(row.workflow_id ?? "unclassified")}<div><Stamp value={row.workflow_id ? String(row.workflow_confidence) : "unclassified"} /></div></td>
                  <td>{String(row.selected_mode ?? "—")}<div>{String(row.selected_model ?? "")}</div></td>
                  <td>{String(row.executed_model ?? "—")}<div><Stamp value={String(row.executed_confidence)} /></div></td>
                  <td>{money(row.attributed_consumption_cents as number | null)}</td>
                  <td>{money(row.billed_usage_cents as number | null)}</td>
                  <td><Stamp value={String(row.correlation_status)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid">
          {Object.entries(data.breakdown).map(([name, rows]) => (
            <div className="panel" key={name}>
              <p className="kicker">{name}</p>
              {rows.map((row) => (
                <div key={row.key}>
                  {row.key} · {row.events} · {money(row.attributedCents)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function People() {
  const [data, setData] = useState<{
    users: Array<{ email: string; display_name: string | null; seat_cost_cents: number | null }>;
    groups: Array<{ id: string; name: string }>;
    members: Array<{ group_id: string; user_email: string }>;
  } | null>(null);
  const reload = () => api("/api/people").then(setData);
  useEffect(() => { reload(); }, []);
  async function addUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/people", {
      method: "POST",
      body: JSON.stringify({
        email: form.get("email"),
        displayName: form.get("displayName"),
        seatCostCents: form.get("seatCostCents") ? Number(form.get("seatCostCents")) : null,
      }),
    });
    event.currentTarget.reset();
    reload();
  }
  async function addGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/groups", { method: "POST", body: JSON.stringify({ name: form.get("name") }) });
    event.currentTarget.reset();
    reload();
  }
  if (!data) return null;
  return (
    <>
      <p className="kicker">Directory</p>
      <h1>People</h1>
      <div className="split">
        <table>
          <thead><tr><th>Seat</th><th>Name</th><th>Seat cost</th></tr></thead>
          <tbody>
            {data.users.map((user) => (
              <tr key={user.email}>
                <td>{user.email}</td>
                <td>{user.display_name ?? "—"}</td>
                <td>{money(user.seat_cost_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid">
          <form className="form panel" onSubmit={addUser}>
            <p className="kicker">Add seat</p>
            <input name="email" placeholder="email" required />
            <input name="displayName" placeholder="display name" />
            <input name="seatCostCents" placeholder="seat cost cents" />
            <button type="submit">Save person</button>
          </form>
          <form className="form panel" onSubmit={addGroup}>
            <p className="kicker">Add group</p>
            <input name="name" placeholder="Frontend" required />
            <button type="submit">Save group</button>
          </form>
          <form className="form panel" onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            await api(`/api/groups/${form.get("groupId")}/members`, {
              method: "POST",
              body: JSON.stringify({ email: form.get("email") }),
            });
            event.currentTarget.reset();
            reload();
          }}>
            <p className="kicker">Add member</p>
            <select name="groupId">
              {data.groups.map((group) => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>
            <input name="email" placeholder="email" required />
            <button type="submit">Add to group</button>
          </form>
          <div className="panel">
            <p className="kicker">Groups</p>
            {data.groups.map((group) => (
              <div key={group.id}>
                {group.name}
                <div className="muted">
                  {data.members.filter((member) => member.group_id === group.id).map((member) => member.user_email).join(", ") || "no members"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function Projects() {
  const [data, setData] = useState<{
    projects: Array<{ id: string; name: string }>;
    mappings: Array<{ id: string; project_id: string; repository: string; path_prefix: string | null }>;
  } | null>(null);
  const reload = () => api("/api/projects").then(setData);
  useEffect(() => { reload(); }, []);
  async function addProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/projects", { method: "POST", body: JSON.stringify({ name: form.get("name") }) });
    event.currentTarget.reset();
    reload();
  }
  async function addMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/projects/${form.get("projectId")}/repositories`, {
      method: "POST",
      body: JSON.stringify({
        repository: form.get("repository"),
        pathPrefix: form.get("pathPrefix") || undefined,
      }),
    });
    event.currentTarget.reset();
    reload();
  }
  if (!data) return null;
  return (
    <>
      <p className="kicker">Delivery boundaries</p>
      <h1>Projects</h1>
      <p className="muted">A repository maps to a project only when the mapping is unique. Ambiguous mappings stay unallocated.</p>
      <div className="split">
        <table>
          <thead><tr><th>Project</th><th>Repositories</th></tr></thead>
          <tbody>
            {data.projects.map((project) => (
              <tr key={project.id}>
                <td>{project.name}</td>
                <td>
                  {data.mappings.filter((mapping) => mapping.project_id === project.id).map((mapping) => (
                    <div key={mapping.id}>{mapping.repository}{mapping.path_prefix ? ` · ${mapping.path_prefix}` : ""}</div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid">
          <form className="form panel" onSubmit={addProject}>
            <p className="kicker">Define project</p>
            <input name="name" placeholder="Customer Portal" required />
            <button type="submit">Save project</button>
          </form>
          <form className="form panel" onSubmit={addMapping}>
            <p className="kicker">Map repository</p>
            <select name="projectId">
              {data.projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
            <input name="repository" placeholder="git remote or path" required />
            <input name="pathPrefix" placeholder="optional path boundary" />
            <button type="submit">Save mapping</button>
          </form>
        </div>
      </div>
    </>
  );
}

function Rules() {
  const [data, setData] = useState<{
    workflows: Array<{ id: string; name: string; purpose: string | null; subagent_identity: string | null }>;
    rulesets: Array<{ id: string; name: string; governance_mode: string }>;
    rules: Array<{ id: string; ruleset_id: string; workflow_id: string; strategy_kind: string; model_id: string | null; overridable: number }>;
    bindings: Array<{ id: string; ruleset_id: string; scope_kind: string; scope_id: string }>;
    audit: Array<{ id: string; at: number; actor: string | null; entity_kind: string; field: string; previous_value: string | null; new_value: string | null }>;
  } | null>(null);
  const [effective, setEffective] = useState<Record<string, { modelId: string | null; strategyKind: string; scopeKind: string; rulesetName: string }>>({});
  const reload = () => api("/api/rules").then(setData);
  useEffect(() => { reload(); }, []);
  async function addWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/workflows", {
      method: "POST",
      body: JSON.stringify({ name: form.get("name"), purpose: form.get("purpose") }),
    });
    event.currentTarget.reset();
    reload();
  }
  async function addRuleset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/rulesets", {
      method: "POST",
      body: JSON.stringify({ name: form.get("name"), governanceMode: form.get("governanceMode") }),
    });
    event.currentTarget.reset();
    reload();
  }
  async function addRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/rulesets/${form.get("rulesetId")}/rules`, {
      method: "POST",
      body: JSON.stringify({
        workflowId: form.get("workflowId"),
        strategyKind: form.get("strategyKind"),
        modelId: form.get("modelId") || undefined,
        overridable: form.get("overridable") === "on",
      }),
    });
    reload();
  }
  async function bind(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/rulesets/${form.get("rulesetId")}/bind`, {
      method: "POST",
      body: JSON.stringify({ scopeKind: form.get("scopeKind"), scopeId: form.get("scopeId") }),
    });
    reload();
  }
  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams({
      user: String(form.get("user") || ""),
      repository: String(form.get("repository") || ""),
      project: String(form.get("project") || ""),
    });
    setEffective(await api(`/api/effective-policy?${params}`));
  }
  if (!data) return null;
  return (
    <>
      <p className="kicker">Policy</p>
      <h1>Rules</h1>
      <div className="split">
        <div className="grid">
          <div className="panel">
            <p className="kicker">Workflows</p>
            {data.workflows.map((workflow) => (
              <div key={workflow.id}>{workflow.name} <span className="muted">{workflow.subagent_identity}</span></div>
            ))}
          </div>
          <div className="panel">
            <p className="kicker">Rulesets</p>
            {data.rulesets.map((ruleset) => (
              <div key={ruleset.id}>
                {ruleset.name} · {ruleset.governance_mode}
                <div className="muted">
                  {data.rules.filter((rule) => rule.ruleset_id === ruleset.id).map((rule) => (
                    <div key={rule.id}>{rule.workflow_id} → {rule.strategy_kind} {rule.model_id ?? ""}</div>
                  ))}
                  {data.bindings.filter((binding) => binding.ruleset_id === ruleset.id).map((binding) => (
                    <div key={binding.id}>{binding.scope_kind}:{binding.scope_id}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="panel">
            <p className="kicker">Audit</p>
            {data.audit.map((row) => (
              <div key={row.id}>
                {new Date(row.at).toLocaleString()} · {row.entity_kind}.{row.field}
                <div className="muted">{row.previous_value ?? "∅"} → {row.new_value}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid">
          <form className="form panel" onSubmit={addWorkflow}>
            <p className="kicker">Workflow</p>
            <input name="name" placeholder="Testing" required />
            <input name="purpose" placeholder="Create and review tests" />
            <button type="submit">Save workflow</button>
          </form>
          <form className="form panel" onSubmit={addRuleset}>
            <p className="kicker">Ruleset</p>
            <input name="name" placeholder="Default engineering" required />
            <select name="governanceMode">
              <option value="observe">observe</option>
              <option value="recommend">recommend</option>
              <option value="route">route</option>
              <option value="govern">govern (intent)</option>
            </select>
            <button type="submit">Save ruleset</button>
          </form>
          <form className="form panel" onSubmit={addRule}>
            <p className="kicker">Rule</p>
            <select name="rulesetId">{data.rulesets.map((ruleset) => <option key={ruleset.id} value={ruleset.id}>{ruleset.name}</option>)}</select>
            <select name="workflowId">{data.workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</select>
            <select name="strategyKind">
              <option value="specific_model">specific model</option>
              <option value="auto">Cursor Auto</option>
              <option value="organisation_default">organisation default</option>
            </select>
            <input name="modelId" placeholder="model id (if specific)" />
            <label><input type="checkbox" name="overridable" defaultChecked /> overridable</label>
            <button type="submit">Save rule</button>
          </form>
          <form className="form panel" onSubmit={bind}>
            <p className="kicker">Bind</p>
            <select name="rulesetId">{data.rulesets.map((ruleset) => <option key={ruleset.id} value={ruleset.id}>{ruleset.name}</option>)}</select>
            <select name="scopeKind">
              <option value="organisation">organisation</option>
              <option value="group">group</option>
              <option value="project">project</option>
              <option value="repository">repository</option>
              <option value="user">user</option>
            </select>
            <input name="scopeId" placeholder="org | group id | project id | repo | email" required />
            <button type="submit">Bind</button>
          </form>
          <form className="form panel" onSubmit={lookup}>
            <p className="kicker">Effective policy</p>
            <input name="user" placeholder="user email" />
            <input name="repository" placeholder="repository" />
            <input name="project" placeholder="project id" />
            <button type="submit">Resolve</button>
            <pre className="muted">{JSON.stringify(effective, null, 2)}</pre>
          </form>
          <form className="form panel" onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            await api("/api/apply", { method: "POST", body: JSON.stringify({ userEmail: form.get("userEmail") }) });
          }}>
            <p className="kicker">Apply routed subagents</p>
            <input name="userEmail" placeholder="user email" />
            <button type="submit">Write ~/.cursor/agents</button>
          </form>
        </div>
      </div>
    </>
  );
}

function Models() {
  const [data, setData] = useState<{
    models: Array<{ id: string; display_name: string | null; source: string; notes: string | null; admin_price_note: string | null }>;
    snapshots: Array<{ id: string; at: number; source: string }>;
  } | null>(null);
  const [settings, setSettings] = useState<{ name: string; seatCostCents: number | null; hasApiKey: boolean } | null>(null);
  const reload = () => {
    api("/api/models").then(setData);
    api("/api/settings").then(setSettings);
  };
  useEffect(() => { reload(); }, []);
  if (!data || !settings) return null;
  return (
    <>
      <p className="kicker">Registry</p>
      <h1>Models</h1>
      <p className="muted">
        A new-model alert means an identifier appeared that was missing from the previous snapshot.
        The catalog is used when Cursor exposes it; otherwise Todash uses observed models and admin notes.
      </p>
      <div className="split">
        <table>
          <thead><tr><th>Id</th><th>Source</th><th>Notes</th><th>Price note</th></tr></thead>
          <tbody>
            {data.models.map((model) => (
              <tr key={model.id}>
                <td>{model.display_name || model.id}</td>
                <td>{model.source}</td>
                <td>{model.notes ?? "—"}</td>
                <td>{model.admin_price_note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid">
          <form className="form panel" onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            await api("/api/models", {
              method: "POST",
              body: JSON.stringify({
                id: form.get("id"),
                notes: form.get("notes"),
                adminPriceNote: form.get("adminPriceNote"),
              }),
            });
            reload();
          }}>
            <p className="kicker">Admin metadata</p>
            <input name="id" placeholder="model id" required />
            <input name="notes" placeholder="notes" />
            <input name="adminPriceNote" placeholder="price note (not inferred)" />
            <button type="submit">Save</button>
          </form>
          <form className="form panel" onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            await api("/api/settings", {
              method: "POST",
              body: JSON.stringify({
                name: form.get("name"),
                seatCostCents: form.get("seatCostCents") ? Number(form.get("seatCostCents")) : null,
                cursorApiKey: form.get("cursorApiKey") || undefined,
              }),
            });
            reload();
          }}>
            <p className="kicker">Organisation</p>
            <input name="name" defaultValue={settings.name} />
            <input name="seatCostCents" placeholder="default seat cost cents" defaultValue={settings.seatCostCents ?? ""} />
            <input name="cursorApiKey" placeholder={settings.hasApiKey ? "API key set — enter to replace" : "Cursor Admin API key"} type="password" />
            <button type="submit">Save settings</button>
          </form>
          <button className="ghost" onClick={async () => { await api("/api/models/refresh", { method: "POST" }); reload(); }}>
            Refresh snapshot
          </button>
        </div>
      </div>
    </>
  );
}

function Alerts() {
  const [rows, setRows] = useState<Array<{
    id: string;
    created_at: number;
    kind: string;
    model_id: string | null;
    summary: string;
    acknowledged: number;
    impact: { workflows: string[]; usersAffected: number; projectsWithActivity: number; previous30DayAttributedCents: number } | null;
  }>>([]);
  const reload = () => api("/api/alerts").then(setRows);
  useEffect(() => { reload(); }, []);
  const open = useMemo(() => rows.filter((row) => !row.acknowledged), [rows]);
  return (
    <>
      <p className="kicker">Attention</p>
      <h1>Alerts</h1>
      <p className="muted">Alerts never change policy. Approve a model change by editing the ruleset.</p>
      {open.length === 0 && <p className="muted">No open alerts.</p>}
      {rows.map((row) => (
        <div className="panel" key={row.id} style={{ marginBottom: "1rem", opacity: row.acknowledged ? 0.55 : 1 }}>
          <p className="kicker">{row.kind}</p>
          <h3>{row.summary}</h3>
          {row.impact && (
            <p>
              Workflows: {row.impact.workflows.join(", ") || "none"} · Users {row.impact.usersAffected} ·
              Projects {row.impact.projectsWithActivity} · 30-day attributed {money(row.impact.previous30DayAttributedCents)}
            </p>
          )}
          {!row.acknowledged && (
            <button onClick={async () => { await api(`/api/alerts/${row.id}/ack`, { method: "POST" }); reload(); }}>
              Acknowledge
            </button>
          )}
        </div>
      ))}
    </>
  );
}
