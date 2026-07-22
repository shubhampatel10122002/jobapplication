import { describe, expect, it } from "vitest";
import type { CandidateProfile } from "../profile/types";
import { resolveProfileAnswer } from "./deterministic";

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
  salaryExpectation: "$120,000",
  summary: null,
  skills: ["TypeScript"],
  workHistory: [
    { company: "Acme Corp", title: "Software Engineer", startDate: "2024-01", endDate: null },
    { company: "OldCo", title: "Intern", startDate: "2023-05", endDate: "2023-08" },
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

  it("resolves location and salary", () => {
    expect(resolve("Where are you currently located?")).toBe("Austin, TX");
    expect(resolve("Salary expectations")).toBe("$120,000");
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
