/**
 * MRP JTBD stages for the Task Debugger wedge.
 * Detect → Gather context → Diagnose → Test → Act safely (PR) → Verify → Escalate/audit
 */
export const MRP_STAGES = [
  "detect",
  "gather_context",
  "diagnose",
  "test",
  "act_safely",
  "verify",
  "escalate",
] as const;

export type MrpStage = (typeof MRP_STAGES)[number];

export type StageStatus = "pending" | "in_progress" | "completed" | "skipped" | "failed";

export type StageRecord = {
  stage: MrpStage;
  status: StageStatus;
  startedAt?: string;
  finishedAt?: string;
  note?: string;
};

export class StageMachine {
  private readonly stages: StageRecord[];

  constructor() {
    this.stages = MRP_STAGES.map((stage) => ({
      stage,
      status: "pending" as StageStatus,
    }));
  }

  start(stage: MrpStage, note?: string): void {
    const rec = this.get(stage);
    rec.status = "in_progress";
    rec.startedAt = new Date().toISOString();
    if (note) rec.note = note;
  }

  complete(stage: MrpStage, note?: string): void {
    const rec = this.get(stage);
    rec.status = "completed";
    rec.finishedAt = new Date().toISOString();
    if (note) rec.note = note;
  }

  skip(stage: MrpStage, note?: string): void {
    const rec = this.get(stage);
    rec.status = "skipped";
    rec.finishedAt = new Date().toISOString();
    if (note) rec.note = note;
  }

  fail(stage: MrpStage, note?: string): void {
    const rec = this.get(stage);
    rec.status = "failed";
    rec.finishedAt = new Date().toISOString();
    if (note) rec.note = note;
  }

  snapshot(): StageRecord[] {
    return this.stages.map((s) => ({ ...s }));
  }

  private get(stage: MrpStage): StageRecord {
    const rec = this.stages.find((s) => s.stage === stage);
    if (!rec) throw new Error(`Unknown stage: ${stage}`);
    return rec;
  }
}
