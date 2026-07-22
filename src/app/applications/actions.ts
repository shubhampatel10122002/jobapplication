"use server";

import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createApplicationWithAnswers,
  findApplicationForJob,
  getApplicationDetail,
  setApplicationStatus,
  updateAnswerValue,
  upsertJob,
} from "@/db/applications";
import { dbAnswerCache, getProfileRow } from "@/db/repo";
import { planAnswers } from "@/lib/answer/engine";
import { llmAnswer } from "@/lib/answer/llm";
import { fetchJobFromUrl } from "@/lib/ats";
import { checkEligibility } from "@/lib/eligibility/filter";
import { hasLlmKey } from "@/lib/llm";
import { submitWithPlaywright } from "@/lib/submit/playwright";

export interface ActionState {
  error?: string;
  ok?: string;
}

export async function prepareApplicationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let applicationId: number;
  try {
    const url = formData.get("url");
    if (typeof url !== "string" || !url) return { error: "Missing job URL." };

    const profileRow = await getProfileRow();
    if (!profileRow || !profileRow.data.email) {
      return { error: "Fill in your profile first (at least name and email)." };
    }

    const job = await fetchJobFromUrl(url);
    const eligibility = checkEligibility(job.descriptionText);
    const jobRow = await upsertJob(job, eligibility);

    const existing = await findApplicationForJob(jobRow.id);
    if (existing) {
      applicationId = existing.id;
    } else {
      const planned = await planAnswers({
        job,
        profile: profileRow.data,
        knowledgeBase: profileRow.knowledgeBase,
        llm: hasLlmKey() ? llmAnswer : undefined,
        cache: dbAnswerCache(profileRow.version),
      });
      applicationId = await createApplicationWithAnswers(
        jobRow.id,
        profileRow.version,
        planned,
      );
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  redirect(`/applications/${applicationId}`);
}

export async function saveAnswersAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const applicationId = Number(formData.get("applicationId"));
    const detail = await getApplicationDetail(applicationId);
    if (!detail) return { error: "Application not found." };

    const optionsByFieldId = new Map(
      detail.job.formFields.map((f) => [f.id, f.options]),
    );

    for (const row of detail.answers) {
      const raw = formData.get(`answer_${row.id}`);
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim();
      const current = row.answer ?? "";
      if (trimmed === current) continue;

      const options = optionsByFieldId.get(row.fieldId) ?? [];
      const option = options.find((o) => o.value === trimmed);
      await updateAnswerValue(
        applicationId,
        row.id,
        trimmed,
        option?.label ?? (options.length > 0 ? null : trimmed),
      );
    }
    revalidatePath(`/applications/${applicationId}`);
    return { ok: "Answers saved." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function submitApplicationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const applicationId = Number(formData.get("applicationId"));
    const detail = await getApplicationDetail(applicationId);
    if (!detail) return { error: "Application not found." };
    if (detail.application.status === "submitted") {
      return { error: "Already submitted." };
    }

    const profileRow = await getProfileRow();
    const fieldById = new Map(detail.job.formFields.map((f) => [f.id, f]));

    const missingRequired = detail.answers.filter(
      (a) => a.required && a.fieldType !== "file" && !a.answer,
    );
    if (missingRequired.length > 0) {
      return {
        error: `Required answers missing: ${missingRequired
          .map((a) => a.fieldLabel)
          .join("; ")}`,
      };
    }

    const resolved = detail.answers
      .filter((a) => a.answer)
      .map((a) => ({
        field: fieldById.get(a.fieldId) ?? {
          id: a.fieldId,
          label: a.fieldLabel,
          type: a.fieldType as never,
          required: a.required,
          options: [],
          section: "custom" as const,
          answerSource: "llm" as const,
        },
        value: a.answer!,
        valueLabel: a.answerLabel,
      }));

    const dryRun = process.env.AUTO_SUBMIT !== "1";
    const screenshotPath = path.join(
      process.cwd(),
      "data",
      "screenshots",
      `application-${applicationId}.png`,
    );

    await setApplicationStatus(applicationId, "submitting");
    const result = await submitWithPlaywright({
      job: {
        ref: {
          ats: detail.job.ats as never,
          company: detail.job.company,
          jobId: detail.job.externalId,
          url: detail.job.url,
        },
        title: detail.job.title,
        companyName: detail.job.companyName,
        location: detail.job.location,
        descriptionText: detail.job.descriptionText,
        descriptionHtml: "",
        fields: detail.job.formFields,
        raw: null,
      },
      answers: resolved,
      resumePath: profileRow?.resumePath ?? null,
      dryRun,
      screenshotPath,
    });

    const statusMap = {
      submitted: "submitted",
      dry_run_complete: "in_review",
      needs_attention: "needs_attention",
      failed: "failed",
    } as const;

    await setApplicationStatus(applicationId, statusMap[result.status], {
      error: result.status === "submitted" ? null : result.detail,
      confirmationScreenshotPath: result.screenshotPath,
      submittedPayload: {
        dryRun,
        filledLabels: result.filledLabels,
        unfilledLabels: result.unfilledLabels,
        answers: resolved.map((r) => ({
          fieldId: r.field.id,
          label: r.field.label,
          value: r.value,
        })),
      },
      submittedAt: result.status === "submitted" ? new Date() : null,
    });

    revalidatePath(`/applications/${applicationId}`);
    revalidatePath("/applications");
    return result.status === "failed" || result.status === "needs_attention"
      ? { error: result.detail }
      : { ok: result.detail };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
