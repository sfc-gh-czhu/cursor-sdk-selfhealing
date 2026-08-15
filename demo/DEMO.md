# ADE Task Debugger — 20-minute live demo runbook

**Scenario:** Schema drift broke a scheduled Task. `ORDERS.AMOUNT` was renamed to `ORDER_TOTAL`, but the Task SQL still selects `AMOUNT`. A second downstream consumer (`ORDERS_SUMMARY` view) exists so diagnose can show **object dependency assessment**. The agent diagnoses via Snowflake MCP, assesses blast radius, patches repo SQL, opens a PR; the CLI shows the run record.

**Target task:** `ADE_DEMO.OPS.LOAD_DAILY_ORDERS`

---

## Pre-show (T-10)

1. Apply Snowflake scripts:
   - `demo/reset.sql`
   - `demo/seed.sql` (creates tables, `ORDERS_SUMMARY` view, broken task, `EXECUTE TASK` once → failed `TASK_HISTORY`)
2. Confirm env:
   - `CURSOR_API_KEY`
   - `ADE_TARGET_REPO` (repo that contains `tasks/load_daily_orders.sql` — publish `demo/pipeline-repo` or point at a fork)
   - `ADE_SNOWFLAKE_MCP_URL` + token/header
3. Tabs ready: Snowsight task history, GitHub PR list (empty), terminal in this repo
4. Optional warm-up earlier same day: one live `pnpm ade debug-task ...` so prompt/MCP path is cached (~8–12 min)

**Fallback if cloud/MCP is down:** dry-run with `--change-*` flags (below) — label as fallback, not primary.

---

## Minute-by-minute

| Time | What happens |
| --- | --- |
| **0:00–2:00** | Pain framing (reactive page → hours of triage). Show failed Task in Snowsight + error text (`invalid identifier 'AMOUNT'`). Mention `ORDERS_SUMMARY` as another ORDERS consumer. |
| **2:00–3:00** | Run with triggered change payload (below) — print `agentId` / `runId` immediately. |
| **3:00–12:00** | Live stream: Snowflake MCP + **dependency assessment** (upstream/downstream, blastRadius). Narrate MRP: context → assess → diagnose → proposed fix. |
| **12:00–16:00** | Agent finishes: PR (column fix + dependency bullets). Show `pnpm ade runs show <runId>` including `dependencyAssessment`. |
| **16:00–20:00** | Human-in-the-loop: **merge is the approval gate**. Note view still needs a human glance. Optional: re-run Task → green history. Close with “same loop for DT/dbt next”. |

---

## Commands cheat sheet

```bash
# Live with triggered change (credentials required)
pnpm ade debug-task ADE_DEMO.OPS.LOAD_DAILY_ORDERS \
  --change-object ADE_DEMO.OPS.ORDERS \
  --change-type rename_column \
  --change-before AMOUNT \
  --change-after ORDER_TOTAL

# Inspect
pnpm ade runs list
pnpm ade runs show <runId-or-localRunId>

# Fallback
pnpm ade debug-task ADE_DEMO.OPS.LOAD_DAILY_ORDERS \
  --change-object ADE_DEMO.OPS.ORDERS \
  --change-type rename_column \
  --change-before AMOUNT \
  --change-after ORDER_TOTAL \
  --dry-run
```

---

## Explicitly not for a 20-min slot

- Five-debugger router
- Zero-copy clone verification theater
- Live Event Table / webhook detection
- Multi-gate regulated approval beyond “PR = approval”
- Auto-fixing all downstream objects in one PR
