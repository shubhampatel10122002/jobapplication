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

/**
 * Ashby exposes a public (non-authenticated) GraphQL endpoint that the hosted job
 * board frontend itself uses. The application form schema is only available there;
 * the REST posting-api does not include it.
 */
const GRAPHQL_URL = "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting";

const JOB_POSTING_QUERY = `query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
  jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
    id
    title
    locationName
    descriptionHtml
    applicationForm {
      sections {
        title
        fieldEntries {
          field
          isRequired
          descriptionHtml
        }
      }
    }
  }
}`;

interface AshbyFieldJson {
  id: string;
  path: string;
  title: string;
  type: string;
  isNullable?: boolean;
  selectableValues?: { label: string; value: string }[] | null;
}

interface AshbyResponse {
  data?: {
    jobPosting?: {
      id: string;
      title: string;
      locationName?: string | null;
      descriptionHtml?: string | null;
      applicationForm?: {
        sections: {
          title: string | null;
          fieldEntries: { field: AshbyFieldJson; isRequired: boolean }[];
        }[];
      } | null;
    } | null;
  };
  errors?: { message: string }[];
}

function mapType(t: string): FieldType {
  switch (t) {
    case "String":
      return "text";
    case "LongText":
      return "textarea";
    case "Email":
      return "email";
    case "Phone":
      return "phone";
    case "File":
      return "file";
    case "Boolean":
      return "boolean";
    case "Date":
      return "date";
    case "ValueSelect":
      return "select";
    case "MultiValueSelect":
      return "multi_select";
    case "Location":
      return "location";
    default:
      return "unknown";
  }
}

export const ashbyAdapter: AtsAdapter = {
  kind: "ashby",

  async fetchJob(ref: JobRef): Promise<NormalizedJob> {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationName: "ApiJobPosting",
        variables: {
          organizationHostedJobsPageName: ref.company,
          jobPostingId: ref.jobId,
        },
        query: JOB_POSTING_QUERY,
      }),
    });
    if (!res.ok) {
      throw new Error(`Ashby GraphQL returned ${res.status}`);
    }
    const data = (await res.json()) as AshbyResponse;
    if (data.errors?.length) {
      throw new Error(`Ashby GraphQL error: ${data.errors[0].message}`);
    }
    const posting = data.data?.jobPosting;
    if (!posting) {
      throw new Error(`Ashby job posting not found: ${ref.company}/${ref.jobId}`);
    }

    const fields: NormalizedField[] = [];
    for (const section of posting.applicationForm?.sections ?? []) {
      for (const entry of section.fieldEntries) {
        const f = entry.field;
        const label = f.title || f.path;
        const isSystem = f.path.startsWith("_systemfield_");
        const section_: NormalizedField["section"] = isSystem ? "standard" : "custom";
        const options: FieldOption[] = (f.selectableValues ?? []).map((v) => ({
          label: v.label,
          value: v.value,
        }));
        fields.push({
          id: f.path,
          label,
          type: mapType(f.type),
          required: entry.isRequired,
          options,
          section: section_,
          answerSource: classifyAnswerSource(label, section_),
        });
      }
    }

    const html = posting.descriptionHtml ?? "";
    return {
      ref,
      title: posting.title,
      companyName: ref.company,
      location: posting.locationName ?? null,
      descriptionHtml: html,
      descriptionText: htmlToText(html),
      fields,
      raw: data,
    };
  },
};
