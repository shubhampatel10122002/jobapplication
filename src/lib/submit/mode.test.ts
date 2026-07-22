import { afterEach, describe, expect, it } from "vitest";
import { isDryRun, isLiveSubmit } from "./mode";

describe("submit mode", () => {
  const keys = ["DRY_RUN", "AUTO_SUBMIT"] as const;
  const previous = new Map<string, string | undefined>();

  afterEach(() => {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previous.clear();
  });

  function setEnv(partial: Partial<Record<(typeof keys)[number], string | undefined>>) {
    for (const key of keys) {
      if (!previous.has(key)) previous.set(key, process.env[key]);
      const value = partial[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  it("defaults to live submit", () => {
    setEnv({ DRY_RUN: undefined, AUTO_SUBMIT: undefined });
    expect(isDryRun()).toBe(false);
    expect(isLiveSubmit()).toBe(true);
  });

  it("DRY_RUN=1 enables dry-run", () => {
    setEnv({ DRY_RUN: "1", AUTO_SUBMIT: undefined });
    expect(isDryRun()).toBe(true);
    expect(isLiveSubmit()).toBe(false);
  });

  it("AUTO_SUBMIT=0 enables dry-run for backwards compatibility", () => {
    setEnv({ DRY_RUN: undefined, AUTO_SUBMIT: "0" });
    expect(isDryRun()).toBe(true);
  });

  it("AUTO_SUBMIT=1 stays live", () => {
    setEnv({ DRY_RUN: undefined, AUTO_SUBMIT: "1" });
    expect(isDryRun()).toBe(false);
    expect(isLiveSubmit()).toBe(true);
  });
});
