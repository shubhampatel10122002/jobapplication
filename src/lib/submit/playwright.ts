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
      return `https://job-boards.greenhouse.io/${ref.company}/jobs/${ref.jobId}`;
  }
}

const HOSTED_DOMAINS: Record<JobRef["ats"], RegExp> = {
  greenhouse: /greenhouse\.io$/,
  lever: /lever\.co$/,
  ashby: /ashbyhq\.com$/,
};

const SUBMIT_BUTTON_SELECTORS = [
  "button#btn-submit",
  "input#submit_app",
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
  const selectors = [
    'iframe[src*="recaptcha"]:not(.grecaptcha-badge iframe)',
    'iframe[src*="hcaptcha"]',
    'iframe[src*="turnstile"]',
    ".g-recaptcha",
    "#h-captcha",
  ];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) return true;
  }
  return false;
}

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
      if ((await first.count()) > 0 && (await first.isVisible().catch(() => false))) return first;
    } catch {
      // keep trying
    }
  }
  return null;
}

function displayText(answer: ResolvedAnswer): string {
  return (answer.valueLabel ?? answer.value).trim();
}

function bareYesNo(answer: ResolvedAnswer): "Yes" | "No" | null {
  const text = displayText(answer);
  if (/^(y|yes|true|1)$/i.test(text)) return "Yes";
  if (/^(n|no|false|0)$/i.test(text)) return "No";
  if (answer.field.type === "boolean") {
    if (/\byes\b/i.test(text) && !/\bno\b/i.test(text)) return "Yes";
    if (/\bno\b/i.test(text)) return "No";
  }
  return null;
}

function isSelectedButtonClass(cls: string): boolean {
  return /(?:^|_)(active|selected|checked|pressed)(?:_|$)/i.test(cls);
}

/**
 * Find the smallest ancestor of the question text that contains interactive widgets.
 * Ashby often uses plain text (not <label>) for boolean / location prompts.
 * For Yes/No, require exactly one Yes and one No in the subtree so we don't grab the whole form.
 */
