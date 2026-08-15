import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { buildSnowflakeMcpServers } from "../config.js";

export const CHANGE_TYPES = [
  "rename_column",
  "drop_column",
  "alter_type",
  "replace_object",
  "other",
] as const;

export type ChangeType = (typeof CHANGE_TYPES)[number];

export type TriggeredChange = {
  object: string;
  changeType: ChangeType;
  before?: string;
  after?: string;
  detectedAt?: string;
};

export type DebugTaskInput = {
  taskName: string;
  database?: string;
  schema?: string;
  errorHint?: string;
  repoUrl: string;
  branch?: string;
  warehouse?: string;
  dryRun?: boolean;
  fixturePath?: string;
  change?: TriggeredChange;
};

export type CloudAgentCreateOptions = {
  apiKey: string;
  model: { id: string };
  name: string;
  cloud: {
    repos: Array<{ url: string; startingRef?: string }>;
    autoCreatePR: true;
    skipReviewerRequest: true;
  };
  mcpServers?: ReturnType<typeof buildSnowflakeMcpServers>;
};

export async function loadTaskDebuggerPrompt(repoRoot: string): Promise<string> {
  const promptPath = path.join(repoRoot, "prompts", "task-debugger.md");
  return fs.readFile(promptPath, "utf8");
}

export function buildCloudAgentOptions(
  cfg: AppConfig,
  input: DebugTaskInput,
): CloudAgentCreateOptions {
  if (!cfg.apiKey) throw new Error("CURSOR_API_KEY is required");
  const mcpServers = buildSnowflakeMcpServers(cfg);

  return {
    apiKey: cfg.apiKey,
    model: { id: cfg.model },
    name: `ADE Task Debugger — ${input.taskName}`,
    cloud: {
      repos: [
        {
          url: input.repoUrl,
          startingRef: input.branch ?? cfg.targetBranch,
        },
      ],
      autoCreatePR: true,
      skipReviewerRequest: true,
    },
    mcpServers,
  };
}

export async function buildTaskDebuggerPrompt(
  cfg: AppConfig,
  input: DebugTaskInput,
): Promise<string> {
  const steering = await loadTaskDebuggerPrompt(cfg.repoRoot);
  const database = input.database ?? cfg.defaultDatabase;
  const schema = input.schema ?? cfg.defaultSchema;
  const warehouse = input.warehouse ?? cfg.defaultWarehouse;

  const changeBlock = input.change
    ? [
        `- **Triggered change object:** \`${input.change.object}\``,
        `- **Change type:** \`${input.change.changeType}\``,
        input.change.before ? `- **Before:** \`${input.change.before}\`` : null,
        input.change.after ? `- **After:** \`${input.change.after}\`` : null,
        input.change.detectedAt
          ? `- **Detected at:** \`${input.change.detectedAt}\``
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    : `- **Triggered change:** not provided — infer changed object(s) from TASK_HISTORY / error text`;

  return `${steering}

---

## This run

- **Fully-qualified task name:** \`${input.taskName}\`
- **Database (hint):** \`${database}\`
- **Schema (hint):** \`${schema}\`
${warehouse ? `- **Warehouse (hint):** \`${warehouse}\`` : ""}
${input.errorHint ? `- **Error hint from operator:** ${input.errorHint}` : ""}
${changeBlock}
- **Target repo:** ${input.repoUrl}
- **Starting ref:** ${input.branch ?? cfg.targetBranch}

Follow the MRP stages. Run the mandatory **object dependency assessment** before locking root cause. Use Snowflake MCP tools for context. Apply the blast-radius act gate before opening a PR. Do not apply production DDL. End with the required JSON outcome block including \`dependencyAssessment\`.
`;
}

export async function loadFixtureFailure(
  repoRoot: string,
  fixturePath?: string,
): Promise<unknown> {
  const resolved =
    fixturePath ?? path.join(repoRoot, "examples", "sample-failure.json");
  const raw = await fs.readFile(resolved, "utf8");
  return JSON.parse(raw);
}
