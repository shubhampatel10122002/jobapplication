import { describe, expect, it } from "vitest";
import { bestOption, looselyContains, normalizeText, scoreOption } from "./match";

describe("normalizeText", () => {
  it("lowercases, strips punctuation and accents", () => {
    expect(normalizeText("  New York, NY!  ")).toBe("new york ny");
    expect(normalizeText("São Paulo")).toBe("sao paulo");
    expect(normalizeText("Yes — I do")).toBe("yes i do");
  });
});

describe("scoreOption", () => {
  it("scores exact matches 1", () => {
    expect(scoreOption("Yes", "yes")).toBe(1);
    expect(scoreOption("New York, NY", "new york ny")).toBe(1);
  });

  it("prefers the right geo suggestion for a location query", () => {
    const options = [
      "Newark, New Jersey, United States",
      "New York, New York, United States",
      "New York Mills, Minnesota, United States",
    ];
    const match = bestOption("New York, NY", options)!;
    expect(options[match.index]).toBe("New York, New York, United States");
  });

  it("scores prefix containment highly", () => {
    expect(scoreOption("New York", "New York, NY, USA")).toBeGreaterThanOrEqual(0.85);
  });

  it("gives 0 for unrelated options", () => {
    expect(scoreOption("Male", "Female")).toBeLessThan(0.5);
    expect(scoreOption("", "anything")).toBe(0);
  });
});

describe("bestOption", () => {
  it("returns the highest-scoring option", () => {
    const m = bestOption("Bachelor's Degree", ["High School", "Bachelor's", "Master's"])!;
    expect(m.index).toBe(1);
  });

  it("keeps the earliest option on ties (typeaheads rank best-first)", () => {
    const m = bestOption("Springfield", [
      "Springfield, Illinois, United States",
      "Springfield, Missouri, United States",
    ])!;
    expect(m.index).toBe(0);
  });

  it("does not confuse Yes/No", () => {
    expect(bestOption("Yes", ["Yes", "No"])!.index).toBe(0);
    expect(bestOption("No", ["Yes", "No"])!.index).toBe(1);
  });
});

describe("looselyContains", () => {
  it("matches direct substrings", () => {
    expect(looselyContains("Selected: New York, NY, USA", "New York, NY")).toBe(true);
  });
  it("matches when most tokens are present", () => {
    expect(looselyContains("New York, United States", "New York, NY")).toBe(true);
  });
  it("rejects unrelated text", () => {
    expect(looselyContains("San Francisco, CA", "New York, NY")).toBe(false);
  });
});
