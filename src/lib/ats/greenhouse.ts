import { classifyAnswerSource } from "./classify";
import { htmlToText } from "./html";
import type {
  AtsAdapter,
  FieldOption,
  FieldType,
  JobRef,
  NormalizedField,
  NormalizedJob,
} from "./types";

interface GhField {
  name: string;
  type: string;
  values: { label: string; value: number | string }[];
}

interface GhQuestion {
  label: string;
  required: boolean | null;
  description: string | null;
  fields: GhField[];
}

/** Demographic survey questions use a different shape than regular questions. */
interface GhDemographicQuestion {
  id: number;
  label: string;
  required: boolean | null;
  type: string;
  answer_options: { id: number; label: string }[];
}

interface GhJobResponse {
  id: number;
  title: string;
  company_name: string;
  location?: { name: string } | null;
  content: string;
  questions?: GhQuestion[];
  location_questions?: GhQuestion[];
  compliance?: { type: string; questions: GhQuestion[] }[];
  demographic_questions?: {
    questions?: GhDemographicQuestion[];
  } | null;
}

function mapType(gh: GhField, label: string): FieldType {
  switch (gh.type) {
    case "input_file":
      return "file";
    case "textarea":
      return "textarea";
    case "multi_value_single_select":
      return "select";
    case "multi_value_multi_select":
      return "multi_select";
    case "input_text":
      if (gh.name === "email" || /\bemail\b/i.test(label)) return "email";
      if (gh.name === "phone") return "phone";
      return "text";
    default:
      return "unknown";
  }
}

const STANDARD_FIELD_NAMES = new Set([
  "first_name",
  "last_name",
  "email",
  "phone",
  "resume",
  "resume_text",
  "cover_letter",
  "cover_letter_text",
  "location",
]);

function normalizeQuestion(
  q: GhQuestion,
  section: NormalizedField["section"],
): NormalizedField[] {
  // A Greenhouse "question" can expose multiple fields (e.g. resume file + resume text).
  // We keep the primary (first) field; the file/text alternates share one answer.
  const primary = q.fields[0];
  if (!primary) return [];
  const label = htmlToText(q.label);
  const inferredSection =
    section === "custom" && STANDARD_FIELD_NAMES.has(primary.name) ? "standard" : section;
  const options: FieldOption[] = (primary.values ?? []).map((v) => ({
    label: v.label,
    value: String(v.value),
  }));
  return [
    {
      id: primary.name,
      label,
      type: mapType(primary, label),
      required: q.required ?? false,
      options,
      section: inferredSection,
      answerSource: classifyAnswerSource(label, inferredSection),
    },
  ];
}

export const greenhouseAdapter: AtsAdapter = {
  kind: "greenhouse",

  async fetchJob(ref: JobRef): Promise<NormalizedJob> {
    const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(
      ref.company,
    )}/jobs/${encodeURIComponent(ref.jobId)}?questions=true`;
    const res = await fetch(apiUrl, { headers: { accept: "application/json" } });
    if (!res.ok) {
      throw new Error(`Greenhouse API returned ${res.status} for ${apiUrl}`);
    }
    const data = (await res.json()) as GhJobResponse;

    const fields: NormalizedField[] = [];
    for (const q of data.questions ?? []) fields.push(...normalizeQuestion(q, "custom"));
    for (const q of data.location_questions ?? []) {
      fields.push(...normalizeQuestion(q, "standard"));
    }
    for (const block of data.compliance ?? []) {
      for (const q of block.questions ?? []) fields.push(...normalizeQuestion(q, "eeoc"));
    }
    for (const q of data.demographic_questions?.questions ?? []) {
      const label = htmlToText(q.label);
      fields.push({
        id: `demographic_question_${q.id}`,
        label,
        type: q.type === "multi_value_multi_select" ? "multi_select" : "select",
        required: q.required ?? false,
        options: (q.answer_options ?? []).map((o) => ({
          label: o.label,
          value: String(o.id),
        })),
        section: "demographic",
        answerSource: classifyAnswerSource(label, "demographic"),
      });
    }

    return {
      ref,
      title: data.title,
      companyName: data.company_name,
      location: data.location?.name ?? null,
      descriptionHtml: data.content,
      descriptionText: htmlToText(data.content),
      fields,
      raw: data,
    };
  },
};
