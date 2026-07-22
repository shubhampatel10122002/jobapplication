import { describe, expect, it } from "vitest";
import { checkEligibility } from "./filter";

function verdictOf(text: string) {
  return checkEligibility(text).verdict;
}

describe("checkEligibility — skip cases", () => {
  const skipTexts: [string, string][] = [
    ["no visa sponsorship", "Please note: no visa sponsorship is available for this position."],
    ["unable to sponsor", "We are unable to sponsor visas at this time."],
    ["cannot sponsor", "Candidates must be authorized to work in the US as we cannot sponsor employment visas."],
    ["will not sponsor", "The company will not sponsor applicants for work visas."],
    ["does not sponsor", "Acme does not sponsor employment visas."],
    ["sponsorship not available", "Visa sponsorship is not available for this role."],
    ["sponsorship unavailable", "Sponsorship is unavailable."],
    [
      "must not require sponsorship now or in the future",
      "Applicants must not require sponsorship for employment now or in the future.",
    ],
    [
      "not require sponsorship now or in the future",
      "You must be authorized to work in the U.S. and not require visa sponsorship now or in the future.",
    ],
    ["US citizens only", "This role is open only to U.S. citizens."],
    ["must be a US citizen", "Applicants must be a United States citizen due to contract requirements."],
    ["citizenship required", "U.S. citizenship is required for this position."],
    ["green card only", "Only U.S. citizens and green card holders will be considered."],
    ["active secret clearance", "Must possess an active Secret clearance."],
    ["ts/sci", "This position requires TS/SCI eligibility."],
    ["top secret required", "Top Secret clearance is required."],
    ["ability to obtain clearance", "Ability to obtain a U.S. government security clearance is necessary."],
    ["ITAR", "Due to ITAR regulations, all candidates must be U.S. persons."],
    ["us persons", "To comply with export control laws, you must be a U.S. Person (citizen or permanent resident)."],
    ["OPT not eligible", "We cannot accept candidates on OPT or CPT for this role."],
    ["F-1 excluded", "F-1 visa holders are not eligible for this position."],
  ];

  it.each(skipTexts)("skips: %s", (_name, text) => {
    const result = checkEligibility(text);
    expect(result.verdict).toBe("skip");
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].excerpt.length).toBeGreaterThan(0);
  });
});

describe("checkEligibility — apply cases", () => {
  const applyTexts: [string, string][] = [
    ["silent on sponsorship", "We are looking for a software engineer with 3+ years of React experience."],
    [
      "only requires current work authorization",
      "Applicants must be authorized to work in the United States.",
    ],
    ["company sponsors visas", "We are happy to sponsor visas for exceptional candidates."],
    ["sponsorship available", "Visa sponsorship is available for this position."],
    ["offers sponsorship", "Acme offers visa sponsorship and relocation support."],
    ["supports H1B transfer", "We support H-1B sponsorship and transfers."],
    ["clearance preferred only", "An active security clearance is a plus but not required."],
    ["clearance nice to have", "Security clearance preferred."],
    [
      "sponsor mentioned as event sponsor",
      "Our company is a proud sponsor of the annual tech conference.",
    ],
  ];

  it.each(applyTexts)("applies: %s", (_name, text) => {
    const result = checkEligibility(text);
    expect(result.verdict).toBe("apply");
  });
});

describe("checkEligibility — realistic descriptions", () => {
  it("skips a realistic defense job", () => {
    const jd = `About the role:
We build satellite systems for national security customers.
Requirements:
- 5+ years of embedded C++ experience
- Must be able to obtain and maintain a Top Secret security clearance
- This position requires access to information controlled under ITAR`;
    const result = checkEligibility(jd);
    expect(result.verdict).toBe("skip");
    const categories = result.matches.map((m) => m.category);
    expect(categories).toContain("security_clearance");
    expect(categories).toContain("itar_us_persons");
  });

  it("applies to a realistic startup job silent on sponsorship", () => {
    const jd = `We're hiring a full-stack engineer to join our growing team.
You'll work with TypeScript, React and PostgreSQL.
We offer competitive salary, equity, and health benefits.
Applicants must be authorized to work in the United States.`;
    expect(verdictOf(jd)).toBe("apply");
  });
});
