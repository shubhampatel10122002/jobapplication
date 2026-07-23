import type { NormalizedField, NormalizedJob } from "../ats/types";

export interface ResolvedAnswer {
  field: NormalizedField;
  /** Submit value (option value for selects; "; "-joined for multi-selects) */
  value: string;
  /** Human-readable label (option label for selects) */
  valueLabel: string | null;
}

/**
 * Async helper consulted when a rendered option list doesn't confidently match
 * the planned answer (dynamic typeaheads). Returns the chosen option text or
 * null. Typically LLM-backed; injectable so the engine stays testable offline.
 */
export type ChooseOptionFn = (args: {
  fieldLabel: string;
  want: string;
  options: string[];
}) => Promise<string | null>;

export interface SubmissionInput {
  job: NormalizedJob;
  answers: ResolvedAnswer[];
  resumePath: string | null;
  /** When true, fill everything and screenshot but never click submit. */
  dryRun: boolean;
  screenshotPath: string;
  chooseOption?: ChooseOptionFn;
}

export type SubmissionStatus =
  | "submitted"
  | "dry_run_complete"
  | "needs_attention"
  | "failed";

/** Per-field outcome of the fill engine — the audit trail for one widget. */
export interface FieldFillReport {
  fieldId: string;
  label: string;
  status: "filled" | "failed" | "skipped";
  /** Which interaction path was taken (e.g. "combobox", "radio group"). */
  strategy: string | null;
  /** Verified widget state after the interaction, when readable. */
  committed: string | null;
  detail: string | null;
}

export interface SubmissionResult {
  status: SubmissionStatus;
  detail: string;
  filledLabels: string[];
  unfilledLabels: string[];
  fieldReports: FieldFillReport[];
  screenshotPath: string | null;
}
