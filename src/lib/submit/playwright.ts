import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import type { JobRef } from "../ats/types";
import { fillField } from "./fill";
import type { FieldFillReport, SubmissionInput, SubmissionResult } from "./types";

/**
 * Browser-level submission flow: navigate to the hosted apply form, upload the
 * resume, hand every answer to the semantics-driven fill engine (see fill.ts),
 * then screenshot and (unless dry-run) submit.
 *
 * The only ATS-specific knowledge here is where the hosted form lives; how
 * widgets are interacted with is fully generic.
 */

function applyUrl(ref: JobRef): string {
  switch (ref.ats) {
    case "lever":
      return `https://jobs.lever.co/${ref.company}/${ref.jobId}/apply`;
    case "ashby":
      return `https://jobs.ashbyhq.com/${encodeURIComponent(ref.company)}/${ref.jobId}/application`;
    case "greenhouse":
      // Canonical hosted board. Companies with fully custom career sites redirect
      // away from greenhouse.io — we detect that and bail to needs_attention.
      return `https://job-boards.greenhouse.io/${ref.company}/jobs/${ref.jobId}`;
  }
}

const HOSTED_DOMAINS: Record<JobRef["ats"], RegExp> = {
  greenhouse: /greenhouse\.io$/,
  lever: /lever\.co$/,
  ashby: /ashbyhq\.com$/,
};

const SUBMIT_BUTTON_SELECTORS = [
  "button#btn-submit", // Lever
  "input#submit_app", // Greenhouse classic
  'button[type="submit"]:has-text("Submit")',
  'button:has-text("Submit application")',
  'button:has-text("Submit Application")',
];

async function visibleCaptcha(page: Page): Promise<boolean> {
  // The reCAPTCHA v3 corner badge (.grecaptcha-badge) is not a challenge — invisible
  // verification happens without user interaction, so it must not block submission.
  const selectors = [
    'iframe[src*="recaptcha"]:not(.grecaptcha-badge iframe)',
    'iframe[src*="hcaptcha"]',
    'iframe[src*="turnstile"]',
    ".g-recaptcha",
    "#h-captcha",
  ];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) {
      return true;
    }
  }
  return false;
}

/** Close "we prefilled your info" style modals that block clicks after resume upload. */
async function dismissOverlays(page: Page): Promise<void> {
  const dialog = page.locator('[role="dialog"], [aria-modal="true"]').first();
  if ((await dialog.count()) === 0 || !(await dialog.isVisible().catch(() => false))) return;
  for (const sel of [
    'button[aria-label="Close"]',
    'button:has-text("Dismiss")',
    'button:has-text("Close")',
    'button:has-text("Got it")',
  ]) {
    const btn = dialog.locator(sel).first();
    if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(300);
      return;
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
}

export async function submitWithPlaywright(input: SubmissionInput): Promise<SubmissionResult> {
  const { job, answers, resumePath, dryRun, screenshotPath, chooseOption } = input;
  const fieldReports: FieldFillReport[] = [];

  const result = (
    status: SubmissionResult["status"],
    detail: string,
    screenshot: string | null = screenshotPath,
  ): SubmissionResult => ({
    status,
    detail,
    fieldReports,
    filledLabels: fieldReports.filter((r) => r.status === "filled").map((r) => r.label),
    unfilledLabels: fieldReports.filter((r) => r.status === "failed").map((r) => r.label),
    screenshotPath: screenshot,
  });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
    await page.goto(applyUrl(job.ref), { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2_000);

    const host = new URL(page.url()).hostname;
    if (!HOSTED_DOMAINS[job.ref.ats].test(host)) {
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return result(
        "needs_attention",
        `This company uses a custom career site (${host}) instead of the hosted ${job.ref.ats} board — apply manually.`,
      );
    }

    // Resume first — some forms auto-parse it and prefill fields, which we then
    // overwrite with our own answers. File inputs are often visually hidden, so no
    // visibility check.
    if (resumePath) {
      const fileInput = page.locator('input[type="file"]').first();
      if ((await fileInput.count()) > 0) {
        await fileInput.setInputFiles(resumePath);
        fieldReports.push({
          fieldId: "__resume__",
          label: "Resume upload",
          status: "filled",
          strategy: "file input",
          committed: path.basename(resumePath),
          detail: null,
        });
        await page.waitForTimeout(2_500);
        await dismissOverlays(page);
      } else {
        fieldReports.push({
          fieldId: "__resume__",
          label: "Resume upload",
          status: "failed",
          strategy: "file input",
          committed: null,
          detail: "no file input found",
        });
      }
    }

    for (const answer of answers) {
      if (answer.field.type === "file") continue;
      fieldReports.push(await fillField({ page, answer, chooseOption }));
    }

    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });

    if (await visibleCaptcha(page)) {
      return result(
        "needs_attention",
        "CAPTCHA detected — finish this application manually in a browser.",
      );
    }

    const failedById = new Set(
      fieldReports.filter((r) => r.status === "failed").map((r) => r.fieldId),
    );
    const requiredUnfilled = answers.filter(
      (a) => a.field.required && a.field.type !== "file" && failedById.has(a.field.id),
    );
    if (requiredUnfilled.length > 0) {
      const details = requiredUnfilled.map((a) => {
        const report = fieldReports.find((r) => r.fieldId === a.field.id);
        return `${a.field.label}${report?.detail ? ` (${report.detail})` : ""}`;
      });
      return result(
        "needs_attention",
        `Could not fill required field(s): ${details.join("; ")}`,
      );
    }

    if (dryRun) {
      const filled = fieldReports.filter((r) => r.status === "filled").length;
      return result(
        "dry_run_complete",
        `Dry run: filled ${filled} field(s), did NOT submit. Check the screenshot.`,
      );
    }

    for (const sel of SUBMIT_BUTTON_SELECTORS) {
      const button = page.locator(sel).first();
      if ((await button.count()) > 0 && (await button.isVisible().catch(() => false))) {
        await button.click();
        await page
          .waitForURL(/confirmation|thanks|thank/i, { timeout: 20_000 })
          .catch(() => page.waitForTimeout(8_000));
        const confirmed =
          /confirmation|thanks|thank/i.test(page.url()) ||
          (await page
            .locator(':text-matches("(application (was )?(submitted|received)|thank you for applying)", "i")')
            .first()
            .isVisible()
            .catch(() => false));
        await page.screenshot({ path: screenshotPath, fullPage: true });
        return confirmed
          ? result("submitted", "Application submitted and confirmation detected.")
          : result(
              "needs_attention",
              "Submit was clicked but no confirmation was detected — verify manually via the screenshot.",
            );
      }
    }
    return result("needs_attention", "No submit button found.");
  } catch (e) {
    return result("failed", e instanceof Error ? e.message : String(e), null);
  } finally {
    await browser.close();
  }
}
