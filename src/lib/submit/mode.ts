/**
 * Submission mode.
 *
 * Live submit is the default (production). Opt into dry-run with DRY_RUN=1
 * (or AUTO_SUBMIT=0 for backwards compatibility). AUTO_SUBMIT=1 is accepted
 * but redundant with the new default.
 */
export function isDryRun(): boolean {
  if (process.env.DRY_RUN === "1") return true;
  if (process.env.AUTO_SUBMIT === "0") return true;
  return false;
}

export function isLiveSubmit(): boolean {
  return !isDryRun();
}
