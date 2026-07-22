import { describe, expect, it } from "vitest";
import { detectJob } from "./detect";
import { adapters } from "./index";

/**
 * Live smoke tests against real public ATS endpoints. Skipped unless RUN_LIVE=1
 * (pnpm test:live) so CI and offline runs stay deterministic.
 */
const live = process.env.RUN_LIVE === "1" ? describe : describe.skip;

live("live ATS adapters", () => {
  it("fetches a Greenhouse job with questions", async () => {
    const listRes = await fetch("https://boards-api.greenhouse.io/v1/boards/stripe/jobs");
    const list = (await listRes.json()) as { jobs: { absolute_url: string; id: number }[] };
    const ref = detectJob(
      `https://boards.greenhouse.io/stripe/jobs/${list.jobs[0].id}`,
    )!;

    const job = await adapters.greenhouse.fetchJob(ref);
    expect(job.title.length).toBeGreaterThan(0);
    expect(job.descriptionText.length).toBeGreaterThan(100);
    expect(job.fields.length).toBeGreaterThan(3);
    expect(job.fields.some((f) => f.id === "first_name")).toBe(true);
    expect(job.fields.some((f) => f.type === "file")).toBe(true);
  }, 30_000);

  it("fetches an Ashby job with application form", async () => {
    const listRes = await fetch("https://api.ashbyhq.com/posting-api/job-board/openai");
    const list = (await listRes.json()) as { jobs: { id: string }[] };
    const ref = detectJob(`https://jobs.ashbyhq.com/openai/${list.jobs[0].id}`)!;

    const job = await adapters.ashby.fetchJob(ref);
    expect(job.title.length).toBeGreaterThan(0);
    expect(job.fields.length).toBeGreaterThan(2);
    expect(job.fields.some((f) => f.id === "_systemfield_email")).toBe(true);
    expect(job.fields.some((f) => f.type === "file")).toBe(true);
  }, 30_000);

  it("fetches a Lever job", async () => {
    const listRes = await fetch("https://api.lever.co/v0/postings/palantir?limit=1&mode=json");
    const list = (await listRes.json()) as { id: string }[];
    const ref = detectJob(`https://jobs.lever.co/palantir/${list[0].id}`)!;

    const job = await adapters.lever.fetchJob(ref);
    expect(job.title.length).toBeGreaterThan(0);
    expect(job.descriptionText.length).toBeGreaterThan(100);
    expect(job.fields.some((f) => f.id === "resume")).toBe(true);
  }, 30_000);
});
