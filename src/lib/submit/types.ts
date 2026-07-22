import type { NormalizedField, NormalizedJob } from "../ats/types";

export interface ResolvedAnswer {
  field: NormalizedField;
  /** Submit value (option value for selects) */
  value: string;
  /** Human-readable label (option label for selects) */
  valueLabel: string | null;
}

export interface SubmissionInput {
  job: NormalizedJob;
  answers: ResolvedAnswer[];
  resumePath: string | null;
  /** When true (default), fill everything and screenshot but never click submit. */
  dryRun: boolean;
  screenshotPath: string;
}

export type SubmissionStatus =
  | "submitted"
  | "dry_run_complete"
  | "needs_attention"
  | "failed";

export interface SubmissionResult {
  status: SubmissionStatus;
  detail: string;
  filledLabels: string[];
  unfilledLabels: string[];
  screenshotPath: string | null;
}
