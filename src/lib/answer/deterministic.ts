import type { NormalizedField } from "../ats/types";
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
    match: /where (are you|do you) (currently )?(located|reside|live|based)|current location|^location$|city of residence/i,
    resolve: (p) => p.location,
  },
  { match: /salary|compensation expectation|expected (pay|salary)/i, resolve: (p) => p.salaryExpectation },
];

/**
 * Resolve standard identity fields directly from the profile — no LLM involved.
 * Returns null when the field is not deterministically resolvable (the answer
 * engine will fall back to the LLM or flag it for review).
 */
export function resolveProfileAnswer(
  field: Pick<NormalizedField, "id" | "label" | "type">,
  profile: CandidateProfile,
): string | null {
  // Label and id are tested separately so anchored patterns (^location$) work.
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
