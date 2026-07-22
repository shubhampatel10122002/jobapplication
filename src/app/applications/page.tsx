import Link from "next/link";
import { listApplications } from "@/db/applications";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  in_review: "bg-amber-100 text-amber-800",
  submitting: "bg-sky-100 text-sky-800",
  submitted: "bg-emerald-100 text-emerald-800",
  needs_attention: "bg-rose-100 text-rose-800",
  failed: "bg-rose-100 text-rose-800",
};

export default async function ApplicationsPage() {
  let apps: Awaited<ReturnType<typeof listApplications>> = [];
  let dbError: string | null = null;
  try {
    apps = await listApplications();
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Applications</h1>
      <p className="mt-1 text-zinc-500">
        Every application the agent prepared or submitted, with the exact answers given.
      </p>

      {dbError && (
        <div className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Database not reachable ({dbError}).
        </div>
      )}

      {!dbError && apps.length === 0 && (
        <div className="mt-8 rounded-lg border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-500">
          Nothing yet. Paste a job URL on the{" "}
          <Link href="/" className="underline">
            inspector
          </Link>{" "}
          and hit &ldquo;Prepare application&rdquo;.
        </div>
      )}

      {apps.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-zinc-200 bg-white px-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400">
                <th className="py-2 pr-4 font-medium">Role</th>
                <th className="py-2 pr-4 font-medium">Company</th>
                <th className="py-2 pr-4 font-medium">ATS</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((app) => (
                <tr key={app.id} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2.5 pr-4">
                    <Link
                      href={`/applications/${app.id}`}
                      className="font-medium text-zinc-900 hover:underline"
                    >
                      {app.jobTitle}
                    </Link>
                  </td>
                  <td className="py-2.5 pr-4 text-zinc-600">{app.companyName}</td>
                  <td className="py-2.5 pr-4 uppercase text-xs tracking-wide text-zinc-400">
                    {app.ats}
                  </td>
                  <td className="py-2.5 pr-4">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLES[app.status] ?? "bg-zinc-100 text-zinc-600"
                      }`}
                    >
                      {app.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="py-2.5 text-zinc-500">
                    {app.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
