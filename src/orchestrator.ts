import { Agent, CursorAgentError } from "@cursor/sdk";
import {
  getConfig,
  requireLiveCredentials,
  buildSnowflakeMcpServers,
  type AppConfig,
} from "./config.js";
import {
  buildCloudAgentOptions,
  buildTaskDebuggerPrompt,
  loadFixtureFailure,
  type DebugTaskInput,
} from "./agents/taskDebugger.js";
import { StageMachine } from "./workflow/stages.js";
import {
  mergePrFromGit,
  parseOutcomeFromText,
  type EvidencePackage,
  type TaskDebuggerOutcome,
} from "./workflow/evidence.js";
import { RunStore, type RunRecord, type StreamEventSummary } from "./observability/runStore.js";
import { logger } from "./observability/logger.js";

export type OrchestratorResult = {
  record: RunRecord;
  evidence: EvidencePackage;
  exitCode: 0 | 1 | 2;
};

function summarizeStreamEvent(event: {
  type: string;
  name?: string;
  status?: string;
  text?: string;
  message?: { content?: Array<{ type: string; text?: string }> };
}): StreamEventSummary {
  const at = new Date().toISOString();
  switch (event.type) {
    case "assistant": {
      const text =
        event.message?.content
          ?.filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("")
          .slice(0, 240) ?? "";
      return { at, type: "assistant", detail: text };
    }
    case "tool_call":
      return {
        at,
        type: "tool_call",
        detail: `${event.name ?? "tool"}: ${event.status ?? ""}`.trim(),
      };
    case "status":
      return { at, type: "status", detail: String(event.status ?? "") };
    case "thinking":
      return { at, type: "thinking", detail: (event.text ?? "").slice(0, 120) };
    default:
      return { at, type: event.type, detail: "" };
  }
}

function fixtureOutcome(fixture: unknown): TaskDebuggerOutcome {
  const f = fixture as {
    outcome?: TaskDebuggerOutcome;
    taskName?: string;
    rootCause?: string;
    evidence?: string[];
    prUrl?: string;
    change?: {
      object?: string;
      before?: string;
      after?: string;
    };
  };
  if (f.outcome) return f.outcome;
  const changed =
    f.change?.before && f.change?.after && f.change?.object
      ? [`${f.change.object}.${f.change.before}→${f.change.after}`]
      : ["ADE_DEMO.OPS.ORDERS.AMOUNT→ORDER_TOTAL"];
  return {
    outcome: "resolved",
    rootCause:
      f.rootCause ??
      "Schema drift: ORDERS.AMOUNT renamed to ORDER_TOTAL; task SQL still references AMOUNT",
    evidence: f.evidence ?? [
      "TASK_HISTORY shows SQL compilation error: invalid identifier 'AMOUNT'",
      "DESCRIBE TABLE ORDERS shows ORDER_TOTAL, not AMOUNT",
      "Repo file tasks/load_daily_orders.sql still selects AMOUNT",
    ],
    prUrl: f.prUrl ?? "https://github.com/example/pipeline/pull/0",
    dependencyAssessment: {
      changedObjects: changed,
      upstream: ["ADE_DEMO.OPS.ORDERS"],
      downstream: [
        "ADE_DEMO.OPS.LOAD_DAILY_ORDERS",
        "ADE_DEMO.OPS.ORDERS_SUMMARY",
      ],
      impactedCount: 2,
      blastRadius: "medium",
      notes: [
        "Fixture default assessment — Task + ORDERS_SUMMARY view",
      ],
    },
    verificationNotes:
      "Dry-run fixture — no live Cursor/Snowflake call. Merge PR then re-EXECUTE TASK to verify.",
  };
}