async function findQuestionRoot(page: Page, answer: ResolvedAnswer): Promise<Locator | null> {
  const { field } = answer;
  const snippet = field.label.slice(0, 80).replace(/"/g, '\\"');

  const anchors = await firstUsable([
    page.locator(`label[for="${field.id}"]`),
    page.locator(`label:has-text("${snippet}")`),
    page.locator(`legend:has-text("${snippet}")`),
    page.getByText(field.label, { exact: true }),
    page.getByText(new RegExp(field.label.slice(0, 50).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")),
  ]);
  if (!anchors) return null;

  if (field.type === "boolean" || bareYesNo(answer)) {
    const yesNoRoot = anchors.locator(
      "xpath=ancestor-or-self::*[.//button[normalize-space()='Yes'] and .//button[normalize-space()='No'] and count(.//button[normalize-space()='Yes'])=1 and count(.//button[normalize-space()='No'])=1][1]",
    );
    if ((await yesNoRoot.count().catch(() => 0)) > 0) return yesNoRoot.first();
  }

  for (const xpath of [
    "xpath=ancestor-or-self::*[(.//input or .//textarea or .//select or .//*[@role='combobox']) and not(self::body) and not(self::html)][1]",
    "xpath=ancestor-or-self::*[.//button or .//input or .//*[@role='radio']][1]",
  ]) {
    const root = anchors.locator(xpath);
    if ((await root.count().catch(() => 0)) > 0) {
      const candidate = root.first();
      const inputCount = await candidate.locator("input, textarea, button").count().catch(() => 99);
      if (inputCount > 0 && inputCount <= 12) return candidate;
    }
  }
  return anchors.locator("xpath=..").first();
}

async function findControl(page: Page, answer: ResolvedAnswer): Promise<Locator | null> {
  const { field } = answer;
  const root = await findQuestionRoot(page, answer);
  return firstUsable([
    page.locator(`[name="${field.id}"]`),
    page.locator(`[id="${field.id}"]`),
    page.getByLabel(field.label, { exact: false }),
    root ? root.locator('input:not([type="hidden"]), textarea, select, [role="combobox"]').first() : page.locator(":unreachable"),
  ]);
}

async function selectAutocompleteOption(page: Page, query: string): Promise<boolean> {
  await page.waitForTimeout(700);
  const options = page.locator('[role="option"]');
  try {
    await options.first().waitFor({ state: "visible", timeout: 5_000 });
  } catch {
    return false;
  }
  const texts = await options.allTextContents();
  const normalized = query.trim().toLowerCase();
  let bestIdx = texts.findIndex((t) => t.trim().toLowerCase() === normalized);
  if (bestIdx < 0) {
    bestIdx = texts.findIndex((t) => t.trim().toLowerCase().startsWith(normalized));
  }
  if (bestIdx < 0) {
    bestIdx = texts.findIndex((t) => t.toLowerCase().includes(normalized.split(",")[0] ?? normalized));
  }
  if (bestIdx < 0) bestIdx = 0;
  await options.nth(bestIdx).click();
  await page.waitForTimeout(300);
  return true;
}

/** Type into a location/combobox and commit a dropdown option (required by Ashby). */
async function fillCombobox(page: Page, control: Locator, value: string): Promise<boolean> {
  await control.click({ clickCount: 3 }).catch(() => control.click());
  await control.fill("");
  // pressSequentially triggers Ashby/Google Places style suggestion fetches; fill() often does not.
  await control.pressSequentially(value, { delay: 35 }).catch(async () => {
    await page.keyboard.type(value, { delay: 35 });
  });
  const picked = await selectAutocompleteOption(page, value);
  if (picked) return true;
  // Fallback: keyboard commit first suggestion.
  await page.keyboard.press("ArrowDown").catch(() => {});
  await page.keyboard.press("Enter").catch(() => {});
  await page.waitForTimeout(300);
  // Consider success if the input now contains a longer structured location string.
  const current = (await control.inputValue().catch(() => "")) || "";
  return current.length >= value.length && /,/i.test(current);
}

async function fillYesNo(root: Locator, want: "Yes" | "No"): Promise<boolean> {
  const buttons = root.locator("button");
  const count = await buttons.count();
  if (count < 2) return false;

  // Prefer an exact Yes/No pair in this root (Ashby option buttons).
  const target = buttons.filter({ hasText: new RegExp(`^${want}$`, "i") }).first();
  if ((await target.count()) === 0) return false;
  await target.click();
  await root.page().waitForTimeout(200);

  const states = await buttons.evaluateAll((els) =>
    els.map((b) => ({
      text: (b.textContent || "").trim(),
      cls: b.className?.toString?.() ?? "",
      ariaPressed: b.getAttribute("aria-pressed"),
      ariaChecked: b.getAttribute("aria-checked"),
    })),
  );
  const selected = states.find(
    (s) =>
      new RegExp(`^${want}$`, "i").test(s.text) &&
      (s.ariaPressed === "true" ||
        s.ariaChecked === "true" ||
        isSelectedButtonClass(s.cls)),
  );
  if (selected) return true;
  // Some boards don't expose selected state via class — accept click if the pair exists.
  return states.some((s) => new RegExp(`^${want}$`, "i").test(s.text));
}

async function fillControl(page: Page, control: Locator, answer: ResolvedAnswer): Promise<boolean> {
  const tag = (await control.evaluate((el) => el.tagName)).toLowerCase();
  const text = displayText(answer);
  const role = await control.getAttribute("role");
  const ariaAutocomplete = await control.getAttribute("aria-autocomplete");
  const type = (await control.getAttribute("type")) ?? "text";

  if (answer.field.type === "boolean") return false;

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

  if (
    role === "combobox" ||
    ariaAutocomplete === "list" ||
    answer.field.type === "location"
  ) {
    return fillCombobox(page, control, text);
  }

  if (tag === "input" || tag === "textarea") {
    if (type === "checkbox") {
      if (bareYesNo(answer) === "Yes" || /^(yes|true|1|on)$/i.test(answer.value)) {
        await control.check();
      }
      return true;
    }
    if (type === "radio") return false;
    if (type === "date") {
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(answer.value) ? answer.value : text;
      await control.fill(iso);
      return true;
    }
    await control.fill(answer.value);
    return true;
  }
  return false;
}

async function fillWidgetGroup(
  page: Page,
  root: Locator,
  answer: ResolvedAnswer,
): Promise<boolean> {
  const yesNo = bareYesNo(answer);
  if ((answer.field.type === "boolean" || yesNo) && yesNo) {
    if (await fillYesNo(root, yesNo)) return true;
  }

  const text = yesNo ?? displayText(answer);
  const radio = root.getByRole("radio", { name: text, exact: false }).first();
  if ((await radio.count()) > 0) {
    await radio.check({ force: true }).catch(() => radio.click());
    return true;
  }

  // Native radio/checkbox wrapped in labels.
  const optionLabel = root.locator(`label:has-text("${text.replace(/"/g, '\\"')}")`).first();
  if (
    (await root.locator('input[type="radio"], input[type="checkbox"]').count()) > 0 &&
    (await optionLabel.count()) > 0
  ) {
    await optionLabel.click();
    return true;
  }

  if (answer.field.type === "location" || answer.field.type === "date") {
    const input = root.locator('input:not([type="hidden"]), [role="combobox"]').first();
    if ((await input.count()) > 0) return fillControl(page, input, answer);
  }

  // Single consent checkbox.
  const checkboxes = root.locator('input[type="checkbox"]');
  if ((await checkboxes.count()) === 1 && yesNo !== "No") {
    await checkboxes.first().check({ force: true });
    return true;
  }

  const inner = root.locator("input:not([type=hidden]), textarea, select, [role='combobox']").first();
  if ((await inner.count()) > 0 && answer.field.type !== "boolean") {
    return fillControl(page, inner, answer);
  }
  return false;
}

async function fillAnswer(page: Page, answer: ResolvedAnswer): Promise<boolean> {
  const needsWidgetFirst =
    answer.field.type === "boolean" ||
    answer.field.type === "select" ||
    answer.field.type === "multi_select" ||
    answer.field.type === "date" ||
    answer.field.type === "location";

  if (needsWidgetFirst) {
    const root = await findQuestionRoot(page, answer);
    if (root) {
      const done = await fillWidgetGroup(page, root, answer);
      if (done) return true;
    }
  }

  const control = await findControl(page, answer);
  if (control) {
    const done = await fillControl(page, control, answer);
    if (done) return true;
  }

  const root = await findQuestionRoot(page, answer);
  if (root) return fillWidgetGroup(page, root, answer);
  return false;
}

async function submitStillVisible(page: Page): Promise<boolean> {
  for (const sel of SUBMIT_BUTTON_SELECTORS) {
    const button = page.locator(sel).first();
    if ((await button.count()) > 0 && (await button.isVisible().catch(() => false))) return true;
  }
  return false;
}

async function detectConfirmation(page: Page): Promise<boolean> {
  if (CONFIRMATION_URL.test(page.url())) return true;
  const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 8_000);
  if (CONFIRMATION_TEXT.test(bodyText)) return true;
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
        await dismissOverlays(page);

        const confirmed = await detectConfirmation(page);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        if (confirmed) {
          return {
            status: "submitted",
            detail: "Application submitted and confirmation detected.",
            filledLabels,
            unfilledLabels,
            screenshotPath,
          };
        }

        if (await submitStillVisible(page)) {
          return {
            status: "needs_attention",
            detail:
              "Submit was clicked but the application form is still open (validation likely failed — often an unselected location autocomplete or Yes/No). Check the screenshot and fix the highlighted fields.",
            filledLabels,
            unfilledLabels,
            screenshotPath,
          };
        }

        return {
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
