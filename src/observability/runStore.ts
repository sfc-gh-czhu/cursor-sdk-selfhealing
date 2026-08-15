import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { TaskDebuggerOutcome } from "../workflow/evidence.js";
import type { StageRecord } from "../workflow/stages.js";

export type StreamEventSummary = {
  at: string;
  type: string;
  detail: string;
};

export type RunRecord = {
  localRunId: string;
  agentId?: string;
  runId?: string;
  requestId?: string;
  taskName: string;
  status: "starting" | "running" | "finished" | "error" | "cancelled" | "dry_run";
  model?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  outcome?: TaskDebuggerOutcome;
  prUrl?: string;
  branch?: string;
  stages?: StageRecord[];
  streamSummary: StreamEventSummary[];
  errorMessage?: string;
  dryRun?: boolean;
};

export class RunStore {
  constructor(private readonly dir: string) {}

  private indexPath(): string {
    return path.join(this.dir, "runs.jsonl");
  }

  private recordPath(localRunId: string): string {
    return path.join(this.dir, `${localRunId}.json`);
  }

  async ensure(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async create(partial: Omit<RunRecord, "localRunId" | "streamSummary" | "startedAt"> & {
    startedAt?: string;
  }): Promise<RunRecord> {
    await this.ensure();
    const record: RunRecord = {
      localRunId: randomUUID(),
      streamSummary: [],
      startedAt: partial.startedAt ?? new Date().toISOString(),
      ...partial,
    };
    await this.write(record);
    await this.appendIndex(record);
    return record;
  }

  async update(localRunId: string, patch: Partial<RunRecord>): Promise<RunRecord> {
    const current = await this.get(localRunId);
    if (!current) throw new Error(`Run not found: ${localRunId}`);
    const next: RunRecord = {
      ...current,
      ...patch,
      streamSummary: patch.streamSummary ?? current.streamSummary,
    };
    await this.write(next);
    return next;
  }

  async appendStream(
    localRunId: string,
    event: StreamEventSummary,
    maxEvents = 200,
  ): Promise<void> {
    const current = await this.get(localRunId);
    if (!current) return;
    const streamSummary = [...current.streamSummary, event].slice(-maxEvents);
    await this.write({ ...current, streamSummary });
  }

  async get(localRunIdOrRunId: string): Promise<RunRecord | undefined> {
    await this.ensure();
    const direct = path.join(this.dir, `${localRunIdOrRunId}.json`);
    try {
      const raw = await fs.readFile(direct, "utf8");
      return JSON.parse(raw) as RunRecord;
    } catch {
      // fall through — maybe looking up by Cursor runId
    }

    const all = await this.list();
    return all.find(
      (r) =>
        r.localRunId === localRunIdOrRunId ||
        r.runId === localRunIdOrRunId ||
        r.agentId === localRunIdOrRunId,
    );
  }

  async list(limit = 50): Promise<RunRecord[]> {
    await this.ensure();
    const files = await fs.readdir(this.dir);
    const jsonFiles = files.filter((f) => f.endsWith(".json") && f !== "runs.jsonl");
    const records: RunRecord[] = [];
    for (const file of jsonFiles) {
      try {
        const raw = await fs.readFile(path.join(this.dir, file), "utf8");
        records.push(JSON.parse(raw) as RunRecord);
      } catch {
        // skip corrupt
      }
    }
    records.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    return records.slice(0, limit);
  }

  private async write(record: RunRecord): Promise<void> {
    await fs.writeFile(this.recordPath(record.localRunId), JSON.stringify(record, null, 2), "utf8");
  }

  private async appendIndex(record: RunRecord): Promise<void> {
    const line = JSON.stringify({
      localRunId: record.localRunId,
      agentId: record.agentId,
      runId: record.runId,
      taskName: record.taskName,
      status: record.status,
      startedAt: record.startedAt,
    });
    await fs.appendFile(this.indexPath(), line + "\n", "utf8");
  }
}
