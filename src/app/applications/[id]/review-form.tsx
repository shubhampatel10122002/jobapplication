"use client";

import { useActionState } from "react";
import { saveAnswersAction, submitApplicationAction, type ActionState } from "../actions";

interface AnswerItem {
  id: number;
  fieldId: string;
  label: string;
  type: string;
  required: boolean;
  source: string;
  value: string | null;
  valueLabel: string | null;
  options: { label: string; value: string }[];
}

const INITIAL: ActionState = {};

const SOURCE_STYLES: Record<string, string> = {
  profile: "bg-sky-100 text-sky-800",
  eeo_default: "bg-violet-100 text-violet-800",
  llm: "bg-amber-100 text-amber-800",
  resume_file: "bg-sky-100 text-sky-800",
  user_edited: "bg-emerald-100 text-emerald-800",
  unresolved: "bg-rose-100 text-rose-700",
};

const inputCls =
  "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200";

function AnswerControl({ item }: { item: AnswerItem }) {
  const name = `answer_${item.id}`;
  if (item.type === "file") {
    return (
      <p className="text-sm text-zinc-500">
        {item.value ? "Resume from your profile will be uploaded." : "No file — optional."}
      </p>
    );
  }
  if (item.options.length > 0) {
    return (
      <select name={name} defaultValue={item.value ?? ""} className={inputCls}>
        <option value="">— not answered —</option>
        {item.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (item.type === "textarea") {
    return (
      <textarea name={name} rows={4} defaultValue={item.value ?? ""} className={inputCls} />
    );
  }
  return <input name={name} defaultValue={item.value ?? ""} className={inputCls} />;
}

function StatusLine({ state }: { state: ActionState }) {
  if (state.error) return <p className="text-sm text-rose-600">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-emerald-600">{state.ok}</p>;
  return null;
}

export function ReviewForm({
  applicationId,
  status,
  autoSubmit,
  answers,
}: {
  applicationId: number;
  status: string;
  autoSubmit: boolean;
  answers: AnswerItem[];
}) {
  const [saveState, saveAction, savePending] = useActionState(saveAnswersAction, INITIAL);
  const [submitState, submitAction, submitPending] = useActionState(
    submitApplicationAction,
    INITIAL,
  );
  const submitted = status === "submitted";

  return (
    <div className="mt-6 space-y-6">
      <form action={saveAction} className="rounded-lg border border-zinc-200 bg-white p-5">
        <input type="hidden" name="applicationId" value={applicationId} />
        <h2 className="font-semibold text-zinc-900">
          {submitted ? "Submitted answers" : "Review answers"}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          {submitted
            ? "These are the answers that were submitted."
            : "Every answer the agent prepared. Edit anything before submitting."}
        </p>

        <div className="mt-4 space-y-4">
          {answers.map((item) => (
            <div key={item.id}>
              <div className="mb-1 flex items-center gap-2">
                <label className="text-sm font-medium text-zinc-800">
                  {item.label}
                  {item.required && <span className="text-rose-500"> *</span>}
                </label>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    SOURCE_STYLES[item.source] ?? "bg-zinc-100 text-zinc-600"
                  }`}
                >
                  {item.source.replace(/_/g, " ")}
                </span>
              </div>
              {submitted ? (
                <p className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
                  {item.valueLabel ?? item.value ?? <em className="text-zinc-400">empty</em>}
                </p>
              ) : (
                <AnswerControl item={item} />
              )}
            </div>
          ))}
        </div>

        {!submitted && (
          <div className="mt-5 flex items-center gap-3">
            <button
              type="submit"
              disabled={savePending}
              className="rounded-lg border border-zinc-300 bg-white px-5 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
            >
              {savePending ? "Saving…" : "Save answers"}
            </button>
            <StatusLine state={saveState} />
          </div>
        )}
      </form>

      {!submitted && (
        <form action={submitAction} className="rounded-lg border border-zinc-200 bg-white p-5">
          <input type="hidden" name="applicationId" value={applicationId} />
          <h2 className="font-semibold text-zinc-900">Submit</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {autoSubmit
              ? "Live submit is ON — this fills the real form and clicks submit."
              : "Dry-run mode: the agent fills the real form and screenshots it, but does NOT submit. Unset DRY_RUN (or set AUTO_SUBMIT=1) for live submission."}
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="submit"
              disabled={submitPending}
              className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              {submitPending
                ? "Working… (30-60s)"
                : autoSubmit
                  ? "Submit application"
                  : "Dry-run fill"}
            </button>
            <StatusLine state={submitState} />
          </div>
        </form>
      )}
    </div>
  );
}