async function runDry(
  cfg: AppConfig,
  input: DebugTaskInput,
  store: RunStore,
): Promise<OrchestratorResult> {
  const stages = new StageMachine();
  stages.start(
    "detect",
    input.change
      ? `CLI trigger (dry) + change ${input.change.changeType} on ${input.change.object}`
      : "CLI trigger (dry)",
  );
  stages.complete("detect");

  const record = await store.create({
    taskName: input.taskName,
    status: "dry_run",
    model: cfg.model,
    dryRun: true,
  });

  stages.start("gather_context");
  const fixture = await loadFixtureFailure(cfg.repoRoot, input.fixturePath);
  stages.complete("gather_context", "Loaded examples/sample-failure.json");

  stages.start("diagnose", "Object dependency assessment");
  const outcome = fixtureOutcome(fixture);
  const blast = outcome.dependencyAssessment?.blastRadius ?? "unknown";
  stages.complete(
    "diagnose",
    `${outcome.rootCause ?? "diagnosed"} | blastRadius=${blast} impacted=${outcome.dependencyAssessment?.impactedCount ?? "?"}`,
  );

  if (outcome.outcome === "escalated") {
    stages.skip("test", "Escalated after dependency gate");
    stages.skip("act_safely", "Escalated after dependency gate");
    stages.start("escalate");
    stages.complete("escalate", outcome.escalation?.recommendedNextStep);
    stages.skip("verify", "Escalated");
  } else {
    stages.start("test");
    stages.complete("test", "Fixture documents dry-run verification steps");

    stages.start("act_safely");
    stages.complete(
      "act_safely",
      outcome.prUrl ? `Fixture PR ${outcome.prUrl}` : "No PR in fixture",
    );

    stages.skip("escalate", "Not needed");
    stages.start("verify");
    stages.complete("verify", outcome.verificationNotes ?? "Fixture verify notes");
  }

  const evidence: EvidencePackage = {
    outcome,
    prUrl: outcome.prUrl ?? undefined,
    rawText: JSON.stringify(fixture, null, 2),
  };

  const finished = await store.update(record.localRunId, {
    status: "finished",
    finishedAt: new Date().toISOString(),
    durationMs: 0,
    outcome,
    prUrl: evidence.prUrl,
    stages: stages.snapshot(),
    agentId: "dry-agent",
    runId: `dry-${record.localRunId.slice(0, 8)}`,
  });

  logger.info("Dry run complete", {
    localRunId: finished.localRunId,
    outcome: outcome.outcome,
    prUrl: evidence.prUrl,
    blastRadius: outcome.dependencyAssessment?.blastRadius,
    impactedCount: outcome.dependencyAssessment?.impactedCount,
  });

  return { record: finished, evidence, exitCode: 0 };
}

