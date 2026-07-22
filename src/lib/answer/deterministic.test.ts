import { describe, expect, it } from "vitest";
import type { CandidateProfile } from "../profile/types";
import {
  isUnknownOrHedgeAnswer,
  normalizeDateAnswer,
  resolveDeterministicAnswer,
  resolveProfileAnswer,
  resolveWorkAuthAnswer,
} from "./deterministic";

const profile: CandidateProfile = {
  firstName: "Shubham",
  lastName: "Patel",
  email: "shubham@example.com",
  phone: "+1 555 010 2030",
  location: "Austin, TX",
  links: {
    linkedin: "https://linkedin.com/in/shubham",
    github: "https://github.com/shubham",
    portfolio: "https://shubham.dev",
    other: [],
  },
  workAuthorization: {
    authorizedToWorkInUS: true,
    requiresSponsorship: true,
    visaStatus: "F-1 OPT",
  },
  availableFrom: "2026-08-01",
  salaryExpectation: "$120,000",
  summary: null,
  skills: ["TypeScript"],
  workHistory: [
    {
      company: "Acme Corp",
      title: "Software Engineer",
      startDate: "2024-01",
      endDate: null,
      location: null,
      description: null,
    },
    {
      company: "OldCo",
      title: "Intern",
      startDate: "2023-05",
      endDate: "2023-08",
      location: null,
      description: null,
    },
  ],
  education: [],
};

function resolve(label: string, id = "x", type: "text" | "email" | "phone" = "text") {
  return resolveProfileAnswer({ id, label, type }, profile);
}

describe("resolveProfileAnswer", () => {
  it("resolves identity fields", () => {
    expect(resolve("First Name")).toBe("Shubham");
    expect(resolve("Last Name")).toBe("Patel");
    expect(resolve("Legal Name")).toBe("Shubham Patel");
    expect(resolve("Email")).toBe("shubham@example.com");
    expect(resolve("Phone Number")).toBe("+1 555 010 2030");
  });

  it("resolves via field id when label is uninformative (Lever/Greenhouse ids)", () => {
    expect(resolveProfileAnswer({ id: "first_name", label: "?", type: "text" }, profile)).toBe(
      "Shubham",
    );
  });

  it("resolves links", () => {
    expect(resolve("LinkedIn Profile")).toBe("https://linkedin.com/in/shubham");
    expect(resolve("GitHub URL")).toBe("https://github.com/shubham");
    expect(resolve("Portfolio")).toBe("https://shubham.dev");
  });

  it("resolves current employer and title from most recent work history", () => {
    expect(resolve("Who is your current or previous employer?")).toBe("Acme Corp");
    expect(resolve("What is your current or previous job title?")).toBe("Software Engineer");
  });

  it("resolves location, salary, and availability", () => {
    expect(resolve("Where are you currently located?")).toBe("Austin, TX");
    expect(resolve("Salary expectations")).toBe("$120,000");
    expect(resolve("When can you start?")).toBe("2026-08-01");
    expect(resolve("Availability")).toBe("2026-08-01");
  });

  it("returns null for open-ended questions (LLM territory)", () => {
    expect(resolve("Why do you want to work here?")).toBeNull();
    expect(resolve("How did you hear about us?")).toBeNull();
  });

  it("returns null when the profile lacks the value", () => {
    const noPhone = { ...profile, phone: null };
    expect(resolveProfileAnswer({ id: "phone", label: "Phone", type: "phone" }, noPhone)).toBeNull();
  });
});

describe("resolveWorkAuthAnswer", () => {
  it("maps authorized-to-work and sponsorship to Yes/No options", () => {
    const options = [
      { label: "Yes", value: "1" },
      { label: "No", value: "0" },
    ];
    expect(
      resolveWorkAuthAnswer(
        { id: "auth", label: "Are you authorized to work in the United States?", type: "select", options },
        profile,
      ),
    ).toEqual({ value: "1", label: "Yes" });

    expect(
      resolveWorkAuthAnswer(
        {
          id: "sponsor",
          label: "Will you now or in the future require visa sponsorship?",
          type: "select",
          options,
        },
        profile,
      ),
    ).toEqual({ value: "1", label: "Yes" });
  });

  it("maps Ashby boolean widgets without options", () => {
    expect(
      resolveWorkAuthAnswer(
        { id: "auth", label: "Eligible to work in the U.S.?", type: "boolean", options: [] },
        profile,
      ),
    ).toEqual({ value: "true", label: "Yes" });
  });
});

describe("resolveDeterministicAnswer", () => {
  it("prefers work-auth over free-text for Yes/No selects", () => {
    const result = resolveDeterministicAnswer(
      {
        id: "q",
        label: "Are you legally authorized to work in the United States?",
        type: "select",
        options: [
          { label: "Yes", value: "yes" },
          { label: "No", value: "no" },
        ],
      },
      profile,
    );
    expect(result).toEqual({ value: "yes", label: "Yes" });
  });
});

describe("isUnknownOrHedgeAnswer", () => {
  it("flags LLM hedges and UNKNOWN tokens", () => {
    expect(isUnknownOrHedgeAnswer("UNKNOWN")).toBe(true);
    expect(isUnknownOrHedgeAnswer("not mentioned in the profile")).toBe(true);
    expect(isUnknownOrHedgeAnswer("Availability is not mentioned in the profile")).toBe(true);
    expect(isUnknownOrHedgeAnswer("I don't have that information in my profile")).toBe(true);
    expect(isUnknownOrHedgeAnswer("Two weeks notice")).toBe(false);
    expect(isUnknownOrHedgeAnswer("Yes")).toBe(false);
  });
});

describe("normalizeDateAnswer", () => {
  it("normalizes common date formats to YYYY-MM-DD", () => {
    expect(normalizeDateAnswer("2026-08-01")).toBe("2026-08-01");
    expect(normalizeDateAnswer("8/1/2026")).toBe("2026-08-01");
    expect(normalizeDateAnswer("August 2026")).toBe("2026-08-01");
    expect(normalizeDateAnswer("two weeks")).toBeNull();
  });
});
