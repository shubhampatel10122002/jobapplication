import { z } from "zod";

/**
 * Profile schemas are shaped for Groq structured outputs: every key listed in
 * `properties` must also appear in `required`. Use `.nullable()` (not
 * `.nullish()` / `.optional()` / `.default()`) for fields the model may leave empty.
 */
export const workEntrySchema = z.object({
  company: z.string(),
  title: z.string(),
  startDate: z.string().nullable().describe("e.g. 2023-06 or Jun 2023"),
  endDate: z.string().nullable().describe("null when current"),
  location: z.string().nullable(),
  description: z.string().nullable().describe("2-4 sentence summary of the role"),
});

export const educationEntrySchema = z.object({
  school: z.string(),
  degree: z.string().nullable(),
  field: z.string().nullable(),
  startYear: z.string().nullable(),
  endYear: z.string().nullable(),
  gpa: z.string().nullable(),
});

export const candidateProfileSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  location: z.string().nullable().describe("City, State/Country of residence"),
  links: z.object({
    linkedin: z.string().nullable(),
    github: z.string().nullable(),
    portfolio: z.string().nullable(),
    other: z.array(z.string()),
  }),
  workAuthorization: z.object({
    authorizedToWorkInUS: z.boolean(),
    requiresSponsorship: z.boolean(),
    visaStatus: z.string().nullable().describe("e.g. F-1 OPT, H-1B, citizen"),
  }),
  salaryExpectation: z.string().nullable(),
  summary: z.string().nullable().describe("3-5 sentence professional summary"),
  skills: z.array(z.string()),
  workHistory: z.array(workEntrySchema),
  education: z.array(educationEntrySchema),
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
