import type { Locator, Page } from "playwright";
import { bestOption, CONFIDENT_MATCH, looselyContains, normalizeText, scoreOption } from "./match";
import type { ChooseOptionFn } from "./types";

/**
 * Widget interaction handlers.
 *
 * Every handler follows the same contract:
 *   1. interact with the widget the way a human would (open it, type, wait for
 *      real options to render, click an actual option — never blind key presses),
 *   2. VERIFY the widget committed the value by reading its state back,
 *   3. return an InteractionResult that says exactly what happened.
 *
 * Handlers are keyed on DOM/ARIA semantics, not on the ATS platform, so a new
 * job board that uses standard widget patterns works with zero new code.
 */

export type WidgetKind =
  | "text"
  | "textarea"
  | "native_select"
  | "combobox"
  | "radio_group"
  | "checkbox_group"
  | "single_checkbox"
  | "button_group"
  | "date_input"
  | "file"
  | "unknown";

export interface InteractionResult {
  ok: boolean;
  /** Human-readable interaction path taken, for the per-field report. */
  strategy: string;
  /** Widget state read back after the interaction; null when unverifiable. */
  committed: string | null;
  detail?: string;
}

export interface InteractionContext {
  page: Page;
  /** Desired values — one entry normally, several for multi-selects. */
  wanted: string[];
  /** Raw submit values, used as secondary match text (option value vs label). */
  fallbackValues: string[];
  /** When an option list is ambiguous, ask (usually an LLM) to pick. */
  chooseOption?: ChooseOptionFn;
  fieldLabel: string;
  /** True when the field semantically requires committing a rendered option. */
  requiresOptionCommit: boolean;
}

const fail = (strategy: string, detail: string): InteractionResult => ({
  ok: false,
  strategy,
  committed: null,
  detail,
});

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/** Accessible-ish name for radios/checkboxes/buttons without relying on getByRole. */
export async function accessibleName(loc: Locator): Promise<string> {
  return loc
    .evaluate((el) => {
      const aria = el.getAttribute("aria-label");
      if (aria?.trim()) return aria.trim();
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim();
        if (text) return text;
      }
      const input = el as HTMLInputElement;
      if (input.labels && input.labels.length > 0) {
        const text = input.labels[0].textContent?.trim();
        if (text) return text;
      }
      const wrapping = el.closest("label");
      if (wrapping) return wrapping.textContent?.trim() ?? "";
      return el.textContent?.trim() ?? "";
    })
    .catch(() => "");
}

interface RenderedOption {
  el: Locator;
  text: string;
}

const OPTION_PLACEHOLDER = /^(loading|searching|no (results|options|matches)|start typing|type to search)/i;

/**
 * Wait for a dropdown's options to actually render, then harvest them.
 * Polls until the visible option list is non-empty and stable across two polls
 * (typeaheads repopulate as results stream in), up to the deadline.
 */
