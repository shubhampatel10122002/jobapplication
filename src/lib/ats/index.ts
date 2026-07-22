import { ashbyAdapter } from "./ashby";
import { detectJob } from "./detect";
import { greenhouseAdapter } from "./greenhouse";
import { leverAdapter } from "./lever";
import type { AtsAdapter, AtsKind, NormalizedJob } from "./types";

export const adapters: Record<AtsKind, AtsAdapter> = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
};

/** Detect the ATS from a job URL and fetch the normalized job + application form. */
export async function fetchJobFromUrl(url: string): Promise<NormalizedJob> {
  const ref = detectJob(url);
  if (!ref) {
    throw new Error(
      "Unsupported job URL. Supported: boards.greenhouse.io, jobs.lever.co, jobs.ashbyhq.com",
    );
  }
  return adapters[ref.ats].fetchJob(ref);
}

export { detectJob };
export * from "./types";
