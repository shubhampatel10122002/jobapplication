import type { AnswerSource, NormalizedField } from "./types";

const EEO_TOPIC =
  /\b(gender|sex\b|hispanic|latino|latinx|race|ethnicit|veteran|disabilit|lgbtq|sexual orientation|transgender|pronoun)/i;

const PROFILE_TOPIC =
  /\b(first name|last name|full name|legal name|preferred name|email|phone|resume|cv\b|cover letter|linkedin|github|portfolio|website|location|city|address|current company|current employer|how did you hear)/i;

/**
 * Decide how a field's answer will be produced. Standard identity fields come from the
 * profile, EEO/demographic questions from fixed defaults, everything else from the LLM.
 */
export function classifyAnswerSource(
  label: string,
  section: NormalizedField["section"],
): AnswerSource {
  if (section === "eeoc" || section === "demographic" || EEO_TOPIC.test(label)) {
    return "eeo_default";
  }
  if (section === "standard" || PROFILE_TOPIC.test(label)) {
    return "profile";
  }
  return "llm";
}