export async function harvestOptions(page: Page, timeoutMs = 5_000): Promise<RenderedOption[]> {
  const deadline = Date.now() + timeoutMs;
  let last: RenderedOption[] = [];
  let lastSignature = "";
  while (Date.now() < deadline) {
    const found: RenderedOption[] = [];
    const candidates = page.locator('[role="option"], [role="listbox"] li');
    const count = Math.min(await candidates.count().catch(() => 0), 100);
    for (let i = 0; i < count; i++) {
      const el = candidates.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const text = (await el.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      if (text && !OPTION_PLACEHOLDER.test(text)) found.push({ el, text });
    }
    const signature = found.map((f) => f.text).join("|");
    if (found.length > 0 && signature === lastSignature) return found;
    last = found;
    lastSignature = signature;
    await page.waitForTimeout(250);
  }
  return last;
}

/**
 * Pick the best rendered option for `want`. Falls back to the injected
 * chooser (LLM) when the deterministic score is not confident.
 */
async function pickRenderedOption(
  ctx: InteractionContext,
  want: string,
  fallbackValue: string | undefined,
  options: RenderedOption[],
): Promise<{ option: RenderedOption; how: string } | null> {
  const texts = options.map((o) => o.text);
  const byLabel = bestOption(want, texts);
  const byValue = fallbackValue ? bestOption(fallbackValue, texts) : null;
  const best = (byValue?.score ?? 0) > (byLabel?.score ?? 0) ? byValue : byLabel;

  if (best && best.score >= CONFIDENT_MATCH) {
    return { option: options[best.index], how: `matched "${texts[best.index]}"` };
  }

  if (ctx.chooseOption && texts.length > 0) {
    const chosen = await ctx
      .chooseOption({ fieldLabel: ctx.fieldLabel, want, options: texts.slice(0, 40) })
      .catch(() => null);
    if (chosen) {
      const idx = texts.findIndex((t) => normalizeText(t) === normalizeText(chosen));
      if (idx >= 0) return { option: options[idx], how: `llm chose "${texts[idx]}"` };
    }
  }

  if (best && best.score > 0.35) {
    return { option: options[best.index], how: `weak match "${texts[best.index]}" (${best.score.toFixed(2)})` };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Text / textarea                                                     */
/* ------------------------------------------------------------------ */

export async function fillText(control: Locator, value: string): Promise<InteractionResult> {
  await control.fill(value);
  const committed = await control.inputValue().catch(() => null);
  if (committed !== null && committed.trim() === value.trim()) {
    return { ok: true, strategy: "text: fill", committed };
  }
  return fail("text: fill", `value did not stick (read back: ${JSON.stringify(committed)})`);
}

/* ------------------------------------------------------------------ */
/* Native <select>                                                     */
/* ------------------------------------------------------------------ */

export async function fillNativeSelect(
  control: Locator,
  ctx: InteractionContext,
): Promise<InteractionResult> {
  const strategy = "native select";
  const options: { label: string; value: string }[] = await control.evaluate((el) =>
    Array.from((el as HTMLSelectElement).options).map((o) => ({
      label: (o.label || o.text || "").trim(),
      value: o.value,
    })),
  );
  const labels = options.map((o) => o.label);

  const chosenValues: string[] = [];
  const chosenLabels: string[] = [];
  for (let i = 0; i < ctx.wanted.length; i++) {
    const want = ctx.wanted[i];
    const byLabel = bestOption(want, labels);
    const byValue = bestOption(ctx.fallbackValues[i] ?? "", options.map((o) => o.value));
    const pick =
      byLabel && byLabel.score >= CONFIDENT_MATCH
        ? options[byLabel.index]
        : byValue && byValue.score >= 0.99
          ? options[byValue.index]
          : byLabel && byLabel.score > 0.35
            ? options[byLabel.index]
            : null;
    if (!pick) return fail(strategy, `no option matched "${want}" among: ${labels.join(", ")}`);
    chosenValues.push(pick.value);
    chosenLabels.push(pick.label);
  }

  const multiple = await control.evaluate((el) => (el as HTMLSelectElement).multiple);
  await control.selectOption(multiple ? chosenValues : chosenValues.slice(0, 1));

  const committed: string = await control.evaluate((el) =>
    Array.from((el as HTMLSelectElement).selectedOptions)
      .map((o) => (o.label || o.text || "").trim())
      .join("; "),
  );
  const allCommitted = chosenLabels
    .slice(0, multiple ? undefined : 1)
    .every((l) => looselyContains(committed, l));
  return allCommitted
    ? { ok: true, strategy, committed }
    : fail(strategy, `selected "${committed}" but wanted "${chosenLabels.join("; ")}"`);
}

/* ------------------------------------------------------------------ */
/* Combobox / typeahead (Ashby location, react-select, downshift, ...) */
/* ------------------------------------------------------------------ */

/** Progressive queries: full text, then before-comma segment, then first word. */
function typeaheadQueries(want: string): string[] {
  const queries = [want];
  const beforeComma = want.split(",")[0].trim();
  if (beforeComma && beforeComma !== want) queries.push(beforeComma);
  const firstWord = want.split(/\s+/)[0].trim();
  if (firstWord && !queries.includes(firstWord)) queries.push(firstWord);
  return queries;
}

async function typingTarget(control: Locator): Promise<Locator | null> {
  const tag = await control.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
  if (tag === "input" || tag === "textarea") return control;
  const inner = control.locator("input:not([type=hidden]), textarea").first();
  return (await inner.count().catch(() => 0)) > 0 ? inner : null;
}

async function clearInput(input: Locator): Promise<void> {
  await input.fill("").catch(async () => {
    await input.click().catch(() => {});
    await input.press("ControlOrMeta+a").catch(() => {});
    await input.press("Delete").catch(() => {});
  });
}

/**
 * Fill a combobox by typing a query, waiting for suggestions to render, and
 * clicking the best-matching one. Selecting from the rendered list is what
 * commits the value for widgets that reject free text (Ashby location, etc.).
 */
export async function fillCombobox(
  control: Locator,
  scope: Locator | null,
  ctx: InteractionContext,
): Promise<InteractionResult> {
  const { page } = ctx;
  const strategy = "combobox";
  const input = await typingTarget(control);
  const typeable =
    input !== null &&
    (await input.evaluate((el) => !(el as HTMLInputElement).readOnly).catch(() => false));

  // Committed values often render outside the input (react-select single-value
  // divs, multi-select chips) — verify against an enclosing scope.
  let verifyScope = scope;
  if (!verifyScope) {
    const ancestor = control.locator("xpath=ancestor::*[3]");
    verifyScope = (await ancestor.count().catch(() => 0)) > 0 ? ancestor : control.locator("xpath=..");
  }

  const committedParts: string[] = [];
  for (let i = 0; i < ctx.wanted.length; i++) {
    const want = ctx.wanted[i];
    let picked: { option: RenderedOption; how: string } | null = null;

    const queries = typeable ? typeaheadQueries(want) : [null];
    for (const query of queries) {
      if (typeable && input && query !== null) {
        await clearInput(input);
        await input.click().catch(() => {});
        await input.pressSequentially(query, { delay: 25 }).catch(async () => {
          await input.fill(query).catch(() => {});
        });
      } else {
        // Select-only combobox: clicking opens the full option list.
        await control.click().catch(() => {});
      }
      const options = await harvestOptions(page);
      if (options.length === 0) {
        // Free-text fields with an optional suggestion list: no point retrying
        // shorter queries, the typed text itself is the answer.
        if (!ctx.requiresOptionCommit) break;
        continue;
      }
      picked = await pickRenderedOption(ctx, want, ctx.fallbackValues[i], options);
      if (picked) break;
    }

    if (!picked) {
      if (!ctx.requiresOptionCommit && typeable && input) {
        // Free-text field with an optional suggestion list: typed text is valid.
        await clearInput(input);
        await input.fill(want).catch(() => {});
        await page.keyboard.press("Escape").catch(() => {});
        const committed = await input.inputValue().catch(() => "");
        if (committed.trim() === want.trim()) {
          return { ok: true, strategy: `${strategy}: typed free text (no matching suggestion)`, committed };
        }
      }
      await page.keyboard.press("Escape").catch(() => {});
      return fail(strategy, `no rendered suggestion matched "${want}"`);
    }

    const chosenText = picked.option.text;
    await picked.option.el.click();
    await page.waitForTimeout(300);

    // Verify the widget committed the selection: the input value or the
    // widget's visible text must now reflect the chosen option.
    const inputValue = input ? (await input.inputValue().catch(() => "")).trim() : "";
    const scopeText = (await verifyScope.innerText().catch(() => "")).replace(/\s+/g, " ");
    const committedHere =
      inputValue && scoreOption(inputValue, chosenText) >= 0.4
        ? inputValue
        : looselyContains(scopeText, chosenText)
          ? chosenText
          : null;
    if (!committedHere) {
      await page.keyboard.press("Escape").catch(() => {});
      return fail(strategy, `clicked "${chosenText}" but the widget did not commit it`);
    }
    committedParts.push(committedHere);
  }

  await ctx.page.keyboard.press("Escape").catch(() => {});
  return { ok: true, strategy, committed: committedParts.join("; ") };
}

/* ------------------------------------------------------------------ */
/* Radio groups / checkbox groups                                      */
/* ------------------------------------------------------------------ */

async function labeledInputs(
  container: Locator,
  selector: string,
): Promise<{ el: Locator; name: string }[]> {
  const items = container.locator(selector);
  const count = Math.min(await items.count().catch(() => 0), 60);
  const out: { el: Locator; name: string }[] = [];
  for (let i = 0; i < count; i++) {
    const el = items.nth(i);
    const name = await accessibleName(el);
    if (name) out.push({ el, name });
  }
  return out;
}

async function setChecked(el: Locator): Promise<boolean> {
  await el.check({ force: true }).catch(async () => {
    await el.click({ force: true }).catch(() => {});
  });
  const checked = await el
    .isChecked()
    .catch(async () => (await el.getAttribute("aria-checked")) === "true");
  return checked === true;
}

export async function fillRadioGroup(
  container: Locator,
  ctx: InteractionContext,
): Promise<InteractionResult> {
  const strategy = "radio group";
  const radios = await labeledInputs(container, 'input[type="radio"], [role="radio"]');
  if (radios.length === 0) return fail(strategy, "no radios found in container");

  const want = ctx.wanted[0];
  const names = radios.map((r) => r.name);
  const match = bestOption(want, names);
  if (!match || match.score < 0.35) {
    return fail(strategy, `no radio label matched "${want}" among: ${names.join(", ")}`);
  }
  const chosen = radios[match.index];
  const checked = await setChecked(chosen.el);
  return checked
    ? { ok: true, strategy, committed: chosen.name }
    : fail(strategy, `clicked "${chosen.name}" but it did not become checked`);
}

export async function fillCheckboxGroup(
  container: Locator,
  ctx: InteractionContext,
): Promise<InteractionResult> {
  const strategy = "checkbox group";
  const boxes = await labeledInputs(container, 'input[type="checkbox"], [role="checkbox"]');
  if (boxes.length === 0) return fail(strategy, "no checkboxes found in container");

  const names = boxes.map((b) => b.name);
  const committed: string[] = [];
  for (const want of ctx.wanted) {
    const match = bestOption(want, names);
    if (!match || match.score < 0.35) {
      return fail(strategy, `no checkbox label matched "${want}" among: ${names.join(", ")}`);
    }
    const chosen = boxes[match.index];
    const checked = await setChecked(chosen.el);
    if (!checked) return fail(strategy, `clicked "${chosen.name}" but it did not become checked`);
    committed.push(chosen.name);
  }
  return { ok: true, strategy, committed: committed.join("; ") };
}

export async function fillSingleCheckbox(
  control: Locator,
  ctx: InteractionContext,
): Promise<InteractionResult> {
  const strategy = "single checkbox";
  const negative = /^(no|false|0|decline)/i.test(ctx.wanted[0] ?? "");
  if (negative) {
    await control.uncheck({ force: true }).catch(() => {});
    const checked = await control.isChecked().catch(() => false);
    return checked
      ? fail(strategy, "could not uncheck")
      : { ok: true, strategy, committed: "unchecked" };
  }
  const checked = await setChecked(control);
  return checked
    ? { ok: true, strategy, committed: "checked" }
    : fail(strategy, "could not check");
}

/* ------------------------------------------------------------------ */
/* Button groups (Ashby-style Yes/No toggle buttons)                   */
/* ------------------------------------------------------------------ */

export async function fillButtonGroup(
  container: Locator,
  ctx: InteractionContext,
): Promise<InteractionResult> {
  const strategy = "button group";
  const buttons = container.locator('button, [role="button"]');
  const count = Math.min(await buttons.count().catch(() => 0), 20);
  const items: { el: Locator; name: string }[] = [];
  for (let i = 0; i < count; i++) {
    const el = buttons.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const name = (await el.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (name) items.push({ el, name });
  }
  if (items.length === 0) return fail(strategy, "no buttons found in container");

  const want = ctx.wanted[0];
  const match = bestOption(want, items.map((i) => i.name));
  // High bar: misclicking a random button (e.g. "Upload file") is worse than skipping.
  if (!match || match.score < 0.7) {
    return fail(strategy, `no button matched "${want}" among: ${items.map((i) => i.name).join(", ")}`);
  }
  const chosen = items[match.index];
  await chosen.el.click();

  const pressed = await chosen.el
    .evaluate((el) => {
      const aria = el.getAttribute("aria-pressed") ?? el.getAttribute("aria-checked");
      if (aria !== null) return aria === "true";
      const state = el.getAttribute("data-state") ?? el.getAttribute("data-selected");
      if (state !== null) return state === "on" || state === "true" || state === "checked" || state === "selected";
      return null; // unverifiable
    })
    .catch(() => null);
  if (pressed === false) return fail(strategy, `clicked "${chosen.name}" but it did not toggle on`);
  return {
    ok: true,
    strategy: pressed === null ? `${strategy} (state unverifiable)` : strategy,
    committed: pressed === null ? null : chosen.name,
  };
}

/* ------------------------------------------------------------------ */
/* Date inputs                                                         */
/* ------------------------------------------------------------------ */

export function parseDateAnswer(raw: string): Date | null {
  const s = raw.trim();
  // Numeric M/D/Y first — Date.parse would treat 2-digit years oddly.
  const mdy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (mdy) return new Date(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2]));
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDate(d: Date, template: string): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  const t = template.toUpperCase();
  if (t.includes("YYYY-MM-DD")) return `${yyyy}-${mm}-${dd}`;
  if (t.startsWith("DD")) return `${dd}/${mm}/${yyyy}`;
  return `${mm}/${dd}/${yyyy}`;
}

export async function fillDateInput(
  control: Locator,
  ctx: InteractionContext,
): Promise<InteractionResult> {
  const strategy = "date input";
  const date = parseDateAnswer(ctx.wanted[0] ?? "");
  if (!date) return fail(strategy, `could not parse "${ctx.wanted[0]}" as a date`);

  const type = (await control.getAttribute("type").catch(() => null)) ?? "text";
  if (type === "date") {
    const iso = formatDate(date, "YYYY-MM-DD");
    await control.fill(iso);
    const committed = await control.inputValue().catch(() => "");
    return committed === iso
      ? { ok: true, strategy: `${strategy} (native)`, committed }
      : fail(strategy, `value did not stick (read back: ${committed})`);
  }

  const placeholder = (await control.getAttribute("placeholder").catch(() => null)) ?? "MM/DD/YYYY";
  const formatted = formatDate(date, placeholder);
  await clearInput(control);
  await control.click().catch(() => {});
  // Masked inputs need real keystrokes, not a programmatic value set.
  await control.pressSequentially(formatted, { delay: 30 }).catch(async () => {
    await control.fill(formatted).catch(() => {});
  });
  await ctx.page.keyboard.press("Escape").catch(() => {}); // close any calendar popup
  const committed = (await control.inputValue().catch(() => "")).trim();
  const digits = (s: string) => s.replace(/\D/g, "");
  return digits(committed) === digits(formatted)
    ? { ok: true, strategy, committed }
    : fail(strategy, `typed "${formatted}" but input holds "${committed}"`);
}
