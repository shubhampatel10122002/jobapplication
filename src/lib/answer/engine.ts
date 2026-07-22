import { createHash } from "node:crypto";
import type { NormalizedField, NormalizedJob } from "../ats/types";
import { resolveEeoAnswer, type EeoDefaults, EEO_DEFAULTS } from "../profile/eeo";
import type { CandidateProfile } from "../profile/types";
import {
  isUnknownOrHedgeAnswer,
  normalizeDateAnswer,
  resolveDeterministicAnswer,
} from "./deterministic";

export interface LlmQuestion {
  label: string;
  type: NormalizedField["type"];
  /** For select / boolean questions: the option labels the answer MUST be one of. */
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
  // Bump prefix when answer semantics change so stale LLM hedges are not reused.
  const normalized = [
    "v2",
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
  // Yes/No soft match for boolean-like selects.
  const want = /^y/i.test(answerLabel.trim())
    ? "yes"
    : /^n/i.test(answerLabel.trim())
      ? "no"
      : null;
  if (want) {
    const soft = field.options.find((o) => o.label.trim().toLowerCase().startsWith(want));
    if (soft) return { value: soft.value, label: soft.label };
  }
  return null;
}

function effectiveOptionLabels(field: NormalizedField): string[] | undefined {
  if (field.options.length > 0) return field.options.map((o) => o.label);
  if (field.type === "boolean") return ["Yes", "No"];
  return undefined;
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
 *  - identity / work-auth / availability -> deterministic from profile
 *  - everything else  -> LLM (with cache), constrained to options for selects/booleans
 * Anything unresolvable or hedged is flagged needsReview instead of being guessed.
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

    // Work-auth Yes/No + identity fields — never invent via LLM.
    const deterministic = resolveDeterministicAnswer(field, profile);
    if (deterministic) {
      if (field.type === "date") {
        const normalized = normalizeDateAnswer(deterministic.value);
        planned.push({
          field,
          source: "profile",
          value: normalized ?? deterministic.value,
          valueLabel: normalized ?? deterministic.label,
          needsReview: !normalized,
        });
      } else {
        planned.push({
          field,
          source: "profile",
          value: deterministic.value,
          valueLabel: deterministic.label,
          needsReview: false,
        });
      }
      continue;
    }

    // Availability/date with no profile value → user must fill; do not ask the LLM to hedge.
    if (
      field.type === "date" ||
      /\b(availab(le|ility)|earliest start|start date|when can you (start|begin)|available to start)\b/i.test(
        field.label,
      )
    ) {
      if (!profile.availableFrom) {
        planned.push({
          field,
          source: "unresolved",
          value: null,
          valueLabel: null,
          needsReview: true,
        });
        continue;
      }
      const normalized =
        field.type === "date" ? normalizeDateAnswer(profile.availableFrom) : profile.availableFrom;
      planned.push({
        field,
        source: "profile",
        value: normalized ?? profile.availableFrom,
        valueLabel: normalized ?? profile.availableFrom,
        needsReview: field.type === "date" && !normalized,
      });
      continue;
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
        optionLabels: effectiveOptionLabels(field),
        jobTitle: job.title,
        companyName: job.companyName,
        jobDescription: job.descriptionText,
        profile,
        knowledgeBase,
      });
      if (cache) await cache.set(hash, field.label, answerText);
    }

    if (isUnknownOrHedgeAnswer(answerText)) {
      planned.push({
        field,
        source: "unresolved",
        value: null,
        valueLabel: null,
        needsReview: true,
        fromCache,
      });
      continue;
    }

    const optionLabels = effectiveOptionLabels(field);
    if (optionLabels) {
      const resolved =
        field.options.length > 0
          ? selectValueForLabel(field, answerText)
          : /^y/i.test(answerText.trim())
            ? { value: "true", label: "Yes" }
            : /^n/i.test(answerText.trim())
              ? { value: "false", label: "No" }
              : null;
      planned.push({
        field,
        source: resolved ? "llm" : "unresolved",
        value: resolved?.value ?? null,
        valueLabel: resolved?.label ?? null,
        needsReview: !resolved,
        fromCache,
      });
      continue;
    }

    if (field.type === "date") {
      const normalized = normalizeDateAnswer(answerText);
      planned.push({
        field,
        source: normalized ? "llm" : "unresolved",
        value: normalized,
        valueLabel: normalized,
        needsReview: !normalized,
        fromCache,
      });
      continue;
    }

    planned.push({
      field,
      source: "llm",
      value: answerText,
      valueLabel: answerText,
      needsReview: false,
      fromCache,
    });
  }

  return planned;
}
