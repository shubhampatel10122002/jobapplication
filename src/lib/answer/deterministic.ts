import type { FieldOption, NormalizedField } from "../ats/types";
import type { CandidateProfile } from "../profile/types";

function currentJob(profile: CandidateProfile) {
  return profile.workHistory[0] ?? null;
}

type Resolver = {
  match: RegExp;
  resolve: (p: CandidateProfile) => string | null | undefined;
};

/** Ordered — first matching resolver wins, so more specific patterns come first. */
const RESOLVERS: Resolver[] = [
  { match: /first name/i, resolve: (p) => p.firstName },
  { match: /last name|family name|surname/i, resolve: (p) => p.lastName },
  {
    match: /full name|legal name|^name$|your name/i,
    resolve: (p) => [p.firstName, p.lastName].filter(Boolean).join(" ") || null,
  },
  { match: /e-?mail/i, resolve: (p) => p.email },
  { match: /phone|mobile/i, resolve: (p) => p.phone },
  { match: /linkedin/i, resolve: (p) => p.links.linkedin },
  { match: /github/i, resolve: (p) => p.links.github },
  { match: /portfolio|personal (web)?site|website/i, resolve: (p) => p.links.portfolio },
  {
    match: /current (or previous |or most recent )?(company|employer)|current org/i,
    resolve: (p) => currentJob(p)?.company,
  },
  {
    match: /current (or previous |or most recent )?(job )?title|current role/i,
    resolve: (p) => currentJob(p)?.title,
  },
  {
    match:
      /where (are you|do you) (currently )?(located|reside|live|based)|current location|^location$|city of residence/i,
    resolve: (p) => p.location,
  },
  {
    match: /salary|compensation expectation|expected (pay|salary)/i,
    resolve: (p) => p.salaryExpectation,
  },
  {
    match:
      /\b(availab(le|ility)|earliest start|start date|when can you (start|begin)|available to start|notice period)\b/i,
    resolve: (p) => p.availableFrom,
  },
];

const SPONSORSHIP =
  /\b(sponsor|sponsorship|visa support|require.{0,20}visa|immigration sponsorship|will you need.{0,30}sponsor)\b/i;
const WORK_AUTH =
  /\b(authoriz(ed|ation) to work|eligible to work|legally (authorized|permitted|entitled) to work|right to work|work authorization|legally work)\b/i;

function pickYesNo(
  field: Pick<NormalizedField, "options" | "type">,
  yes: boolean,
): { value: string; label: string } {
  const want = yes ? "yes" : "no";
  if (field.options.length > 0) {
    const match = field.options.find((o) => o.label.trim().toLowerCase().startsWith(want));
    if (match) return { value: match.value, label: match.label };
    // Fall back to any option whose value encodes yes/no.
    const byValue = field.options.find((o) => o.value.trim().toLowerCase().startsWith(want));
    if (byValue) return { value: byValue.value, label: byValue.label };
  }
  const label = yes ? "Yes" : "No";
  // Boolean widgets (Ashby) submit Yes/No labels; Greenhouse selects use option values.
  return { value: field.type === "boolean" ? (yes ? "true" : "false") : label, label };
}

/**
 * Work-auth / sponsorship Yes–No from the profile checkboxes — never LLM.
 * Returns null when the question is not about work authorization.
 */
export function resolveWorkAuthAnswer(
  field: Pick<NormalizedField, "id" | "label" | "type" | "options">,
  profile: CandidateProfile,
): { value: string; label: string } | null {
  const haystack = `${field.label} ${field.id.replace(/_/g, " ")}`;
  if (SPONSORSHIP.test(haystack)) {
    return pickYesNo(field, profile.workAuthorization.requiresSponsorship);
  }
  if (WORK_AUTH.test(haystack)) {
    return pickYesNo(field, profile.workAuthorization.authorizedToWorkInUS);
  }
  return null;
}

/**
 * Resolve standard identity / availability fields from the profile — no LLM.
 * Returns null when the field is not deterministically resolvable.
 */
export function resolveProfileAnswer(
  field: Pick<NormalizedField, "id" | "label" | "type">,
  profile: CandidateProfile,
): string | null {
  const haystacks = [field.label, field.id.replace(/_/g, " ")];
  for (const { match, resolve } of RESOLVERS) {
    if (haystacks.some((h) => match.test(h))) {
      const value = resolve(profile);
      if (value) return value;
      return null;
    }
  }
  return null;
}

/**
 * Full deterministic resolution including Yes/No option matching.
 * Prefer this in the answer engine when options may be present.
 */
export function resolveDeterministicAnswer(
  field: Pick<NormalizedField, "id" | "label" | "type" | "options">,
  profile: CandidateProfile,
): { value: string; label: string } | null {
  const workAuth = resolveWorkAuthAnswer(field, profile);
  if (workAuth) return workAuth;

  if (field.options.length > 0) {
    // Only identity-style free text maps without options; selects need an option match.
    // Availability questions with date options are rare — leave those to LLM/review.
    return null;
  }

  const text = resolveProfileAnswer(field, profile);
  if (!text) return null;
  return { value: text, label: text };
}

/** True when the LLM hedged / admitted the profile lacks the answer. */
export function isUnknownOrHedgeAnswer(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^(unknown|n\/?a|none|null|not (sure|applicable)|unspecified|\.?)$/i.test(t)) return true;
  if (
    /not (mentioned|specified|provided|stated|listed|found|available|included) (in |on |by )?(the )?(my )?(profile|resume|knowledge|cv)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(profile|resume|knowledge base)\b/i.test(t) &&
    /\b(does not|doesn't|do not|don't|no)\b.*\b(mention|include|contain|say|state|provide)\b/i.test(t)
  ) {
    return true;
  }
  if (/^i (do not|don't) (have|know)\b/i.test(t) && /\b(profile|resume|information)\b/i.test(t)) {
    return true;
  }
  return false;
}

/** Normalize a free-text date answer to YYYY-MM-DD when possible. */
export function normalizeDateAnswer(text: string): string | null {
  const t = text.trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return t;
  const us = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (us) {
    const [, m, d, y] = us;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // "Month Year" → first of that month
  const monthYear = t.match(
    /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})$/i,
  );
  if (monthYear) {
    const months: Record<string, string> = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12",
    };
    const key = monthYear[1].slice(0, 3).toLowerCase();
    return `${monthYear[2]}-${months[key]}-01`;
  }
  return null;
}

export function matchYesNoOption(
  options: FieldOption[],
  answer: string,
): { value: string; label: string } | null {
  const want = /^y/i.test(answer.trim()) ? "yes" : /^n/i.test(answer.trim()) ? "no" : null;
  if (!want) return null;
  const match = options.find((o) => o.label.trim().toLowerCase().startsWith(want));
  if (match) return { value: match.value, label: match.label };
  return null;
}
