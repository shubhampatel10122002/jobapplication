/**
 * Zero-cost eligibility filter, evaluated on the plain-text job description.
 *
 * Policy (per user requirements):
 *  - SKIP when the posting explicitly excludes sponsorship-needing candidates:
 *    "no visa sponsorship", "must not require sponsorship now or in the future",
 *    "U.S. citizens / green card holders only", excludes F-1/OPT/CPT, or requires a
 *    U.S. security clearance (Secret/Top Secret/TS-SCI) or ITAR "U.S. persons" status.
 *  - APPLY when the posting is silent on sponsorship or merely requires current U.S.
 *    work authorization.
 *
 * Deliberately regex-only (no LLM) so it costs nothing per job. It is tuned to
 * prefer false negatives (letting an ineligible job through) over false positives
 * (skipping a job the user could get), since the user reviews applications anyway.
 */

export type EligibilityCategory =
  | "no_sponsorship"
  | "citizenship_required"
  | "security_clearance"
  | "itar_us_persons"
  | "opt_cpt_excluded";

export interface EligibilityMatch {
  category: EligibilityCategory;
  /** The sentence from the job description that triggered the match. */
  excerpt: string;
}

export interface EligibilityResult {
  verdict: "apply" | "skip";
  matches: EligibilityMatch[];
}

const CITIZEN = String.raw`(?:u\.?s\.?|united states) citizen(?:s|ship)?`;

