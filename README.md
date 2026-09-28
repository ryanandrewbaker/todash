# Todash

Govern, route and understand agentic software development in Cursor.

Todash is a local-first, open-source policy, observability and FinOps layer. Cursor remains the execution environment. Developers can keep using Auto, a manual model, or Todash workflows. Unknown data stays unknown.

```text
Observe → Attribute → Define policy → Recommend → Route → Govern
```

## Requirements

- Node.js 20+

## Install

```bash
npm install
npm run build
npm run todash -- serve
```

Open [http://127.0.0.1:4780](http://127.0.0.1:4780).

Development (API + Vite):

```bash
npm run dev
```

Vite is on port 5173 and proxies `/api` to the Todash server.

## Observe without changing how people use Cursor

```bash
npm run todash -- hook install
```

This adds fail-open observe hooks to `~/.cursor/hooks.json`. Every hook payload is stored immutably in `~/.todash/todash.db` as `hook_events`. Derived `usage_records` are a rebuildable projection.

```bash
npm run todash -- rebuild
```

## Progressive stages

1. **Observe** — hooks, repositories, unclassified usage
2. **Organise** — people, groups, projects
3. **Policy** — workflows, rulesets, `todash apply` for routed subagents
4. **Attribute** — optional Cursor Enterprise Admin API billing poll
5. **Models** — snapshot diff alerts; never silent policy edits

Configure an Admin API key in Models if you have an Enterprise team. Stages 1–3 work without it.

## Cost figures are not a single total

| Figure | Source |
| --- | --- |
| Attributed model consumption | `tokenUsage.totalCents` |
| Incremental billed usage | chargeable `chargedCents` |
| Seat cost | admin-entered subscription amount |

## Data

Default home: `~/.todash` (override with `TODASH_HOME`).
