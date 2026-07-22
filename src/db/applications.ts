import { desc, eq, sql } from "drizzle-orm";
import type { PlannedAnswer } from "@/lib/answer/engine";
import type { NormalizedField, NormalizedJob } from "@/lib/ats/types";
import type { EligibilityResult } from "@/lib/eligibility/filter";
import { db } from "./index";
import { answers, applications, jobs } from "./schema";

export interface JobRow {
  id: number;
  ats: string;
  company: string;
  externalId: string;
  url: string;
  title: string;
  companyName: string;
  location: string | null;
  descriptionText: string;
  formFields: NormalizedField[];
  eligibilityVerdict: string;
  eligibilityMatches: EligibilityResult["matches"];
}

export async function upsertJob(
  job: NormalizedJob,
  eligibility: EligibilityResult,
): Promise<JobRow> {
  const values = {
    ats: job.ref.ats,
    company: job.ref.company,
    externalId: job.ref.jobId,
    url: job.ref.url,
    title: job.title,
    companyName: job.companyName,
    location: job.location,
    descriptionText: job.descriptionText,
    formFields: job.fields,
    eligibilityVerdict: eligibility.verdict,
    eligibilityMatches: eligibility.matches,
    raw: job.raw,
  };
  const rows = await db
    .insert(jobs)
    .values(values)
    .onConflictDoUpdate({
      target: [jobs.ats, jobs.company, jobs.externalId],
      set: {
        title: values.title,
        descriptionText: values.descriptionText,
        formFields: values.formFields,
        eligibilityVerdict: values.eligibilityVerdict,
        eligibilityMatches: values.eligibilityMatches,
      },
    })
    .returning();
  return rows[0] as unknown as JobRow;
}

/** Dedupe guard: one application per job, ever. */
export async function findApplicationForJob(jobId: number) {
  const rows = await db
    .select()
    .from(applications)
    .where(eq(applications.jobId, jobId))
    .limit(1);
  return rows[0] ?? null;
}

export async function createApplicationWithAnswers(
  jobId: number,
  profileVersion: number,
  planned: PlannedAnswer[],
): Promise<number> {
  const [app] = await db
    .insert(applications)
    .values({ jobId, profileVersion, status: "in_review" })
    .returning();
  if (planned.length > 0) {
    await db.insert(answers).values(
      planned.map((p) => ({
        applicationId: app.id,
        fieldId: p.field.id,
        fieldLabel: p.field.label,
        fieldType: p.field.type,
        required: p.field.required,
        source: p.source,
        answer: p.value,
        answerLabel: p.valueLabel,
      })),
    );
  }
  return app.id;
}

export async function listApplications() {
  return db
    .select({
      id: applications.id,
      status: applications.status,
      createdAt: applications.createdAt,
      submittedAt: applications.submittedAt,
      jobTitle: jobs.title,
      companyName: jobs.companyName,
      jobUrl: jobs.url,
      ats: jobs.ats,
    })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .orderBy(desc(applications.createdAt));
}

export async function getApplicationDetail(id: number) {
  const rows = await db
    .select()
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .where(eq(applications.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  const answerRows = await db
    .select()
    .from(answers)
    .where(eq(answers.applicationId, id))
    .orderBy(answers.id);
  return {
    application: rows[0].applications,
    job: rows[0].jobs as unknown as JobRow,
    answers: answerRows,
  };
}

export async function updateAnswerValue(
  applicationId: number,
  answerId: number,
  value: string,
  valueLabel: string | null,
): Promise<void> {
  await db
    .update(answers)
    .set({ answer: value, answerLabel: valueLabel, source: "user_edited" })
    .where(sql`${answers.id} = ${answerId} and ${answers.applicationId} = ${applicationId}`);
}

export async function setApplicationStatus(
  id: number,
  status: string,
  extra: {
    error?: string | null;
    confirmationScreenshotPath?: string | null;
    submittedPayload?: unknown;
    submittedAt?: Date | null;
  } = {},
): Promise<void> {
  await db
    .update(applications)
    .set({ status, ...extra })
    .where(eq(applications.id, id));
}
