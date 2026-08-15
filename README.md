# ADE Task Debugger (Cursor SDK)

API-first **Task Debugger** wedge for Autonomous Data Engineering (ADE): detect a failed Snowflake Task, gather context via Snowflake MCP, diagnose, propose a tested fix as a **PR**, verify/escalate, and record run observability.

Runtime: **Cursor cloud agents** (`@cursor/sdk`) with `autoCreatePR` + `skipReviewerRequest`. Human gate is **PR merge only** — the agent never applies production DDL.

```
Detect → Gather context → Diagnose → Test → Act safely (PR) → Verify → Escalate/audit
```

## Prerequisites

- Node.js 20+
- pnpm (recommended) or npm
- Cursor API key
- GitHub repo the cloud agent can clone and open PRs against
- Snowflake MCP HTTP endpoint (for live runs)

## Setup

```bash
pnpm install          # or: npm install
cp .env.example .env  # fill CURSOR_API_KEY, ADE_TARGET_REPO, Snowflake MCP
pnpm typecheck
```

### Environment

| Variable | Purpose |
| --- | --- |
| `CURSOR_API_KEY` | Cursor user or service-account API key |
| `ADE_TARGET_REPO` | GitHub URL with task SQL (e.g. published `demo/pipeline-repo`) |
| `ADE_TARGET_BRANCH` | Starting ref (default `main`) |
| `ADE_SNOWFLAKE_MCP_URL` | Inline HTTP Snowflake MCP URL |
| `ADE_SNOWFLAKE_MCP_TOKEN` | Bearer token (or set `ADE_SNOWFLAKE_MCP_AUTH_HEADER`) |
| `ADE_DRY_RUN=1` | Force fixture path (no live Cursor/Snowflake) |
| `ADE_RUN_STORE_DIR` | Local JSONL/JSON run store (default `.runs`) |

Never commit `.env` or real tokens.

## CLI

```bash
# Dry / fixture demo (no credentials required)
pnpm ade debug-task ADE_DEMO.OPS.LOAD_DAILY_ORDERS \
  --change-object ADE_DEMO.OPS.ORDERS \
  --change-type rename_column \
  --change-before AMOUNT \
  --change-after ORDER_TOTAL \
  --dry-run

# Live cloud agent + Snowflake MCP (with triggered change)
pnpm ade debug-task ADE_DEMO.OPS.LOAD_DAILY_ORDERS \
  --change-object ADE_DEMO.OPS.ORDERS \
  --change-type rename_column \
  --change-before AMOUNT \
  --change-after ORDER_TOTAL

# Observability
pnpm ade runs list
pnpm ade runs show <localRunId|runId|agentId>
```

Exit codes: `0` finished with parsed outcome; `1` startup/`CursorAgentError`; `2` run executed but `status === "error"`.

## End-to-end demo path

### 1. Fixture path (always works)

```bash
pnpm ade debug-task ADE_DEMO.OPS.LOAD_DAILY_ORDERS \
  --change-object ADE_DEMO.OPS.ORDERS \
  --change-type rename_column \
  --change-before AMOUNT \
  --change-after ORDER_TOTAL \
  --dry-run
pnpm ade runs list
pnpm ade runs show <localRunId from output>
```

Uses `examples/sample-failure.json` (includes `dependencyAssessment`) and writes a run record under `.runs/`.

### 2. Live Snowflake + cloud agent (20-min kit)

1. Seed Snowflake: `demo/reset.sql` then `demo/seed.sql`  
   - Creates `ADE_DEMO.OPS.ORDERS` with `ORDER_TOTAL` (not `AMOUNT`)  
   - Creates downstream view `ADE_DEMO.OPS.ORDERS_SUMMARY`  
   - Creates broken task `ADE_DEMO.OPS.LOAD_DAILY_ORDERS` and executes it once (fails)
2. Point `ADE_TARGET_REPO` at a GitHub repo that includes `tasks/load_daily_orders.sql` (copy from `demo/pipeline-repo/`)
3. Configure Snowflake MCP URL + token in `.env`
4. Run with `--change-*` flags (see CLI above)
5. Open the auto-created PR; inspect `pnpm ade runs show <runId>` for `dependencyAssessment`
6. Human merges the PR (approval gate). Optionally re-run the Task to show green history.

Minute-by-minute script: [`demo/DEMO.md`](demo/DEMO.md).

## Architecture (this repo)

```
Detect → Gather context → Object dependency assessment → Diagnose → Act gate → Test → PR / Escalate → Verify
```

| Path | Role |
| --- | --- |
| `src/cli.ts` | `ade debug-task` / `ade runs` (+ `--change-*` trigger payload) |
| `src/orchestrator.ts` | create → send → stream → wait → parse outcome → optional verify |
| `src/agents/taskDebugger.ts` | Cloud `Agent.create` options + prompt builder |
| `prompts/task-debugger.md` | Specialist steering + mandatory dependency assessment + act gate |
| `src/workflow/` | MRP stages + JSON evidence parser (`dependencyAssessment`) |
| `src/observability/` | JSON run store + logger |
| `demo/` | 20-min seed kit (Task + ORDERS_SUMMARY) |

## Out of scope (MVP)

- DT / dbt / Streams / Openflow specialists (prompt pattern is reusable)
- Always-on Event Table / webhook detector (Phase 2; `--change-*` payload is ready)
- Auto-fixing all downstream objects in one PR
- Direct production mutation without PR
