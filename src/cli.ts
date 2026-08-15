#!/usr/bin/env node
import { Command } from "commander";
import { runAdhocDebug } from "./triggers/adhoc.js";
import { getConfig } from "./config.js";
import { RunStore } from "./observability/runStore.js";
import { logger } from "./observability/logger.js";

const program = new Command();

program
  .name("ade")
  .description("ADE Task Debugger — Cursor SDK cloud agents for failed Snowflake Tasks")
  .version("0.1.0");

program
  .command("debug-task")
  .description("Diagnose a failed Snowflake Task and open a fix PR via a cloud agent")
  .argument("<taskName>", "Fully-qualified task name, e.g. ADE_DEMO.OPS.LOAD_DAILY_ORDERS")
  .option("-d, --database <name>", "Database hint")
  .option("-s, --schema <name>", "Schema hint")
  .option("-e, --error-hint <text>", "Optional error text from the operator")
  .option("-r, --repo <url>", "Override ADE_TARGET_REPO")
  .option("-b, --branch <ref>", "Starting git ref (default: ADE_TARGET_BRANCH)")
  .option("-w, --warehouse <name>", "Warehouse hint")
  .option("--change-object <fqn>", "Triggered change object (FQ name)")
  .option(
    "--change-type <type>",
    "Triggered change type: rename_column|drop_column|alter_type|replace_object|other",
  )
  .option("--change-before <name>", "Prior column/object name (e.g. AMOUNT)")
  .option("--change-after <name>", "New column/object name (e.g. ORDER_TOTAL)")
  .option("--change-detected-at <iso>", "When the change was detected (ISO timestamp)")
  .option("--dry-run", "Skip live Cursor/Snowflake; use examples/sample-failure.json", false)
  .option("--fixture <path>", "Fixture JSON path for dry-run")
  .action(async (taskName: string, opts) => {
    try {
      const result = await runAdhocDebug({
        taskName,
        database: opts.database,
        schema: opts.schema,
        errorHint: opts.errorHint,
        repo: opts.repo,
        branch: opts.branch,
        warehouse: opts.warehouse,
        dryRun: Boolean(opts.dryRun),
        fixture: opts.fixture,
        changeObject: opts.changeObject,
        changeType: opts.changeType,
        changeBefore: opts.changeBefore,
        changeAfter: opts.changeAfter,
        changeDetectedAt: opts.changeDetectedAt,
      });

      console.log("\n--- outcome ---");
      console.log(JSON.stringify(result.evidence.outcome, null, 2));
      if (result.evidence.outcome.dependencyAssessment) {
        const da = result.evidence.outcome.dependencyAssessment;
        console.log(
          `dependencyAssessment blastRadius=${da.blastRadius} impactedCount=${da.impactedCount}`,
        );
      }
      if (result.evidence.prUrl) {
        console.log(`prUrl=${result.evidence.prUrl}`);
      }
      console.log(`localRunId=${result.record.localRunId}`);
      if (result.record.runId) console.log(`runId=${result.record.runId}`);
      if (result.record.agentId) console.log(`agentId=${result.record.agentId}`);

      process.exitCode = result.exitCode;
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

const runs = program.command("runs").description("Inspect locally stored Task Debugger runs");

runs
  .command("list")
  .description("List recent runs")
  .option("-n, --limit <n>", "Max rows", "20")
  .action(async (opts) => {
    const cfg = getConfig();
    const store = new RunStore(cfg.runStoreDir);
    const list = await store.list(Number(opts.limit) || 20);
    if (list.length === 0) {
      console.log("No runs yet. Run: pnpm ade debug-task <TASK> --dry-run");
      return;
    }
    for (const r of list) {
      const outcome = r.outcome?.outcome ?? "-";
      console.log(
        [
          r.startedAt,
          r.status.padEnd(10),
          outcome.padEnd(10),
          r.taskName,
          r.runId ?? r.localRunId,
          r.prUrl ?? "",
        ].join("  "),
      );
    }
  });

runs
  .command("show")
  .description("Show a run by localRunId, Cursor runId, or agentId")
  .argument("<id>", "localRunId | runId | agentId")
  .action(async (id: string) => {
    const cfg = getConfig();
    const store = new RunStore(cfg.runStoreDir);
    const record = await store.get(id);
    if (!record) {
      console.error(`Run not found: ${id}`);
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(record, null, 2));
  });

await program.parseAsync(process.argv);
