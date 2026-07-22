import { describe, expect, it, vi } from "vitest";
import type { NormalizedField, NormalizedJob } from "../ats/types";
import { EMPTY_PROFILE, type CandidateProfile } from "../profile/types";
import { planAnswers, questionHash, type AnswerCacheStore } from "./engine";

const profile: CandidateProfile = {
  ...EMPTY_PROFILE,
  firstName: "Shubham",
  lastName: "Patel",
  email: "shubham@example.com",
};

function field(partial: Partial<NormalizedField> & Pick<NormalizedField, "id" | "label">): NormalizedField {
  return {
    type: "text",
    required: true,
    options: [],
    section: "custom",
    answerSource: "llm",
    ...partial,
  };
}

function job(fields: NormalizedField[]): NormalizedJob {
  return {
    ref: { ats: "greenhouse", company: "acme", jobId: "1", url: "https://x" },
    title: "Engineer",
    companyName: "Acme",
    location: null,
    descriptionText: "Great job",
    descriptionHtml: "",
    fields,
    raw: {},
  };
}

function memoryCache(): AnswerCacheStore & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(hash) {
      return store.get(hash) ?? null;
    },
    async set(hash, _label, answer) {
      store.set(hash, answer);
    },
  };
}

describe("planAnswers", () => {
  it("maps profile, EEO, resume and LLM fields to the right sources", async () => {
    const llm = vi.fn().mockResolvedValue("Because I love infra.");
    const answers = await planAnswers({
      job: job([
        field({ id: "first_name", label: "First Name", answerSource: "profile" }),
        field({ id: "resume", label: "Resume/CV", type: "file", answerSource: "profile" }),
        field({
          id: "gender",
          label: "Gender",
          type: "select",
          section: "eeoc",
          answerSource: "eeo_default",
          options: [
            { label: "Male", value: "1" },
            { label: "Female", value: "2" },
          ],
        }),
        field({ id: "q1", label: "Why do you want to work here?", type: "textarea" }),
      ]),
      profile,
      llm,
    });

    expect(answers[0]).toMatchObject({ source: "profile", value: "Shubham", needsReview: false });
    expect(answers[1]).toMatchObject({ source: "resume_file", needsReview: false });
    expect(answers[2]).toMatchObject({ source: "eeo_default", valueLabel: "Male", value: "1" });
    expect(answers[3]).toMatchObject({
      source: "llm",
      value: "Because I love infra.",
      needsReview: false,
    });
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("maps LLM select answers back to option values and rejects invalid ones", async () => {
    const selectField = field({
      id: "q2",
      label: "Are you willing to relocate?",
      type: "select",
      options: [
        { label: "Yes", value: "yes-1" },
        { label: "No", value: "no-2" },
      ],
    });

    const good = await planAnswers({
      job: job([selectField]),
      profile,
      llm: vi.fn().mockResolvedValue("yes"),
    });
    expect(good[0]).toMatchObject({ source: "llm", value: "yes-1", valueLabel: "Yes" });

    const bad = await planAnswers({
      job: job([selectField]),
      profile,
      llm: vi.fn().mockResolvedValue("Absolutely!"),
    });
    expect(bad[0]).toMatchObject({ source: "unresolved", value: null, needsReview: true });
  });

  it("flags LLM fields for review when no LLM is configured", async () => {
    const answers = await planAnswers({
      job: job([field({ id: "q1", label: "Tell us about yourself", type: "textarea" })]),
      profile,
    });
    expect(answers[0]).toMatchObject({ source: "unresolved", needsReview: true });
  });

  it("uses the cache and only calls the LLM once for identical questions", async () => {
    const llm = vi.fn().mockResolvedValue("Cached answer");
    const cache = memoryCache();
    const q = field({ id: "q1", label: "What excites you about startups?", type: "textarea" });

    const first = await planAnswers({ job: job([q]), profile, llm, cache });
    const second = await planAnswers({ job: job([q]), profile, llm, cache });

    expect(first[0].fromCache).toBe(false);
    expect(second[0].fromCache).toBe(true);
    expect(second[0].value).toBe("Cached answer");
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("never sends EEO questions to the LLM, even without a matching option", async () => {
    const llm = vi.fn();
    const answers = await planAnswers({
      job: job([
        field({
          id: "gender",
          label: "Gender",
          type: "select",
          section: "eeoc",
          answerSource: "eeo_default",
          options: [{ label: "Prefer not to say", value: "1" }],
        }),
      ]),
      profile,
      llm,
    });
    expect(answers[0]).toMatchObject({ source: "unresolved", needsReview: true });
    expect(llm).not.toHaveBeenCalled();
  });

  it("flags required non-resume file uploads for review", async () => {
    const answers = await planAnswers({
      job: job([
        field({ id: "transcript", label: "Upload transcript", type: "file", required: true }),
      ]),
      profile,
    });
    expect(answers[0]).toMatchObject({ source: "resume_file", needsReview: true });
  });

  it("maps work-auth Yes/No from profile without calling the LLM", async () => {
    const llm = vi.fn();
    const answers = await planAnswers({
      job: job([
        field({
          id: "auth",
          label: "Are you authorized to work in the United States?",
          type: "select",
          options: [
            { label: "Yes", value: "1" },
            { label: "No", value: "0" },
          ],
        }),
        field({
          id: "sponsor",
          label: "Will you require sponsorship?",
          type: "boolean",
        }),
      ]),
      profile: {
        ...profile,
        workAuthorization: {
          authorizedToWorkInUS: true,
          requiresSponsorship: false,
          visaStatus: null,
        },
      },
      llm,
    });
    expect(answers[0]).toMatchObject({
      source: "profile",
      value: "1",
      valueLabel: "Yes",
      needsReview: false,
    });
    expect(answers[1]).toMatchObject({
      source: "profile",
      value: "false",
      valueLabel: "No",
      needsReview: false,
    });
    expect(llm).not.toHaveBeenCalled();
  });

  it("leaves availability for review instead of accepting LLM hedges", async () => {
    const llm = vi.fn().mockResolvedValue("Availability is not mentioned in the profile");
    const answers = await planAnswers({
      job: job([
        field({ id: "avail", label: "When can you start / availability?", type: "text" }),
      ]),
      profile: { ...profile, availableFrom: null },
      llm,
    });
    expect(answers[0]).toMatchObject({
      source: "unresolved",
      value: null,
      needsReview: true,
    });
    expect(llm).not.toHaveBeenCalled();
  });

  it("uses profile availableFrom for date fields", async () => {
    const llm = vi.fn();
    const answers = await planAnswers({
      job: job([field({ id: "start", label: "Earliest start date", type: "date" })]),
      profile: { ...profile, availableFrom: "8/15/2026" },
      llm,
    });
    expect(answers[0]).toMatchObject({
      source: "profile",
      value: "2026-08-15",
      needsReview: false,
    });
    expect(llm).not.toHaveBeenCalled();
  });

  it("treats UNKNOWN LLM answers as needsReview", async () => {
    const llm = vi.fn().mockResolvedValue("UNKNOWN");
    const answers = await planAnswers({
      job: job([field({ id: "q", label: "What is your favorite color?", type: "text" })]),
      profile,
      llm,
    });
    expect(answers[0]).toMatchObject({ source: "unresolved", value: null, needsReview: true });
  });

  it("forces boolean fields through Yes/No options for the LLM", async () => {
    const llm = vi.fn().mockResolvedValue("Yes");
    const answers = await planAnswers({
      job: job([
        field({
          id: "remote",
          label: "Are you open to hybrid work?",
          type: "boolean",
        }),
      ]),
      profile,
      llm,
    });
    expect(llm).toHaveBeenCalledWith(
      expect.objectContaining({ optionLabels: ["Yes", "No"] }),
    );
    expect(answers[0]).toMatchObject({
      source: "llm",
      value: "true",
      valueLabel: "Yes",
      needsReview: false,
    });
  });
});
