/**
 * Pure text-matching helpers for picking the right widget option (dropdown
 * suggestions, radio labels, select options) for an intended answer.
 *
 * Deterministic on purpose: rendered options are matched against the planned
 * answer by normalized-token scoring, so "New York, NY" reliably picks
 * "New York, New York, United States" from a location typeahead without any
 * platform-specific logic.
 */

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function textTokens(s: string): string[] {
  const n = normalizeText(s);
  return n === "" ? [] : n.split(" ");
}

/**
 * Similarity score in [0, 1] between the intended answer and one rendered option.
 * 1 = normalized-exact; prefix/containment and token overlap give partial credit.
 */
export function scoreOption(want: string, option: string): number {
  const w = normalizeText(want);
  const o = normalizeText(option);
  if (!w || !o) return 0;
  if (w === o) return 1;

  const wTokens = new Set(w.split(" "));
  const oTokens = new Set(o.split(" "));
  let common = 0;
  for (const t of wTokens) if (oTokens.has(t)) common++;
  // Coverage (how much of the wanted text the option contains) matters more than
  // precision (extra words in the option, e.g. ", United States" suffixes).
  const coverage = common / wTokens.size;
  const precision = common / oTokens.size;
  let score = coverage * 0.75 + precision * 0.25;

  // Whole-token prefix/containment boosts ("male" must not match inside "female").
  const oPad = ` ${o} `;
  const wPad = ` ${w} `;
  if (oPad.startsWith(`${wPad.trimEnd()} `) || wPad.startsWith(`${oPad.trimEnd()} `)) {
    score = Math.max(score, 0.85);
  } else if (oPad.includes(wPad) || wPad.includes(oPad)) {
    score = Math.max(score, 0.75);
  }
  return score;
}

export interface OptionMatch {
  index: number;
  score: number;
}

/** Best-scoring option for the wanted text; ties keep the earliest option. */
export function bestOption(want: string, options: string[]): OptionMatch | null {
  let index = -1;
  let best = 0;
  options.forEach((opt, i) => {
    const s = scoreOption(want, opt);
    if (s > best) {
      best = s;
      index = i;
    }
  });
  return index >= 0 ? { index, score: best } : null;
}

/**
 * Score threshold above which a match is trusted without asking for help.
 * Below it the engine consults the optional LLM option-chooser (if provided)
 * before giving up.
 */
export const CONFIDENT_MATCH = 0.6;

/** True when `haystack` loosely contains `needle` (>= 60% of its tokens). */
export function looselyContains(haystack: string, needle: string): boolean {
  const h = normalizeText(haystack);
  const n = normalizeText(needle);
  if (!h || !n) return false;
  if (h.includes(n)) return true;
  const nTokens = textTokens(needle);
  if (nTokens.length === 0) return false;
  const hTokens = new Set(textTokens(haystack));
  const present = nTokens.filter((t) => hTokens.has(t)).length;
  return present / nTokens.length >= 0.6;
}
