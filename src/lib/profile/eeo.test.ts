import { describe, expect, it } from "vitest";
import { resolveEeoAnswer } from "./eeo";

// Real option sets as returned by Greenhouse's EEOC compliance questions.
const GENDER_OPTIONS = [
  { label: "Male", value: "1" },
  { label: "Female", value: "2" },
  { label: "Decline To Self Identify", value: "3" },
];

const HISPANIC_OPTIONS = [
  { label: "Yes", value: "1" },
  { label: "No", value: "2" },
  { label: "Decline To Self Identify", value: "3" },
];

const RACE_OPTIONS = [
  { label: "American Indian or Alaskan Native", value: "1" },
  { label: "Asian", value: "2" },
  { label: "Black or African American", value: "3" },
  { label: "Hispanic or Latino", value: "4" },
  { label: "White", value: "5" },
  { label: "Native Hawaiian or Other Pacific Islander", value: "6" },
  { label: "Two or More Races", value: "7" },
  { label: "Decline To Self Identify", value: "8" },
];

const RACE_COMBINED_OPTIONS = [
  { label: "Hispanic or Latino", value: "1" },
  { label: "White (Not Hispanic or Latino)", value: "2" },
  { label: "Asian (Not Hispanic or Latino)", value: "3" },
  { label: "Black or African American (Not Hispanic or Latino)", value: "4" },
];

const VETERAN_OPTIONS = [
  { label: "I am not a protected veteran", value: "1" },
  {
    label:
      "I identify as one or more of the classifications of a protected veteran",
    value: "2",
  },
  { label: "I don't wish to answer", value: "3" },
];

const DISABILITY_OPTIONS = [
  { label: "Yes, I have a disability, or have had one in the past", value: "1" },
  {
    label: "No, I do not have a disability and have not had one in the past",
    value: "2",
  },
  { label: "I do not want to answer", value: "3" },
];

describe("resolveEeoAnswer", () => {
  it("answers gender = Male", () => {
    const answer = resolveEeoAnswer({
      label: "Gender",
      type: "select",
      options: GENDER_OPTIONS,
    });
    expect(answer?.label).toBe("Male");
  });

  it("answers Hispanic/Latino = No", () => {
    const answer = resolveEeoAnswer({
      label: "Are you Hispanic/Latino?",
      type: "select",
      options: HISPANIC_OPTIONS,
    });
    expect(answer?.label).toBe("No");
  });

  it("answers race = Asian", () => {
    const answer = resolveEeoAnswer({
      label: "Please identify your race",
      type: "select",
      options: RACE_OPTIONS,
    });
    expect(answer?.label).toBe("Asian");
  });

  it("prefers combined 'Asian (Not Hispanic or Latino)' option", () => {
    const answer = resolveEeoAnswer({
      label: "Race/Ethnicity",
      type: "select",
      options: RACE_COMBINED_OPTIONS,
    });
    expect(answer?.label).toBe("Asian (Not Hispanic or Latino)");
  });

  it("answers veteran = not a protected veteran", () => {
    const answer = resolveEeoAnswer({
      label: "Veteran Status",
      type: "select",
      options: VETERAN_OPTIONS,
    });
    expect(answer?.label).toBe("I am not a protected veteran");
  });

  it("answers disability = no", () => {
    const answer = resolveEeoAnswer({
      label: "Disability Status",
      type: "select",
      options: DISABILITY_OPTIONS,
    });
    expect(answer?.label).toBe(
      "No, I do not have a disability and have not had one in the past",
    );
  });

  it("answers yes/no veteran question without options", () => {
    const answer = resolveEeoAnswer({
      label: "Are you a veteran?",
      type: "boolean",
      options: [],
    });
    expect(answer?.label).toBe("No");
  });

  it("returns null for non-EEO questions", () => {
    const answer = resolveEeoAnswer({
      label: "Why do you want to work here?",
      type: "textarea",
      options: [],
    });
    expect(answer).toBeNull();
  });

  it("returns null when no option matches (surface for manual review)", () => {
    const answer = resolveEeoAnswer({
      label: "Gender",
      type: "select",
      options: [{ label: "Prefer not to say", value: "1" }],
    });
    expect(answer).toBeNull();
  });
});
