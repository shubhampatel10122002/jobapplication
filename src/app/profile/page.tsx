import { getProfileRow } from "@/db/repo";
import { hasLlmKey } from "@/lib/llm";
import { EEO_DEFAULTS } from "@/lib/profile/eeo";
import { EMPTY_PROFILE } from "@/lib/profile/types";
import { KnowledgeBase, ProfileForm, ResumeUploadForm } from "./forms";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  let row = null;
  let dbError: string | null = null;
  try {
    row = await getProfileRow();
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-6 py-12">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Your profile</h1>
        <p className="mt-1 text-zinc-500">
          Everything the agent knows about you. Standard fields are filled from here;
          screening questions use the resume, profile and knowledge base as context.
        </p>
      </div>

      {dbError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Database not reachable ({dbError}). Start it with <code>docker compose up -d</code>{" "}
          and run <code>pnpm db:push</code>.
        </div>
      )}

      {!hasLlmKey() && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No LLM API key configured — resume parsing and screening answers are disabled.
          Set <code>GOOGLE_GENERATIVE_AI_API_KEY</code> in <code>.env</code> (free key:
          aistudio.google.com/apikey). You can still edit the profile manually.
        </div>
      )}

      {!dbError && (
        <>
          <ResumeUploadForm hasResume={!!row?.resumePath} />
          {/* Keyed on version: the form is uncontrolled (defaultValue), so it must
              remount to show freshly parsed resume data after an upload. */}
          <ProfileForm key={row?.version ?? 0} profile={row?.data ?? EMPTY_PROFILE} />
          <KnowledgeBase entries={row?.knowledgeBase ?? []} />

          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600">
            <h2 className="font-semibold text-zinc-900">Fixed EEO answers</h2>
            <p className="mt-1 text-zinc-500">
              Answered deterministically on every application — the AI never guesses these.
            </p>
            <ul className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
              <li>Gender: <span className="font-medium capitalize">{EEO_DEFAULTS.gender}</span></li>
              <li>Hispanic or Latino: <span className="font-medium">{EEO_DEFAULTS.hispanicOrLatino ? "Yes" : "No"}</span></li>
              <li>Race: <span className="font-medium capitalize">{EEO_DEFAULTS.race}</span></li>
              <li>Protected veteran: <span className="font-medium">{EEO_DEFAULTS.protectedVeteran ? "Yes" : "No"}</span></li>
              <li>Disability: <span className="font-medium">{EEO_DEFAULTS.disability ? "Yes" : "No"}</span></li>
            </ul>
          </div>
        </>
      )}
    </main>
  );
}
