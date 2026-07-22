"use client";

import { useActionState } from "react";
import { prepareApplicationAction, type ActionState } from "./applications/actions";

const INITIAL: ActionState = {};

export function PrepareButton({ url }: { url: string }) {
  const [state, action, pending] = useActionState(prepareApplicationAction, INITIAL);
  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="url" value={url} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {pending ? "Generating answers… (may take a minute)" : "Prepare application"}
      </button>
      {state.error && <p className="text-sm text-rose-600">{state.error}</p>}
    </form>
  );
}
