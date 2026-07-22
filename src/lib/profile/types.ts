import { z } from "zod";

export const workEntrySchema = z.object({
  company: z.string(),
  title: z.string(),
  startDate: z.string().nullish().describe("e.g. 2023-06 or Jun 2023"),
  endDate: z.string().nullish().describe("null/empty when current"),
  location: z.string().nullish(),
  description: z.string().nullish().describe("2-4 sentence summary of the role"),
});

export const educationEntrySchema = z.object({
  school: z.string(),
  degree: z.string().nullish(),
  field: z.string().nullish(),
  startYear: z.string().nullish(),
  endYear: z.string().nullish(),
  gpa: z.string().nullish(),
});

export const candidateProfileSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  phone: z.string().nullish(),
  location: z.string().nullish().describe("City, State/Country of residence"),
  links: z.object({
    linkedin: z.string().nullish(),
    github: z.string().nullish(),
    portfolio: z.string().nullish(),
    other: z.array(z.string()).default([]),
  }),
  workAuthorization: z.object({
    authorizedToWorkInUS: z.boolean().default(true),
    requiresSponsorship: z.boolean().default(true),
    visaStatus: z.string().nullish().describe("e.g. F-1 OPT, H-1B, citizen"),
  }),
  salaryExpectation: z.string().nullish(),
  summary: z.string().nullish().describe("3-5 sentence professional summary"),
  skills: z.array(z.string()).default([]),
  workHistory: z.array(workEntrySchema).default([]),
  education: z.array(educationEntrySchema).default([]),
});

export type CandidateProfile = z.infer<typeof candidateProfileSchema>;

export const EMPTY_PROFILE: CandidateProfile = {
  firstName: "",
  lastName: "",
  email: "",
  phone: null,
  location: null,
  links: { linkedin: null, github: null, portfolio: null, other: [] },
  workAuthorization: {
    authorizedToWorkInUS: true,
    requiresSponsorship: true,
    visaStatus: null,
  },
  salaryExpectation: null,
  summary: null,
  skills: [],
  workHistory: [],
  education: [],
};
