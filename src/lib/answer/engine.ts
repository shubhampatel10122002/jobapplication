import { createHash } from "node:crypto";
import type { NormalizedField, NormalizedJob } from "../ats/types";
import { resolveEeoAnswer, type EeoDefaults, EEO_DEFAULTS } from "../profile/eeo";
import type { CandidateProfile } from "../profile/types";
import { resolveProfileAnswer } from "./deterministic";

export interface LlmQuestion {
  label: string;
  type: NormalizedField["type"];
  /** For select questions: the option labels the answer MUST be one of. */
  optionLabels?: string[];
  jobTitle: string;
  companyName: string;
  jobDescription: string;
  profile: CandidateProfile;
  knowledgeBase: string[];
}

/** Injectable so tests (and future providers) don't touch the real LLM. */
export type LlmAnswerFn = (q: LlmQuestion) => Promise<string>;

export interface AnswerCacheStore {
  get(hash: string): Promise<string | null>;
  set(hash: string, questionLabel: string, answer: string): Promise<void>;
}

export interface PlannedAnswer {
  field: NormalizedField;
  source: "profile" | "eeo_default" | "llm" | "resume_file" | "unresolved";
  /** Submit value (option value for selects), null when unresolved */
  value: string | null;
  /** Human-readable version (option label for selects) */
  valueLabel: string | null;
  /** True when the user must fill/confirm this manually before submission */
  needsReview: boolean;
  fromCache?: boolean;
}

export function questionHash(field: NormalizedField): string {
  const normalized = [
    field.label.toLowerCase().replace(/\s+/g, " ").trim(),
    field.type,
    ...field.options.map((o) => o.label.toLowerCase()),
  ].join("|");
  return createHash("sha256").update(normalized).digest("hex");
}

function selectValueForLabel(
  field: NormalizedField,
  answerLabel: string,
): { value: string; label: string } | null {
  const exact = field.options.find(
    (o) => o.label.trim().toLowerCase() === answerLabel.trim().toLowerCase(),
  );
  if (exact) return { value: exact.value, label: exact.label };
  return null;
}

export interface PlanAnswersOptions {
  job: NormalizedJob;
  profile: CandidateProfile;
  knowledgeBase?: string[];
  eeoDefaults?: EeoDefaults;
  /** When omitted, LLM-sourced fields are returned as needsReview. */
  llm?: LlmAnswerFn;
  cache?: AnswerCacheStore;
}

/**
 * Produce an answer for every field of the application form:
 *  - files            -> resume upload, handled at submission time
 *  - EEO/demographic  -> fixed defaults, never guessed
 *  - identity fields  -> deterministic from profile
 *  - everything else  -> LLM (with cache), constrained to options for selects
 * Anything unresolvable is flagged needsReview instead of being guessed.
 */
export async function planAnswers({
  job,
  profile,
  knowledgeBase = [],
  eeoDefaults = EEO_DEFAULTS,
  llm,
  cache,
}: PlanAnswersOptions): Promise<PlannedAnswer[]> {
  const planned: PlannedAnswer[] = [];

  for (const field of job.fields) {
    if (field.type === "file") {
      const isResume = /resume|cv\b/i.test(field.label);
      planned.push({
        field,
        source: "resume_file",
        value: isResume ? "[resume file]" : null,
        valueLabel: isResume ? "Attached resume" : null,
        // Non-resume files (e.g. required cover letter uploads) need the user.
        needsReview: !isResume && field.required,
      });
      continue;
    }

    if (field.answerSource === "eeo_default") {
      const answer = resolveEeoAnswer(field, eeoDefaults);
      planned.push({
        field,
        source: answer ? "eeo_default" : "unresolved",
        value: answer?.value ?? null,
        valueLabel: answer?.label ?? null,
        needsReview: !answer,
      });
      continue;
    }

    // Always try deterministic resolution first, regardless of how the field was
    // classified — free-text questions like "Who is your current employer?" are
    // classified as LLM but resolvable straight from the profile.
    if (field.options.length === 0) {
      const value = resolveProfileAnswer(field, profile);
      if (value) {
        planned.push({ field, source: "profile", value, valueLabel: value, needsReview: false });
        continue;
      }
    }

    if (!llm) {
      planned.push({
        field,
        source: "unresolved",
        value: null,
        valueLabel: null,
        needsReview: true,
      });
      continue;
    }

    const hash = questionHash(field);
    let answerText = cache ? await cache.get(hash) : null;
    const fromCache = answerText != null;
    if (answerText == null) {
      answerText = await llm({
        label: field.label,
        type: field.type,
        optionLabels: field.options.length > 0 ? field.options.map((o) => o.label) : undefined,
        jobTitle: job.title,
        companyName: job.companyName,
        jobDescription: job.descriptionText,
        profile,
        knowledgeBase,
      });
      if (cache) await cache.set(hash, field.label, answerText);
    }

    if (field.options.length > 0) {
      const resolved = selectValueForLabel(field, answerText);
      planned.push({
        field,
        source: resolved ? "llm" : "unresolved",
        value: resolved?.value ?? null,
        valueLabel: resolved?.label ?? answerText,
        needsReview: !resolved,
        fromCache,
      });
    } else {
      planned.push({
        field,
        source: "llm",
        value: answerText,
        valueLabel: answerText,
        needsReview: false,
        fromCache,
      });
    }
  }

  return planned;
}
