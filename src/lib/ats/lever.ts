import { classifyAnswerSource } from "./classify";
import { htmlToText } from "./html";
import type { AtsAdapter, JobRef, NormalizedField, NormalizedJob } from "./types";

interface LeverPosting {
  id: string;
  text: string;
  categories?: { location?: string; team?: string; commitment?: string };
  description: string;
  descriptionPlain?: string;
  applyUrl?: string;
}

/**
 * Lever's public postings API does not expose custom screening questions — those are
 * rendered server-side on the apply page. v1 normalizes the standard Lever application
 * fields (always present); custom questions will be picked up by the Playwright
 * fallback path when we add submission.
 */
const LEVER_STANDARD_FIELDS: Array<
  Pick<NormalizedField, "id" | "label" | "type" | "required">
> = [
  { id: "name", label: "Full name", type: "text", required: true },
  { id: "email", label: "Email", type: "email", required: true },
  { id: "phone", label: "Phone", type: "phone", required: false },
  { id: "org", label: "Current company", type: "text", required: false },
  { id: "urls[LinkedIn]", label: "LinkedIn URL", type: "text", required: false },
  { id: "resume", label: "Resume/CV", type: "file", required: true },
  { id: "comments", label: "Additional information / cover letter", type: "textarea", required: false },
];

export const leverAdapter: AtsAdapter = {
  kind: "lever",

  async fetchJob(ref: JobRef): Promise<NormalizedJob> {
    const apiUrl = `https://api.lever.co/v0/postings/${encodeURIComponent(
      ref.company,
    )}/${encodeURIComponent(ref.jobId)}`;
    const res = await fetch(apiUrl, { headers: { accept: "application/json" } });
    if (!res.ok) {
      throw new Error(`Lever API returned ${res.status} for ${apiUrl}`);
    }
    const data = (await res.json()) as LeverPosting;

    const fields: NormalizedField[] = LEVER_STANDARD_FIELDS.map((f) => ({
      ...f,
      options: [],
      section: "standard" as const,
      answerSource: classifyAnswerSource(f.label, "standard"),
    }));

    return {
      ref,
      title: data.text,
      companyName: ref.company,
      location: data.categories?.location ?? null,
      descriptionHtml: data.description,
      descriptionText: data.descriptionPlain ?? htmlToText(data.description),
      fields,
      raw: data,
    };
  },
};
