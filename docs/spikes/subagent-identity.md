# Custom subagent identity (Stage 1 spike)

Status: documented against Cursor's public hook contract. Live payloads should be captured with `todash hook install` and inspected in Usage / `hook_events.payload`.

## What Cursor documents today

`subagentStart` includes:

| Field | Role |
| --- | --- |
| `subagent_id` | Instance id for this spawn, not a workflow id |
| `subagent_type` | Matcher field. Documented examples: `generalPurpose`, `explore`, `shell` |
| `task` | Prompt text given to the subagent |
| `subagent_model` | Model the subagent will use |
| `parent_conversation_id` | Parent session |
| Common hook fields | `conversation_id`, `generation_id`, `model` / `model_id` (selected composer model) |

Official docs do **not** promise that a custom `.cursor/agents/*.md` `name` is exposed as `subagent_type`.

## Todash mapping rule (v1)

Workflow is **exact** only when `subagent_type` equals a configured workflow `subagent_identity`.

Compiled routed agents use:

```text
name: todash-<workflow-id>
```

If Cursor reports that string as `subagent_type`, workflow attribution lights up. If custom agents arrive as `generalPurpose` (or another built-in type), workflow stays **unclassified**.

`task`, `subagent_model`, and `subagent_id` are stored on the raw hook event. They are not used as a deterministic workflow key in v1.

## How to prove it on a machine

1. `todash hook install`
2. `todash apply` after defining a routed Testing workflow
3. Invoke the compiled subagent from Cursor
4. Open Usage, or `sqlite3 ~/.todash/todash.db 'select hook_type, subagent_type, payload from hook_events where hook_type = "subagentStart"'`

If `subagent_type` is `todash-testing`, identity mapping works. If it is `generalPurpose`, keep workflow unclassified and still attribute user, repository, selected model, and (after Stage 4) executed model and cost.

The architecture stays valid either way.
