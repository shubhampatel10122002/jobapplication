import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Single-user for now: one profile row. Multi-user (Better Auth) can be layered on
 * later by adding a userId column to profile/jobs/applications.
 */
export const profile = pgTable("profile", {
  id: serial("id").primaryKey(),
  /** Structured profile parsed from resume + user edits (contact, work history, links...) */
  data: jsonb("data").notNull(),
  /** Fixed EEO answers (gender, race, veteran, disability) — see src/lib/profile/eeo.ts */
  eeoDefaults: jsonb("eeo_defaults").notNull(),
  /** Free-form Q&A knowledge base used as LLM context for screening questions */
  knowledgeBase: jsonb("knowledge_base").notNull().default([]),
  resumePath: text("resume_path"),
  resumeText: text("resume_text"),
  /** Bumped on every edit; answer cache entries are keyed on this */
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const jobs = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    ats: text("ats").notNull(), // greenhouse | lever | ashby
    company: text("company").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    companyName: text("company_name").notNull(),
    location: text("location"),
    descriptionText: text("description_text").notNull(),
    /** Normalized application form fields (NormalizedField[]) */
    formFields: jsonb("form_fields").notNull(),
    eligibilityVerdict: text("eligibility_verdict").notNull(), // apply | skip
    eligibilityMatches: jsonb("eligibility_matches").notNull().default([]),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("jobs_ats_company_external_id").on(t.ats, t.company, t.externalId)],
);

/**
 * Application lifecycle:
 * draft -> answers_generated -> in_review -> approved -> submitting
 *       -> submitted | failed | needs_attention (captcha, unmappable field, ...)
 * skipped_ineligible when the eligibility filter rejected the job.
 */
export const applications = pgTable("applications", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobs.id),
  status: text("status").notNull().default("draft"),
  profileVersion: integer("profile_version").notNull(),
  /** Exact payload sent to the ATS, kept for the audit trail */
  submittedPayload: jsonb("submitted_payload"),
  confirmationScreenshotPath: text("confirmation_screenshot_path"),
  error: text("error"),
  submittedAt: timestamp("submitted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * One row per form field per application — this powers the post-application review
 * screen showing exactly what the agent answered for every question.
 */
export const answers = pgTable("answers", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id")
    .notNull()
    .references(() => applications.id),
  fieldId: text("field_id").notNull(),
  fieldLabel: text("field_label").notNull(),
  fieldType: text("field_type").notNull(),
  required: boolean("required").notNull(),
  /** profile | eeo_default | llm | user_edited */
  source: text("source").notNull(),
  answer: text("answer"),
  /** For selects: the option label shown to humans (answer holds the submit value) */
  answerLabel: text("answer_label"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * LLM answers cached by question hash + profile version — screening questions repeat
 * across companies constantly, so this cuts LLM cost substantially.
 */
export const answerCache = pgTable(
  "answer_cache",
  {
    id: serial("id").primaryKey(),
    questionHash: text("question_hash").notNull(),
    profileVersion: integer("profile_version").notNull(),
    questionLabel: text("question_label").notNull(),
    answer: text("answer").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("answer_cache_hash_version").on(t.questionHash, t.profileVersion),
  ],
);
