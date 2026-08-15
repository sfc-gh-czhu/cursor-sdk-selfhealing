import { z } from "zod";

export const DependencyAssessmentSchema = z.object({
  changedObjects: z.array(z.string()),
  upstream: z.array(z.string()).default([]),
  downstream: z.array(z.string()).default([]),
  impactedCount: z.number().int().nonnegative(),
  blastRadius: z.enum(["low", "medium", "high", "unknown"]),
  notes: z.array(z.string()).default([]),
});

/** Final machine-readable block required by prompts/task-debugger.md */
export const OutcomeSchema = z.object({
  outcome: z.enum(["resolved", "partial", "escalated", "error", "unresolved"]),
  rootCause: z.string().optional(),
  evidence: z.array(z.string()).default([]),
  prUrl: z.string().url().optional().nullable(),
  escalation: z
    .object({
      hypothesis: z.string(),
      evidence: z.array(z.string()).default([]),
      recommendedNextStep: z.string(),
      risk: z.enum(["low", "medium", "high"]).optional(),
    })
    .optional(),
  dependencyAssessment: DependencyAssessmentSchema.optional(),
  verificationNotes: z.string().optional(),
  stagesCompleted: z.array(z.string()).optional(),
});

export type DependencyAssessment = z.infer<typeof DependencyAssessmentSchema>;
export type TaskDebuggerOutcome = z.infer<typeof OutcomeSchema>;

export type EvidencePackage = {
  outcome: TaskDebuggerOutcome;
  rawText?: string;
  prUrl?: string;
  branch?: string;
  parseError?: string;
};

const JSON_FENCE = /```(?:json)?\s*([\s\S]*?)```/gi;
const LOOSE_OBJECT = /\{[\s\S]*"outcome"\s*:\s*"(?:resolved|partial|escalated|error|unresolved)"[\s\S]*\}/;

/**
 * Extract the final JSON outcome block from assistant text.
 * Prefers fenced ```json blocks; falls back to last object containing "outcome".
 */
export function parseOutcomeFromText(text: string | undefined | null): EvidencePackage {
  if (!text || !text.trim()) {
    return {
      outcome: {
        outcome: "error",
        rootCause: "empty_assistant_result",
        evidence: [],
      },
      parseError: "No assistant result text to parse",
    };
  }

  const candidates: string[] = [];
  for (const match of text.matchAll(JSON_FENCE)) {
    if (match[1]) candidates.push(match[1].trim());
  }
  const loose = text.match(LOOSE_OBJECT);
  if (loose?.[0]) candidates.push(loose[0]);

  // Prefer the last candidate (final answer)
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const raw = JSON.parse(candidates[i]!);
      const outcome = OutcomeSchema.parse(raw);
      return {
        outcome,
        rawText: text,
        prUrl: outcome.prUrl ?? undefined,
      };
    } catch {
      // try previous candidate
    }
  }

  return {
    outcome: {
      outcome: "unresolved",
      rootCause: "unparseable_outcome_json",
      evidence: [text.slice(0, 2000)],
    },
    rawText: text,
    parseError: "Could not parse required outcome JSON from agent result",
  };
}

export function mergePrFromGit(
  package_: EvidencePackage,
  git?: { branches: Array<{ repoUrl: string; branch?: string; prUrl?: string }> },
): EvidencePackage {
  const branchInfo = git?.branches?.[0];
  const prUrl = package_.prUrl ?? package_.outcome.prUrl ?? branchInfo?.prUrl ?? undefined;
  return {
    ...package_,
    prUrl,
    branch: branchInfo?.branch,
    outcome: {
      ...package_.outcome,
      prUrl: prUrl ?? package_.outcome.prUrl,
    },
  };
}
