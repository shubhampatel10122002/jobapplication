import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import type { JobRef } from "../ats/types";
import type { ResolvedAnswer, SubmissionInput, SubmissionResult } from "./types";

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
  'button:has-text("Submit")',
];

const CONFIRMATION_URL =
  /confirmation|thanks?|thank-you|success|submitted|complete|received|done|appl(y|ication).*(sent|received)/i;

const CONFIRMATION_TEXT =
  /(thank(s| you).{0,40}appl|we('ve| have) received.{0,40}appl|application (has been |was )?(submitted|received|sent)|successfully submitted|your application (is|was) (in|submitted)|application received)/i;

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

async function firstUsable(candidates: Locator[]): Promise<Locator | null> {
  for (const cand of candidates) {
    try {
      const first = cand.first();
      if ((await first.count()) > 0 && (await first.isVisible().catch(() => false))) {
        return first;
      }
    } catch {
      // invalid selector — keep trying
    }
  }
  return null;
}

/** Direct form control: by ATS-native name/id, or by accessible label. */
async function findControl(page: Page, answer: ResolvedAnswer): Promise<Locator | null> {
  const { field } = answer;
  return firstUsable([
    page.locator(`[name="${field.id}"]`),
    page.locator(`[id="${field.id}"]`),
    page.getByLabel(field.label, { exact: false }),
  ]);
}

/**
 * Widget-group container for fields whose <label for=...> does not point at a real
 * control (Ashby booleans/radios/selects). The label and the widget share a parent.
 */
async function findFieldContainer(page: Page, answer: ResolvedAnswer): Promise<Locator | null> {
  const { field } = answer;
  const labelSnippet = field.label.slice(0, 60).replace(/"/g, '\\"');
  const label = await firstUsable([
    page.locator(`label[for="${field.id}"]`),
    page.locator(`label:has-text("${labelSnippet}")`),
    page.locator(`legend:has-text("${labelSnippet}")`),
  ]);
  if (!label) return null;
  // Walk up from the label until an ancestor contains an interactive widget.
  let container = label.locator("xpath=..");
  for (let depth = 0; depth < 4; depth++) {
    const widgets = container.locator(
      'input:not([type=hidden]), textarea, select, button, [role="radio"], [role="combobox"]',
    );
    if ((await widgets.count().catch(() => 0)) > 0) return container;
    container = container.locator("xpath=..");
  }
  return null;
}

async function pickComboOption(page: Page, text: string): Promise<void> {
  await page.waitForTimeout(600);
  const option = page.getByRole("option", { name: text, exact: false }).first();
  if ((await option.count()) > 0 && (await option.isVisible().catch(() => false))) {
    await option.click();
  } else {
    await page.keyboard.press("Enter");
  }
}

function displayText(answer: ResolvedAnswer): string {
  return (answer.valueLabel ?? answer.value).trim();
}

function bareYesNo(answer: ResolvedAnswer): "Yes" | "No" | null {
  const text = displayText(answer);
  if (/^(y|yes|true|1)$/i.test(text) || (/^y/i.test(text) && answer.field.type === "boolean")) {
    return "Yes";
  }
  if (/^(n|no|false|0)$/i.test(text) || (/^n/i.test(text) && answer.field.type === "boolean")) {
    return "No";
  }
  // Sentence answers from older LLM runs: "Yes, I am authorized..."
  if (answer.field.type === "boolean") {
    if (/\byes\b/i.test(text) && !/\bno\b/i.test(text)) return "Yes";
    if (/\bno\b/i.test(text)) return "No";
  }
  return null;
}

async function fillControl(page: Page, control: Locator, answer: ResolvedAnswer): Promise<boolean> {
  const tag = (await control.evaluate((el) => el.tagName)).toLowerCase();
  const text = displayText(answer);

  if (tag === "select") {
    try {
      await control.selectOption({ label: text });
      return true;
    } catch {
      try {
        await control.selectOption({ value: answer.value });
        return true;
      } catch {
        return false;
      }
    }
  }

  const role = await control.getAttribute("role");
  const ariaAutocomplete = await control.getAttribute("aria-autocomplete");
  if (role === "combobox" || ariaAutocomplete === "list") {
    await control.click();
    await control.fill(text).catch(async () => {
      await page.keyboard.type(text, { delay: 20 });
    });
    await pickComboOption(page, text);
    return true;
  }

  if (tag === "input" || tag === "textarea") {
    const type = (await control.getAttribute("type")) ?? "text";
    if (type === "checkbox") {
      if (/^(yes|true|1|on)$/i.test(answer.value) || bareYesNo(answer) === "Yes") {
        await control.check();
      }
      return true;
    }
    if (type === "radio") return false; // handled via container
    if (type === "date") {
      // Native date inputs want YYYY-MM-DD.
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(answer.value) ? answer.value : text;
      await control.fill(iso);
      return true;
    }
    // Don't dump Yes/No prose into a text box when this is a boolean field —
    // let the widget-group path click the real button.
    if (answer.field.type === "boolean") return false;
    await control.fill(answer.value);
    return true;
  }
  return false;
}

/** Boolean buttons, radio groups, checkboxes, custom selects inside a field container. */
async function fillWidgetGroup(
  page: Page,
  container: Locator,
  answer: ResolvedAnswer,
): Promise<boolean> {
  const yesNo = bareYesNo(answer);
  const text = yesNo ?? displayText(answer);

  const radio = container.getByRole("radio", { name: text, exact: false }).first();
  if ((await radio.count()) > 0) {
    await radio.check({ force: true }).catch(() => radio.click());
    return true;
  }
  const optionLabel = container.locator(`label:has-text("${text.replace(/"/g, '\\"')}")`).first();
  if (
    (await container.locator('input[type="radio"], input[type="checkbox"]').count()) > 0 &&
    (await optionLabel.count()) > 0
  ) {
    await optionLabel.click();
    return true;
  }

  if (answer.field.type === "boolean" || yesNo || /^(yes|no)$/i.test(text)) {
    const button = container
      .getByRole("button", { name: new RegExp(`^${text}$`, "i") })
      .first();
    if ((await button.count()) > 0) {
      await button.click();
      return true;
    }
  }

  // Consent/acknowledgement style fields: a single checkbox under the label. Check it
  // unless the answer is explicitly negative (the user reviewed the answer already).
  const checkboxes = container.locator('input[type="checkbox"]');
  if ((await checkboxes.count()) === 1 && bareYesNo(answer) !== "No") {
    await checkboxes.first().check({ force: true });
    return true;
  }

  // Date pickers: try a native date input inside the group.
  if (answer.field.type === "date") {
    const dateInput = container.locator('input[type="date"]').first();
    if ((await dateInput.count()) > 0) {
      await dateInput.fill(answer.value);
      return true;
    }
    const anyInput = container.locator("input:not([type=hidden])").first();
    if ((await anyInput.count()) > 0) {
      await anyInput.click();
      await anyInput.fill(displayText(answer));
      await page.keyboard.press("Enter").catch(() => {});
      return true;
    }
  }

  const innerInput = container.locator("input:not([type=hidden]), textarea, select").first();
  if ((await innerInput.count()) > 0 && answer.field.type !== "boolean") {
    return fillControl(page, innerInput, answer);
  }
  return false;
}

async function fillAnswer(page: Page, answer: ResolvedAnswer): Promise<boolean> {
  // Boolean / custom widgets: prefer the labeled container so we click Yes/No
  // buttons instead of typing into a nearby text control.
  if (answer.field.type === "boolean" || answer.field.type === "select" || answer.field.type === "date") {
    const container = await findFieldContainer(page, answer);
    if (container) {
      const done = await fillWidgetGroup(page, container, answer);
      if (done) return true;
    }
  }

  const control = await findControl(page, answer);
  if (control) {
    const done = await fillControl(page, control, answer);
    if (done) return true;
  }

  const container = await findFieldContainer(page, answer);
  if (container) return fillWidgetGroup(page, container, answer);
  return false;
}

async function detectConfirmation(page: Page): Promise<boolean> {
  if (CONFIRMATION_URL.test(page.url())) return true;

  const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 8_000);
  if (CONFIRMATION_TEXT.test(bodyText)) return true;

  const visible = await page
    .locator(`:text-matches("${CONFIRMATION_TEXT.source}", "i")`)
    .first()
    .isVisible()
    .catch(() => false);
  if (visible) return true;

  // SPA success: submit controls gone and no obvious validation errors left.
  const submitStillThere = await page
    .locator(SUBMIT_BUTTON_SELECTORS.join(", "))
    .first()
    .isVisible()
    .catch(() => false);
  const invalid = await page.locator('[aria-invalid="true"]').count().catch(() => 0);
  if (!submitStillThere && invalid === 0 && !/required|please (fix|complete|select)/i.test(bodyText)) {
    // Soft signal only when the page clearly changed away from an apply form heading.
    if (/application (submitted|received)|thank/i.test(bodyText)) return true;
  }
  return false;
}

export async function submitWithPlaywright(input: SubmissionInput): Promise<SubmissionResult> {
  const { job, answers, resumePath, dryRun, screenshotPath } = input;
  const filledLabels: string[] = [];
  const unfilledLabels: string[] = [];

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
    await page.goto(applyUrl(job.ref), { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2_000);

    const host = new URL(page.url()).hostname;
    if (!HOSTED_DOMAINS[job.ref.ats].test(host)) {
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return {
        status: "needs_attention",
        detail: `This company uses a custom career site (${host}) instead of the hosted ${job.ref.ats} board — apply manually.`,
        filledLabels,
        unfilledLabels,
        screenshotPath,
      };
    }

    // Resume first — some forms auto-parse it and prefill fields, which we then
    // overwrite with our own answers. File inputs are often visually hidden, so no
    // visibility check.
    if (resumePath) {
      const fileInput = page.locator('input[type="file"]').first();
      if ((await fileInput.count()) > 0) {
        await fileInput.setInputFiles(resumePath);
        filledLabels.push("Resume upload");
        await page.waitForTimeout(2_500);
        await dismissOverlays(page);
      } else {
        unfilledLabels.push("Resume upload (no file input found)");
      }
    }

    for (const answer of answers) {
      if (answer.field.type === "file") continue;
      try {
        const done = await fillAnswer(page, answer);
        (done ? filledLabels : unfilledLabels).push(answer.field.label);
      } catch {
        unfilledLabels.push(answer.field.label);
      }
    }

    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });

    if (await visibleCaptcha(page)) {
      return {
        status: "needs_attention",
        detail: "CAPTCHA detected — finish this application manually in a browser.",
        filledLabels,
        unfilledLabels,
        screenshotPath,
      };
    }

    const requiredUnfilled = answers.filter(
      (a) => a.field.required && a.field.type !== "file" && unfilledLabels.includes(a.field.label),
    );
    if (requiredUnfilled.length > 0) {
      return {
        status: "needs_attention",
        detail: `Could not fill required field(s): ${requiredUnfilled
          .map((a) => a.field.label)
          .join("; ")}`,
        filledLabels,
        unfilledLabels,
        screenshotPath,
      };
    }

    if (dryRun) {
      return {
        status: "dry_run_complete",
        detail: `Dry run: filled ${filledLabels.length} field(s), did NOT submit. Check the screenshot.`,
        filledLabels,
        unfilledLabels,
        screenshotPath,
      };
    }

    for (const sel of SUBMIT_BUTTON_SELECTORS) {
      const button = page.locator(sel).first();
      if ((await button.count()) > 0 && (await button.isVisible().catch(() => false))) {
        await button.click();
        await page
          .waitForURL(CONFIRMATION_URL, { timeout: 20_000 })
          .catch(() => page.waitForTimeout(8_000));
        const confirmed = await detectConfirmation(page);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        return confirmed
          ? {
              status: "submitted",
              detail: "Application submitted and confirmation detected.",
              filledLabels,
              unfilledLabels,
              screenshotPath,
            }
          : {
              status: "needs_attention",
              detail:
                "Submit was clicked but no confirmation was detected — verify manually via the screenshot.",
              filledLabels,
              unfilledLabels,
              screenshotPath,
            };
      }
    }
    return {
      status: "needs_attention",
      detail: "No submit button found.",
      filledLabels,
      unfilledLabels,
      screenshotPath,
    };
  } catch (e) {
    return {
      status: "failed",
      detail: e instanceof Error ? e.message : String(e),
      filledLabels,
      unfilledLabels,
      screenshotPath: null,
    };
  } finally {
    await browser.close();
  }
}
