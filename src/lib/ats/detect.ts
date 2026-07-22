import type { JobRef } from "./types";

/**
 * Detect which ATS a job URL belongs to and extract the company slug + job id.
 * Supported URL shapes:
 *   Greenhouse: https://boards.greenhouse.io/{company}/jobs/{id}
 *               https://job-boards.greenhouse.io/{company}/jobs/{id}
 *               https://boards.greenhouse.io/embed/job_app?for={company}&token={id}
 *               company sites with ?gh_jid={id} are NOT resolvable without the board slug
 *   Lever:      https://jobs.lever.co/{company}/{uuid}[/apply]
 *   Ashby:      https://jobs.ashbyhq.com/{company}/{uuid}[/application]
 */
export function detectJob(rawUrl: string): JobRef | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
    if (segments[0] === "embed") {
      const company = url.searchParams.get("for");
      const jobId = url.searchParams.get("token");
      if (company && jobId) {
        return { ats: "greenhouse", company, jobId, url: rawUrl };
      }
      return null;
    }
    const jobsIdx = segments.indexOf("jobs");
    if (segments.length >= 3 && jobsIdx === 1) {
      return {
        ats: "greenhouse",
        company: segments[0],
        jobId: segments[2],
        url: rawUrl,
      };
    }
    return null;
  }

  if (host === "jobs.lever.co") {
    if (segments.length >= 2) {
      return {
        ats: "lever",
        company: segments[0],
        jobId: segments[1],
        url: rawUrl,
      };
    }
    return null;
  }

  if (host === "jobs.ashbyhq.com") {
    if (segments.length >= 2) {
      return {
        ats: "ashby",
        company: decodeURIComponent(segments[0]),
        jobId: segments[1],
        url: rawUrl,
      };
    }
    return null;
  }

  return null;
}