const RULES: { category: EligibilityCategory; pattern: RegExp }[] = [
  // --- Sponsorship explicitly unavailable / candidate must not need it ---
  {
    category: "no_sponsorship",
    pattern:
      /(?:unable|not able|cannot|can ?not|will not|won'?t|do(?:es)? not(?: currently)?|not in a position) to (?:offer|provide|support|consider)?\s*(?:visa\s+|employment\s+|immigration\s+|work\s+visa\s+)?sponsor/i,
  },
  {
    category: "no_sponsorship",
    pattern: /(?:unable|not able|cannot|can ?not|will not|won'?t|do(?:es)? not) sponsor/i,
  },
  {
    category: "no_sponsorship",
    pattern: /sponsorship (?:is |will )?(?:not|un)(?:\s*)(?:available|offered|provided|supported)/i,
  },
  { category: "no_sponsorship", pattern: /no (?:visa|immigration|work visa|employment visa) sponsorship/i },
  { category: "no_sponsorship", pattern: /\bno sponsorship\b/i },
  {
    category: "no_sponsorship",
    pattern: /(?:must|should) not (?:now or in the future )?require (?:visa |immigration )?sponsorship/i,
  },
  {
    category: "no_sponsorship",
    pattern: /not require (?:visa |immigration |work )?sponsorship,? (?:either )?(?:now[,]? or in the future|at any (?:point|time))/i,
  },
  {
    category: "no_sponsorship",
    pattern: /work authorization (?:that does not|which does not|without)[^.\n]{0,40}sponsor/i,
  },
  {
    category: "no_sponsorship",
    pattern: /authoriz(?:ed|ation) to work[^.\n]{0,60}without (?:the need for |requiring |need of )?(?:visa )?sponsorship/i,
  },

  // --- Citizenship / permanent residency required ---
  {
    category: "citizenship_required",
    pattern: new RegExp(`(?:must be|only|open only to|requires?)[^.\\n]{0,40}${CITIZEN}`, "i"),
  },
  {
    category: "citizenship_required",
    pattern: new RegExp(`${CITIZEN}[^.\\n]{0,30}(?:is |are )?(?:required|only)`, "i"),
  },
  {
    category: "citizenship_required",
    pattern: /green card holders? (?:only|required)|(?:only|must be)[^.\n]{0,40}green card holders?/i,
  },
  {
    category: "citizenship_required",
    pattern: /(?:citizens?|citizenship) or (?:lawful )?permanent residen(?:ts?|cy)[^.\n]{0,20}(?:only|required)/i,
  },

  // --- Security clearance / government eligibility ---
  {
    // Gap uses [^\n] (not [^.\n]) because "U.S." abbreviations contain periods.
    category: "security_clearance",
    pattern: /(?:active|current|possess(?:es)?|hold(?:s|ing)?|must (?:have|hold|obtain)|ability to obtain|able to obtain|eligib(?:le|ility) (?:for|to obtain))[^\n]{0,50}?(?:security clearance|(?:top )?secret clearance|ts\/?sci)/i,
  },
  { category: "security_clearance", pattern: /\bts\/sci\b/i },
  {
    category: "security_clearance",
    pattern: /(?:top secret|secret|public trust) (?:security )?clearance (?:is )?(?:required|needed)/i,
  },
  {
    category: "security_clearance",
    pattern: /security clearance[^.\n]{0,30}(?:required|mandatory)/i,
  },

  // --- ITAR / EAR "U.S. persons" requirement ---
  {
    category: "itar_us_persons",
    pattern: /\bitar\b|international traffic in arms/i,
  },
  {
    category: "itar_us_persons",
    pattern: /(?:must be|required to be)[^.\n]{0,30}u\.?s\.? person/i,
  },

  // --- F-1 / OPT / CPT explicitly excluded ---
  {
    category: "opt_cpt_excluded",
    pattern: /(?:no|not eligible for|cannot (?:support|accept)|unable to (?:support|accept)|do(?:es)? not (?:support|accept))[^.\n]{0,40}\b(?:opt|cpt|f-?1|stem[- ]opt)\b/i,
  },
  {
    category: "opt_cpt_excluded",
    pattern: /\b(?:opt|cpt|f-?1)\b[^.\n]{0,40}(?:not eligible|ineligible|not accepted|cannot be considered)/i,
  },
];

/** Phrases that mention clearance but do not make it a hard requirement. */
const CLEARANCE_SOFTENERS =
  /(?:preferred|a plus|plus but|nice to have|not required|desirable|bonus)/i;

/**
 * Phrases that indicate the company DOES sponsor — used to suppress false positives
 * like "we are happy to sponsor visas".
 */
const POSITIVE_SPONSORSHIP =
  /(?:we (?:do|can|are able to|are happy to|will) sponsor|sponsorship (?:is )?available|offers? (?:visa )?sponsorship|provide (?:visa )?sponsorship|support (?:visa|h-?1b) (?:sponsorship|transfer))/i;

/** If the sentence contains any of these, it is not a positive sponsorship statement. */
const NEGATION = /\b(?:no|not|nor|never|unable|cannot|can ?not|won'?t|unavailable)\b/i;

function sentenceAround(text: string, index: number): string {
  const start = Math.max(
    text.lastIndexOf(".", index),
    text.lastIndexOf("\n", index),
    0,
  );
  let end = text.length;
  for (const stop of [".", "\n"]) {
    const i = text.indexOf(stop, index);
    if (i !== -1 && i < end) end = i + (stop === "." ? 1 : 0);
  }
  return text.slice(start === 0 ? 0 : start + 1, end).trim();
}

export function checkEligibility(descriptionText: string): EligibilityResult {
  const matches: EligibilityMatch[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    const m = rule.pattern.exec(descriptionText);
    if (!m) continue;
    const excerpt = sentenceAround(descriptionText, m.index);

    if (
      rule.category === "no_sponsorship" &&
      POSITIVE_SPONSORSHIP.test(excerpt) &&
      !NEGATION.test(excerpt)
    ) {
      continue;
    }
    if (rule.category === "security_clearance" && CLEARANCE_SOFTENERS.test(excerpt)) {
      continue;
    }

    const key = `${rule.category}:${excerpt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({ category: rule.category, excerpt });
  }

  return { verdict: matches.length > 0 ? "skip" : "apply", matches };
}
