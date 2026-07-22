import { getProfileRow } from "@/db/repo";
import { planAnswers, type PlannedAnswer } from "@/lib/answer/engine";
import { fetchJobFromUrl } from "@/lib/ats";
import type { NormalizedField, NormalizedJob } from "@/lib/ats";
import { checkEligibility, type EligibilityResult } from "@/lib/eligibility/filter";
import { EMPTY_PROFILE } from "@/lib/profile/types";

export const dynamic = "force-dynamic";

const SOURCE_STYLES: Record<string, string> = {
  profile: "bg-sky-100 text-sky-800",
  eeo_default: "bg-violet-100 text-violet-800",
  llm: "bg-amber-100 text-amber-800",
  resume_file: "bg-sky-100 text-sky-800",
  unresolved: "bg-zinc-100 text-zinc-600",
};

const SOURCE_LABELS: Record<string, string> = {
  profile: "profile",
  eeo_default: "EEO default",
  llm: "LLM",
  resume_file: "resume",
  unresolved: "needs input",
};

function answerPreview(planned: PlannedAnswer): string {
  if (planned.valueLabel) return `"${planned.valueLabel}"`;
  if (planned.source === "resume_file") {
    return planned.needsReview ? "needs your file" : "left empty (optional upload)";
  }
  if (planned.field.answerSource === "llm") {
    return "generated at apply time from resume + job description";
  }
  return planned.needsReview ? "needs your input" : "from profile (fill your profile first)";
}

function FieldRow({ planned }: { planned: PlannedAnswer }) {
  const { field } = planned;
  return (
    <tr className="border-b border-zinc-100 last:border-0">
      <td className="py-2.5 pr-4 align-top">
        <div className="font-medium text-zinc-900">{field.label}</div>
        {field.options.length > 0 && (
          <div className="mt-0.5 text-xs text-zinc-400">
            {field.options.length} options
          </div>
        )}
      </td>
      <td className="py-2.5 pr-4 align-top text-zinc-500">{field.type}</td>
      <td className="py-2.5 pr-4 align-top">
        {field.required ? (
          <span className="text-rose-600">required</span>
        ) : (
          <span className="text-zinc-400">optional</span>
        )}
      </td>
      <td className="py-2.5 pr-4 align-top">
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
            SOURCE_STYLES[planned.source]
          }`}
        >
          {SOURCE_LABELS[planned.source]}
        </span>
      </td>
      <td className="py-2.5 align-top text-zinc-600">{answerPreview(planned)}</td>
    </tr>
  );
}

function EligibilityBanner({ result }: { result: EligibilityResult }) {
  if (result.verdict === "apply") {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800">
        <span className="font-semibold">Eligible to apply</span> — no sponsorship,
        citizenship, or clearance restrictions detected.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-rose-800">
      <div className="font-semibold">Would be skipped by the eligibility filter</div>
      <ul className="mt-2 space-y-1.5">
        {result.matches.map((m, i) => (
          <li key={i} className="text-sm">
            <span className="mr-2 inline-block rounded bg-rose-200 px-1.5 py-0.5 text-xs font-medium">
              {m.category.replace(/_/g, " ")}
            </span>
            <span className="italic">&ldquo;{m.excerpt}&rdquo;</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function JobResult({ job }: { job: NormalizedJob }) {
  const eligibility = checkEligibility(job.descriptionText);

  // Preview answers with the saved profile (deterministic + EEO only — LLM answers
  // are generated at apply time). Falls back to an empty profile when DB is down.
  let profileData = EMPTY_PROFILE;
  let knowledgeBase: string[] = [];
  try {
    const row = await getProfileRow();
    if (row) {
      profileData = row.data;
      knowledgeBase = row.knowledgeBase;
    }
  } catch {
    // DB not running — preview still works, just without profile values.
  }
  const plannedAnswers = await planAnswers({
    job,
    profile: profileData,
    knowledgeBase,
  });
  const byFieldIndex = new Map(job.fields.map((f, i) => [f, plannedAnswers[i]]));

  const sections: { title: string; keys: NormalizedField["section"][] }[] = [
    { title: "Application questions", keys: ["standard", "custom"] },
    { title: "EEO / demographic questions", keys: ["eeoc", "demographic"] },
  ];

  return (
    <div className="mt-8 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-zinc-900">{job.title}</h2>
        <p className="mt-1 text-sm text-zinc-500">
          {job.companyName}
          {job.location ? ` · ${job.location}` : ""} ·{" "}
          <span className="uppercase tracking-wide">{job.ref.ats}</span>
        </p>
      </div>

      <EligibilityBanner result={eligibility} />

      {sections.map(({ title, keys }) => {
        const fields = job.fields.filter((f) => keys.includes(f.section));
        if (fields.length === 0) return null;
        return (
          <div key={title}>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              {title}
            </h3>
            <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white px-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400">
                    <th className="py-2 pr-4 font-medium">Question</th>
                    <th className="py-2 pr-4 font-medium">Type</th>
                    <th className="py-2 pr-4 font-medium">Req.</th>
                    <th className="py-2 pr-4 font-medium">Answer source</th>
                    <th className="py-2 font-medium">Planned answer</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f, i) => (
                    <FieldRow key={`${f.id}-${i}`} planned={byFieldIndex.get(f)!} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ url?: string }>;
}) {
  const { url } = await searchParams;

  let job: NormalizedJob | null = null;
  let error: string | null = null;
  if (url) {
    try {
      job = await fetchJobFromUrl(url);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900">JobPilot</h1>
      <p className="mt-1 text-zinc-500">
        Paste a Greenhouse, Lever, or Ashby job URL to inspect its application form
        and eligibility.
      </p>

      <form method="GET" className="mt-6 flex gap-2">
        <input
          type="url"
          name="url"
          defaultValue={url ?? ""}
          required
          placeholder="https://boards.greenhouse.io/company/jobs/123456"
          className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
        />
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Inspect
        </button>
      </form>

      {error && (
        <div className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {job && <JobResult job={job} />}
    </main>
  );
}
