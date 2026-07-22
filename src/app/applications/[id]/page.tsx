import Link from "next/link";
import { notFound } from "next/navigation";
import { getApplicationDetail } from "@/db/applications";
import { ReviewForm } from "./review-form";

export const dynamic = "force-dynamic";

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getApplicationDetail(Number(id));
  if (!detail) notFound();

  const { application, job, answers } = detail;
  const optionsByFieldId = new Map(job.formFields.map((f) => [f.id, f.options]));
  const skipped = job.eligibilityVerdict === "skip";
  const autoSubmit = process.env.AUTO_SUBMIT === "1";

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12">
      <Link href="/applications" className="text-sm text-zinc-400 hover:text-zinc-600">
        ← All applications
      </Link>
      <div className="mt-2 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{job.title}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {job.companyName}
            {job.location ? ` · ${job.location}` : ""} ·{" "}
            <a href={job.url} target="_blank" className="underline">
              posting
            </a>
          </p>
        </div>
        <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700">
          {application.status.replace(/_/g, " ")}
        </span>
      </div>

      {skipped && (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <span className="font-semibold">Eligibility filter would skip this job:</span>{" "}
          {job.eligibilityMatches.map((m) => `"${m.excerpt}"`).join(" · ")}
          <span className="block mt-1 text-rose-600">
            You can still submit manually if you believe it&apos;s a false positive.
          </span>
        </div>
      )}

      {application.error && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {application.error}
        </div>
      )}

      {application.confirmationScreenshotPath && (
        <p className="mt-4 text-sm text-zinc-500">
          Latest form screenshot:{" "}
          <a href={`/applications/${application.id}/screenshot`} target="_blank" className="underline">
            view
          </a>
        </p>
      )}

      <ReviewForm
        applicationId={application.id}
        status={application.status}
        autoSubmit={autoSubmit}
        answers={answers.map((a) => ({
          id: a.id,
          fieldId: a.fieldId,
          label: a.fieldLabel,
          type: a.fieldType,
          required: a.required,
          source: a.source,
          value: a.answer,
          valueLabel: a.answerLabel,
          options: optionsByFieldId.get(a.fieldId) ?? [],
        }))}
      />
    </main>
  );
}
