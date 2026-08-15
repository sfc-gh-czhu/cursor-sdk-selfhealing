import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotenv({ path: path.join(repoRoot, ".env") });

const envSchema = z.object({
  CURSOR_API_KEY: z.string().min(1).optional(),
  ADE_TARGET_REPO: z.string().url().optional(),
  ADE_TARGET_BRANCH: z.string().default("main"),
  ADE_MODEL: z.string().default("composer-2.5"),
  ADE_SNOWFLAKE_MCP_URL: z.string().url().optional(),
  ADE_SNOWFLAKE_MCP_TOKEN: z.string().optional(),
  ADE_SNOWFLAKE_MCP_AUTH_HEADER: z.string().optional(),
  ADE_DEFAULT_DATABASE: z.string().default("ADE_DEMO"),
  ADE_DEFAULT_SCHEMA: z.string().default("OPS"),
  ADE_DEFAULT_WAREHOUSE: z.string().optional(),
  ADE_RUN_STORE_DIR: z.string().default(".runs"),
  ADE_DRY_RUN: z
    .string()
    .optional()
    .transform((v) => v === "1" || v?.toLowerCase() === "true"),
});

export type AppConfig = {
  apiKey?: string;
  targetRepo?: string;
  targetBranch: string;
  model: string;
  snowflakeMcpUrl?: string;
  snowflakeMcpToken?: string;
  snowflakeMcpAuthHeader?: string;
  defaultDatabase: string;
  defaultSchema: string;
  defaultWarehouse?: string;
  runStoreDir: string;
  dryRun: boolean;
  repoRoot: string;
};

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.parse(process.env);
  cached = {
    apiKey: parsed.CURSOR_API_KEY,
    targetRepo: parsed.ADE_TARGET_REPO,
    targetBranch: parsed.ADE_TARGET_BRANCH,
    model: parsed.ADE_MODEL,
    snowflakeMcpUrl: parsed.ADE_SNOWFLAKE_MCP_URL,
    snowflakeMcpToken: parsed.ADE_SNOWFLAKE_MCP_TOKEN,
    snowflakeMcpAuthHeader: parsed.ADE_SNOWFLAKE_MCP_AUTH_HEADER,
    defaultDatabase: parsed.ADE_DEFAULT_DATABASE,
    defaultSchema: parsed.ADE_DEFAULT_SCHEMA,
    defaultWarehouse: parsed.ADE_DEFAULT_WAREHOUSE,
    runStoreDir: path.isAbsolute(parsed.ADE_RUN_STORE_DIR)
      ? parsed.ADE_RUN_STORE_DIR
      : path.join(repoRoot, parsed.ADE_RUN_STORE_DIR),
    dryRun: Boolean(parsed.ADE_DRY_RUN),
    repoRoot,
  };
  return cached;
}

export function requireLiveCredentials(cfg: AppConfig): void {
  const missing: string[] = [];
  if (!cfg.apiKey) missing.push("CURSOR_API_KEY");
  if (!cfg.targetRepo) missing.push("ADE_TARGET_REPO");
  if (!cfg.snowflakeMcpUrl) missing.push("ADE_SNOWFLAKE_MCP_URL");
  if (missing.length > 0) {
    throw new Error(
      `Missing required env for live run: ${missing.join(", ")}. ` +
        `Set ADE_DRY_RUN=1 to use the fixture path, or copy .env.example → .env.`,
    );
  }
}

export type SnowflakeMcpConfig = {
  type: "http";
  url: string;
  headers: Record<string, string>;
};

/** Build inline Snowflake MCP config for Agent.create / agent.send / Agent.resume. */
export function buildSnowflakeMcpServers(
  cfg: AppConfig,
): Record<string, SnowflakeMcpConfig> | undefined {
  if (!cfg.snowflakeMcpUrl) return undefined;

  const headers: Record<string, string> = {};
  if (cfg.snowflakeMcpAuthHeader) {
    // Full header value, e.g. "Bearer xxx" or "Snowflake Token=\"...\""
    headers.Authorization = cfg.snowflakeMcpAuthHeader;
  } else if (cfg.snowflakeMcpToken) {
    headers.Authorization = `Bearer ${cfg.snowflakeMcpToken}`;
  }

  return {
    snowflake: {
      type: "http",
      url: cfg.snowflakeMcpUrl,
      headers,
    },
  };
}
