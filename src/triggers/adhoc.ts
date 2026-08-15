import {
  CHANGE_TYPES,
  type ChangeType,
  type DebugTaskInput,
  type TriggeredChange,
} from "../agents/taskDebugger.js";
import { debugTask } from "../orchestrator.js";
import { getConfig } from "../config.js";

export type AdhocDebugOptions = {
  taskName: string;
  database?: string;
  schema?: string;
  errorHint?: string;
  repo?: string;
  branch?: string;
  warehouse?: string;
  dryRun?: boolean;
  fixture?: string;
  changeObject?: string;
  changeType?: string;
  changeBefore?: string;
  changeAfter?: string;
  changeDetectedAt?: string;
};

function buildChange(opts: AdhocDebugOptions): TriggeredChange | undefined {
  if (!opts.changeObject && !opts.changeType) return undefined;
  if (!opts.changeObject || !opts.changeType) {
    throw new Error(
      "Both --change-object and --change-type are required when specifying a triggered change",
    );
  }
  if (!(CHANGE_TYPES as readonly string[]).includes(opts.changeType)) {
    throw new Error(
      `Invalid --change-type "${opts.changeType}". Expected one of: ${CHANGE_TYPES.join(", ")}`,
    );
  }
  return {
    object: opts.changeObject,
    changeType: opts.changeType as ChangeType,
    before: opts.changeBefore,
    after: opts.changeAfter,
    detectedAt: opts.changeDetectedAt,
  };
}

export async function runAdhocDebug(opts: AdhocDebugOptions) {
  const cfg = getConfig();
  const repoUrl = opts.repo ?? cfg.targetRepo;
  if (!repoUrl && !opts.dryRun && !cfg.dryRun) {
    // orchestrator will fall back to dry if credentials missing; still need a repo string for prompt
  }

  const input: DebugTaskInput = {
    taskName: opts.taskName,
    database: opts.database,
    schema: opts.schema,
    errorHint: opts.errorHint,
    repoUrl: repoUrl ?? "https://github.com/example/pipeline-repo",
    branch: opts.branch,
    warehouse: opts.warehouse,
    dryRun: opts.dryRun,
    fixturePath: opts.fixture,
    change: buildChange(opts),
  };

  return debugTask(input);
}
