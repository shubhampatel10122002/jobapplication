import { describe, expect, it } from "vitest";
import { detectJob } from "./detect";

describe("detectJob", () => {
  it("detects Greenhouse board URLs", () => {
    expect(detectJob("https://boards.greenhouse.io/stripe/jobs/7954688")).toEqual({
      ats: "greenhouse",
      company: "stripe",
      jobId: "7954688",
      url: "https://boards.greenhouse.io/stripe/jobs/7954688",
    });
  });

  it("detects new job-boards.greenhouse.io URLs", () => {
    const ref = detectJob("https://job-boards.greenhouse.io/datadog/jobs/1234?tid=x");
    expect(ref?.ats).toBe("greenhouse");
    expect(ref?.company).toBe("datadog");
    expect(ref?.jobId).toBe("1234");
  });

  it("detects Greenhouse embed URLs", () => {
    const ref = detectJob(
      "https://boards.greenhouse.io/embed/job_app?for=acme&token=999",
    );
    expect(ref?.ats).toBe("greenhouse");
    expect(ref?.company).toBe("acme");
    expect(ref?.jobId).toBe("999");
  });

  it("detects Lever URLs with and without /apply", () => {
    const uuid = "c1f7563a-95b8-4d8c-a2f1-1c5e7d1e6a10";
    for (const url of [
      `https://jobs.lever.co/acme/${uuid}`,
      `https://jobs.lever.co/acme/${uuid}/apply`,
    ]) {
      const ref = detectJob(url);
      expect(ref?.ats).toBe("lever");
      expect(ref?.company).toBe("acme");
      expect(ref?.jobId).toBe(uuid);
    }
  });

  it("detects Ashby URLs", () => {
    const ref = detectJob(
      "https://jobs.ashbyhq.com/openai/8fb1615c-34bf-47c4-a1d1-b7b2f836bbd3",
    );
    expect(ref?.ats).toBe("ashby");
    expect(ref?.company).toBe("openai");
    expect(ref?.jobId).toBe("8fb1615c-34bf-47c4-a1d1-b7b2f836bbd3");
  });

  it("returns null for unsupported URLs", () => {
    expect(detectJob("https://example.com/careers/123")).toBeNull();
    expect(detectJob("not a url")).toBeNull();
    expect(detectJob("https://boards.greenhouse.io/acme")).toBeNull();
  });
});
