import type { FieldOption, NormalizedField } from "../ats/types";

/**
 * The user's fixed EEO / demographic answers, mapped deterministically — the LLM is
 * never allowed to guess these.
 */
export interface EeoDefaults {
  gender: "male" | "female" | "decline";
  hispanicOrLatino: boolean;
  race: "asian";
  protectedVeteran: boolean;
  disability: boolean;
}

export const EEO_DEFAULTS: EeoDefaults = {
  gender: "male",
  hispanicOrLatino: false,
  race: "asian",
  protectedVeteran: false,
  disability: false,
};

type Topic = "gender" | "hispanic" | "race" | "veteran" | "disability";

function detectTopic(label: string): Topic | null {
  const l = label.toLowerCase();
  // Hispanic/Latino check must run before the generic race/ethnicity check, since
  // its label usually contains "ethnicity" too.
  if (/hispanic|latino|latinx/.test(l)) return "hispanic";
  if (/veteran/.test(l)) return "veteran";
  if (/disabilit/.test(l)) return "disability";
  if (/\bgender\b|\bsex\b/.test(l)) return "gender";
  if (/race|ethnicit/.test(l)) return "race";
  return null;
}

function pickOption(
  options: FieldOption[],
  patterns: RegExp[],
): FieldOption | null {
  for (const pattern of patterns) {
    const hit = options.find((o) => pattern.test(o.label));
    if (hit) return hit;
  }
  return null;
}

/**
 * Resolve the answer for an EEO/demographic select field from the fixed defaults.
 * Returns the matching option, or null if the field is not an EEO topic / no option
 * matches (caller should surface it for manual review, never guess).
 */
export function resolveEeoAnswer(
  field: Pick<NormalizedField, "label" | "options" | "type">,
  defaults: EeoDefaults = EEO_DEFAULTS,
): FieldOption | null {
  const topic = detectTopic(field.label);
  if (!topic) return null;

  if (field.type === "boolean" || field.options.length === 0) {
    // Yes/No style question without option list (e.g. Ashby Boolean fields).
    const yes = { label: "Yes", value: "true" };
    const no = { label: "No", value: "false" };
    switch (topic) {
      case "hispanic":
        return defaults.hispanicOrLatino ? yes : no;
      case "veteran":
        return defaults.protectedVeteran ? yes : no;
      case "disability":
        return defaults.disability ? yes : no;
      default:
        return null;
    }
  }

  switch (topic) {
    case "gender":
      return pickOption(
        field.options,
        defaults.gender === "male"
          ? [/^male$/i, /^man$/i, /\bmale\b/i]
          : [/^female$/i, /^woman$/i, /\bfemale\b/i],
      );

    case "hispanic":
      return pickOption(
        field.options,
        defaults.hispanicOrLatino ? [/^yes/i] : [/^no\b/i, /not hispanic/i],
      );

    case "race":
      return pickOption(field.options, [
        // Prefer combined race+ethnicity option when present.
        /asian \(not hispanic or latino\)/i,
        /^asian$/i,
        /\basian\b/i,
      ]);

    case "veteran":
      if (defaults.protectedVeteran) {
        return pickOption(field.options, [/identify as .*protected veteran/i, /^yes/i]);
      }
      return pickOption(field.options, [
        /not a protected veteran/i,
        /no.*not.*veteran/i,
        /^no\b/i,
      ]);

    case "disability":
      if (defaults.disability) {
        return pickOption(field.options, [/^yes/i]);
      }
      return pickOption(field.options, [
        /no,? i (?:do not|don'?t) have a disability/i,
        /^no\b/i,
      ]);
  }
}
