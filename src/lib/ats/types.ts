export type AtsKind = "greenhouse" | "lever" | "ashby";

export interface JobRef {
  ats: AtsKind;
  /** Company board slug, e.g. "stripe" for boards.greenhouse.io/stripe */
  company: string;
  /** ATS-specific job/posting id */
  jobId: string;
  url: string;
}

export type FieldType =
  | "text"
  | "textarea"
  | "select"
  | "multi_select"
  | "boolean"
  | "file"
  | "email"
  | "phone"
  | "location"
  | "unknown";

export interface FieldOption {
  label: string;
  value: string;
}

/**
 * How the answer for a field is produced:
 * - profile: mapped deterministically from the candidate profile (name, email, resume...)
 * - eeo_default: mapped from the user's fixed EEO/demographic answers
 * - llm: requires the LLM answer engine (screening / open-ended questions)
 */
export type AnswerSource = "profile" | "eeo_default" | "llm";

export interface NormalizedField {
  /** ATS-native field identifier used at submission time */
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: FieldOption[];
  answerSource: AnswerSource;
  /** e.g. "eeoc" for compliance questions, "custom" for screening questions */
  section: "standard" | "custom" | "eeoc" | "demographic";
}

export interface NormalizedJob {
  ref: JobRef;
  title: string;
  companyName: string;
  location: string | null;
  /** Plain-text job description (HTML stripped) */
  descriptionText: string;
  descriptionHtml: string;
  fields: NormalizedField[];
  raw: unknown;
}

export interface AtsAdapter {
  kind: AtsKind;
  /** Fetch job details and the normalized application form schema. */
  fetchJob(ref: JobRef): Promise<NormalizedJob>;
}
