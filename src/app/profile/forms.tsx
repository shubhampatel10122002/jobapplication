"use client";

import { useActionState } from "react";
import type { CandidateProfile } from "@/lib/profile/types";
import {
  addKnowledgeAction,
  removeKnowledgeAction,
  saveProfileAction,
  uploadResumeAction,
  type ActionState,
} from "./actions";

const INITIAL: ActionState = {};

function StatusLine({ state }: { state: ActionState }) {
  if (state.error) return <p className="mt-2 text-sm text-rose-600">{state.error}</p>;
  if (state.ok) return <p className="mt-2 text-sm text-emerald-600">{state.ok}</p>;
  return null;
}

const inputCls =
  "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200";
const labelCls = "mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500";
const buttonCls =
  "rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50";

export function ResumeUploadForm({ hasResume }: { hasResume: boolean }) {
  const [state, action, pending] = useActionState(uploadResumeAction, INITIAL);
  return (
    <form action={action} className="rounded-lg border border-zinc-200 bg-white p-5">
      <h2 className="font-semibold text-zinc-900">Resume</h2>
      <p className="mt-1 text-sm text-zinc-500">
        {hasResume
          ? "A resume is on file. Uploading a new one re-parses your profile."
          : "Upload your resume (PDF). The AI extracts your profile; you review and correct it below."}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <input type="file" name="resume" accept="application/pdf" className="text-sm" />
        <button type="submit" disabled={pending} className={buttonCls}>
          {pending ? "Parsing…" : "Upload & parse"}
        </button>
      </div>
      <StatusLine state={state} />
    </form>
  );
}

export function ProfileForm({ profile }: { profile: CandidateProfile }) {
  const [state, action, pending] = useActionState(saveProfileAction, INITIAL);
  const p = profile;
  return (
    <form action={action} className="rounded-lg border border-zinc-200 bg-white p-5">
      <h2 className="font-semibold text-zinc-900">Profile</h2>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>First name</label>
          <input name="firstName" defaultValue={p.firstName} required className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Last name</label>
          <input name="lastName" defaultValue={p.lastName} required className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Email</label>
          <input name="email" type="email" defaultValue={p.email} required className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Phone</label>
          <input name="phone" defaultValue={p.phone ?? ""} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Location</label>
          <input name="location" defaultValue={p.location ?? ""} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Salary expectation</label>
          <input name="salaryExpectation" defaultValue={p.salaryExpectation ?? ""} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>LinkedIn</label>
          <input name="linkedin" defaultValue={p.links.linkedin ?? ""} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>GitHub</label>
          <input name="github" defaultValue={p.links.github ?? ""} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Portfolio / website</label>
          <input name="portfolio" defaultValue={p.links.portfolio ?? ""} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Visa status</label>
          <input
            name="visaStatus"
            defaultValue={p.workAuthorization.visaStatus ?? ""}
            placeholder="e.g. F-1 OPT"
            className={inputCls}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-6 text-sm text-zinc-700">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="authorizedToWorkInUS"
            defaultChecked={p.workAuthorization.authorizedToWorkInUS}
          />
          Authorized to work in the U.S.
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="requiresSponsorship"
            defaultChecked={p.workAuthorization.requiresSponsorship}
          />
          Will require sponsorship (now or in the future)
        </label>
      </div>

      <div className="mt-4">
        <label className={labelCls}>Professional summary</label>
        <textarea name="summary" rows={3} defaultValue={p.summary ?? ""} className={inputCls} />
      </div>

      <div className="mt-4">
        <label className={labelCls}>Skills (comma separated)</label>
        <input name="skills" defaultValue={p.skills.join(", ")} className={inputCls} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <label className={labelCls}>Work history (JSON)</label>
          <textarea
            name="workHistory"
            rows={10}
            defaultValue={JSON.stringify(p.workHistory, null, 2)}
            className={`${inputCls} font-mono text-xs`}
          />
        </div>
        <div>
          <label className={labelCls}>Education (JSON)</label>
          <textarea
            name="education"
            rows={10}
            defaultValue={JSON.stringify(p.education, null, 2)}
            className={`${inputCls} font-mono text-xs`}
          />
        </div>
      </div>

      <div className="mt-5">
        <button type="submit" disabled={pending} className={buttonCls}>
          {pending ? "Saving…" : "Save profile"}
        </button>
        <StatusLine state={state} />
      </div>
    </form>
  );
}

export function KnowledgeBase({ entries }: { entries: string[] }) {
  const [addState, addAction, addPending] = useActionState(addKnowledgeAction, INITIAL);
  const [, removeAction] = useActionState(removeKnowledgeAction, INITIAL);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5">
      <h2 className="font-semibold text-zinc-900">Knowledge base</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Facts and preferences the AI can use when answering screening questions — e.g.
        &ldquo;I can start within 2 weeks&rdquo;, &ldquo;I prefer remote but am open to hybrid in
        Austin&rdquo;, &ldquo;My strongest project is X, where I did Y&rdquo;.
      </p>

      {entries.length > 0 && (
        <ul className="mt-4 space-y-2">
          {entries.map((entry, i) => (
            <li
              key={i}
              className="flex items-start justify-between gap-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
            >
              <span>{entry}</span>
              <form action={removeAction}>
                <input type="hidden" name="index" value={i} />
                <button type="submit" className="text-xs text-zinc-400 hover:text-rose-600">
                  remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={addAction} className="mt-4 flex gap-2">
        <input
          name="entry"
          placeholder="Add a fact or preference…"
          className={inputCls}
        />
        <button type="submit" disabled={addPending} className={buttonCls}>
          Add
        </button>
      </form>
      <StatusLine state={addState} />
    </div>
  );
}