export async function debugTask(input: DebugTaskInput): Promise<OrchestratorResult> {
  const cfg = getConfig();
  const store = new RunStore(cfg.runStoreDir);
  const dry = Boolean(input.dryRun || cfg.dryRun);

  if (dry) {
    logger.info("ADE_DRY_RUN / --dry-run: using fixture path");
    return runDry(cfg, input, store);
  }

  try {
    requireLiveCredentials(cfg);
  } catch (err) {
    logger.warn(String(err));
    logger.info("Falling back to dry/fixture path (credentials missing)");
    return runDry(cfg, { ...input, dryRun: true }, store);
  }

  const stages = new StageMachine();
  stages.start("detect", "CLI / ad-hoc trigger");
  stages.complete("detect");

  const record = await store.create({
    taskName: input.taskName,
    status: "starting",
    model: cfg.model,
  });

  const prompt = await buildTaskDebuggerPrompt(cfg, input);
  const agentOptions = buildCloudAgentOptions(cfg, input);

  try {
    stages.start("gather_context", "Cloud agent + Snowflake MCP");
    await using agent = await Agent.create(agentOptions);

    const run = await agent.send(prompt);
    logger.info("Cloud agent started", {
      agentId: agent.agentId,
      runId: run.id,
      localRunId: record.localRunId,
      change: input.change ?? null,
    });
    console.log(`agentId=${agent.agentId}`);
    console.log(`runId=${run.id}`);
    if (input.change) {
      console.log(
        `change=${input.change.changeType} object=${input.change.object}` +
          (input.change.before ? ` before=${input.change.before}` : "") +
          (input.change.after ? ` after=${input.change.after}` : ""),
      );
    }

    await store.update(record.localRunId, {
      agentId: agent.agentId,
      runId: run.id,
      status: "running",
    });

    for await (const event of run.stream()) {
      const summary = summarizeStreamEvent(event as Parameters<typeof summarizeStreamEvent>[0]);
      await store.appendStream(record.localRunId, summary);
      if (event.type === "tool_call") {
        const name = (event as { name?: string }).name ?? "tool";
        const status = (event as { status?: string }).status ?? "";
        logger.info(`[tool] ${name}: ${status}`);
      } else if (event.type === "assistant") {
        const msg = event as {
          message?: { content?: Array<{ type: string; text?: string }> };
        };
        for (const block of msg.message?.content ?? []) {
          if (block.type === "text" && block.text) process.stdout.write(block.text);
        }
      }
    }

    const result = await run.wait();
    stages.complete("gather_context");
    stages.start("diagnose", "Object dependency assessment + root cause");
    stages.complete("diagnose");
    stages.start("test");
    stages.complete("test");
    stages.start("act_safely");

    if (result.status === "error") {
      stages.fail("act_safely", result.error?.message);
      const outcome: TaskDebuggerOutcome = {
        outcome: "error",
        rootCause: result.error?.message ?? "run_error",
        evidence: [],
      };
      const finished = await store.update(record.localRunId, {
        status: "error",
        finishedAt: new Date().toISOString(),
        durationMs: result.durationMs,
        outcome,
        errorMessage: result.error?.message,
        stages: stages.snapshot(),
      });
      logger.error("Run failed mid-flight", { runId: result.id });
      return {
        record: finished,
        evidence: { outcome },
        exitCode: 2,
      };
    }

    if (result.status === "cancelled") {
      stages.fail("act_safely", "cancelled");
      const outcome: TaskDebuggerOutcome = {
        outcome: "error",
        rootCause: "cancelled",
        evidence: [],
      };
      const finished = await store.update(record.localRunId, {
        status: "cancelled",
        finishedAt: new Date().toISOString(),
        durationMs: result.durationMs,
        outcome,
        stages: stages.snapshot(),
      });
      return { record: finished, evidence: { outcome }, exitCode: 2 };
    }

    let evidence = mergePrFromGit(parseOutcomeFromText(result.result), result.git);
    stages.complete(
      "act_safely",
      evidence.prUrl ? `PR ${evidence.prUrl}` : "No PR URL (branch-only or escalation)",
    );

    // Optional verify turn when we have a PR and outcome isn't already escalated
    if (
      evidence.outcome.outcome !== "escalated" &&
      evidence.outcome.outcome !== "error"
    ) {
      stages.start("verify", "Follow-up verify turn");
      try {
        const mcpServers = buildSnowflakeMcpServers(cfg);
        const verifyRun = await agent.send(
          [
            "Verification follow-up for the Task Debugger run.",
            `Task: ${input.taskName}`,
            evidence.prUrl ? `Proposed PR: ${evidence.prUrl}` : "No PR URL yet.",
            "Do NOT apply production DDL.",
            "Re-check TASK_HISTORY / task definition via Snowflake MCP if useful.",
            "Confirm resolution criteria or mark partial/unresolved.",
            "Reply with an updated JSON outcome block only.",
          ].join("\n"),
          mcpServers ? { mcpServers } : undefined,
        );
        console.log(`verifyRunId=${verifyRun.id}`);
        const verifyResult = await verifyRun.wait();
        if (verifyResult.status === "finished" && verifyResult.result) {
          const verified = parseOutcomeFromText(verifyResult.result);
          evidence = mergePrFromGit(
            {
              ...verified,
              prUrl: verified.prUrl ?? evidence.prUrl,
              outcome: {
                ...verified.outcome,
                prUrl: verified.outcome.prUrl ?? evidence.prUrl,
              },
            },
            verifyResult.git ?? result.git,
          );
        }
        stages.complete("verify");
      } catch (verifyErr) {
        stages.fail("verify", String(verifyErr));
        if (evidence.outcome.outcome === "resolved") {
          evidence = {
            ...evidence,
            outcome: { ...evidence.outcome, outcome: "partial" },
          };
        }
      }
      stages.skip("escalate", "Verify path taken");
    } else if (evidence.outcome.outcome === "escalated") {
      stages.skip("verify", "Escalated");
      stages.start("escalate");
      stages.complete("escalate", evidence.outcome.escalation?.recommendedNextStep);
    } else {
      stages.skip("verify");
      stages.skip("escalate");
    }

    const finished = await store.update(record.localRunId, {
      status: "finished",
      finishedAt: new Date().toISOString(),
      durationMs: result.durationMs,
      outcome: evidence.outcome,
      prUrl: evidence.prUrl,
      branch: evidence.branch,
      stages: stages.snapshot(),
      requestId: result.requestId,
    });

    logger.info("Task debugger finished", {
      outcome: evidence.outcome.outcome,
      prUrl: evidence.prUrl,
      localRunId: finished.localRunId,
      blastRadius: evidence.outcome.dependencyAssessment?.blastRadius,
      impactedCount: evidence.outcome.dependencyAssessment?.impactedCount,
    });

    if (evidence.outcome.dependencyAssessment) {
      console.log(
        `dependencyAssessment blastRadius=${evidence.outcome.dependencyAssessment.blastRadius} impactedCount=${evidence.outcome.dependencyAssessment.impactedCount}`,
      );
    }

    return { record: finished, evidence, exitCode: 0 };
  } catch (err) {
    if (err instanceof CursorAgentError) {
      stages.fail("gather_context", err.message);
      const outcome: TaskDebuggerOutcome = {
        outcome: "error",
        rootCause: err.message,
        evidence: [`retryable=${String(err.isRetryable)}`],
      };
      const finished = await store.update(record.localRunId, {
        status: "error",
        finishedAt: new Date().toISOString(),
        outcome,
        errorMessage: err.message,
        stages: stages.snapshot(),
      });
      logger.error("Startup failed (CursorAgentError)", {
        message: err.message,
        retryable: err.isRetryable,
      });
      return { record: finished, evidence: { outcome }, exitCode: 1 };
    }
    throw err;
  }
}
