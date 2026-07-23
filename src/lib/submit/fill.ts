import type { Locator, Page } from "playwright";
import type { NormalizedField } from "../ats/types";
import type { ChooseOptionFn, FieldFillReport, ResolvedAnswer } from "./types";
import {
  fillButtonGroup,
  fillCheckboxGroup,
  fillCombobox,
  fillDateInput,
  fillNativeSelect,
  fillRadioGroup,
  fillSingleCheckbox,
  fillText,
  type InteractionContext,
  type InteractionResult,
  type WidgetKind,
} from "./widgets";

/**
 * Field-fill engine: locate the widget for a field, classify it by DOM/ARIA
 * semantics, run the matching interaction handler, and report a verified
 * per-field outcome. Contains no ATS-specific branches — platform differences
 * live in the adapters (URL/schema) while widget behavior is normalized here.
 */

/** Separator between values of a multi-select answer (see answer engine). */
const MULTI_SEPARATOR = ";";

interface LocatedWidget {
  kind: WidgetKind;
  /** The interactive element (input/select/combobox). Null for group widgets. */
  control: Locator | null;
  /** The label/legend's widget container. Null when only a control was found. */
  container: Locator | null;
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
async function findControl(page: Page, field: NormalizedField): Promise<Locator | null> {
  return firstUsable([
    page.locator(`[name="${field.id}"]`),
    page.locator(`[id="${field.id}"]`),
    page.getByLabel(field.label, { exact: false }),
  ]);
}

/**
 * Widget-group container for fields whose <label for=...> does not point at a
 * real control (custom selects, radio groups, Yes/No buttons). The label and
 * the widget share an ancestor.
 */
async function findFieldContainer(page: Page, field: NormalizedField): Promise<Locator | null> {
  const labelSnippet = field.label.slice(0, 60).replace(/"/g, '\\"');
  const label = await firstUsable([
    page.locator(`label[for="${field.id}"]`),
    page.locator(`label:has-text("${labelSnippet}")`),
    page.locator(`legend:has-text("${labelSnippet}")`),
  ]);
  if (!label) return null;
  let container = label.locator("xpath=..");
  for (let depth = 0; depth < 4; depth++) {
    const widgets = container.locator(
      'input:not([type=hidden]), textarea, select, button, [role="radio"], [role="checkbox"], [role="combobox"]',
    );
    if ((await widgets.count().catch(() => 0)) > 0) return container;
    container = container.locator("xpath=..");
  }
  return null;
}

async function isCombobox(el: Locator): Promise<boolean> {
  return el.evaluate((node) => {
    const role = node.getAttribute("role");
    const auto = node.getAttribute("aria-autocomplete");
    const popup = node.getAttribute("aria-haspopup");
    return (
      role === "combobox" ||
      auto === "list" ||
      auto === "both" ||
      popup === "listbox" ||
      node.closest('[role="combobox"]') !== null
    );
  }).catch(() => false);
}

/** Classify a located control by its DOM semantics. */
async function classifyControl(
  page: Page,
  control: Locator,
  field: NormalizedField,
): Promise<LocatedWidget> {
  const tag = (await control.evaluate((el) => el.tagName).catch(() => "")).toLowerCase();

  if (tag === "select") return { kind: "native_select", control, container: null };
  if (tag === "textarea") return { kind: "textarea", control, container: null };

  if (tag === "input") {
    const type = ((await control.getAttribute("type")) ?? "text").toLowerCase();
    if (type === "file") return { kind: "file", control, container: null };
    if (type === "date") return { kind: "date_input", control, container: null };
    if (type === "checkbox") {
      const container = await findFieldContainer(page, field);
      if (container && field.options.length > 1) {
        const boxes = await container.locator('input[type="checkbox"]').count().catch(() => 0);
        if (boxes > 1) return { kind: "checkbox_group", control, container };
      }
      return { kind: "single_checkbox", control, container };
    }
    if (type === "radio") {
      const container = await findFieldContainer(page, field);
      return { kind: "radio_group", control, container };
    }
    if (await isCombobox(control)) return { kind: "combobox", control, container: null };
    if (field.type === "date") return { kind: "date_input", control, container: null };
    return { kind: "text", control, container: null };
  }

  if (await isCombobox(control)) return { kind: "combobox", control, container: null };
  return { kind: "unknown", control, container: null };
}

/** Classify a label-anchored container by the widgets it holds. */
async function classifyContainer(
  container: Locator,
  field: NormalizedField,
): Promise<LocatedWidget> {
  const count = async (sel: string) => container.locator(sel).count().catch(() => 0);

  if ((await count('input[type="radio"], [role="radio"]')) > 0) {
    return { kind: "radio_group", control: null, container };
  }
  const checkboxes = await count('input[type="checkbox"], [role="checkbox"]');
  if (checkboxes > 1) return { kind: "checkbox_group", control: null, container };
  if (checkboxes === 1) {
    return {
      kind: "single_checkbox",
      control: container.locator('input[type="checkbox"], [role="checkbox"]').first(),
      container,
    };
  }
  if ((await count("select")) > 0) {
    return { kind: "native_select", control: container.locator("select").first(), container };
  }
  const combo = container
    .locator('[role="combobox"], input[aria-autocomplete="list"], input[aria-autocomplete="both"], input[aria-haspopup="listbox"]')
    .first();
  if ((await combo.count().catch(() => 0)) > 0) {
    return { kind: "combobox", control: combo, container };
  }
  const inner = container.locator("input:not([type=hidden]):not([type=file]), textarea").first();
  if ((await inner.count().catch(() => 0)) > 0) {
    const type = ((await inner.getAttribute("type").catch(() => null)) ?? "text").toLowerCase();
    if (type === "date" || field.type === "date") {
      return { kind: "date_input", control: inner, container };
    }
    const tag = (await inner.evaluate((el) => el.tagName).catch(() => "input")).toLowerCase();
    return { kind: tag === "textarea" ? "textarea" : "text", control: inner, container };
  }
  if ((await count('button, [role="button"]')) > 0) {
    return { kind: "button_group", control: null, container };
  }
  return { kind: "unknown", control: null, container };
}

async function locateWidget(page: Page, field: NormalizedField): Promise<LocatedWidget | null> {
  const control = await findControl(page, field);
  if (control) {
    const classified = await classifyControl(page, control, field);
    if (classified.kind !== "unknown") return classified;
  }
  const container = await findFieldContainer(page, field);
  if (container) {
    const classified = await classifyContainer(container, field);
    if (classified.kind !== "unknown") return classified;
  }
  return control ? { kind: "unknown", control, container: null } : null;
}

/** Desired values for a field: labels preferred, split for multi-selects. */
function wantedValues(answer: ResolvedAnswer): { wanted: string[]; fallback: string[] } {
  const label = answer.valueLabel ?? answer.value;
  const split = (s: string) =>
    answer.field.type === "multi_select"
      ? s.split(MULTI_SEPARATOR).map((p) => p.trim()).filter(Boolean)
      : [s.trim()];
  let wanted = split(label);
  const fallback = split(answer.value);

  // Boolean widgets want a bare Yes/No even when the answer is a full sentence.
  if (answer.field.type === "boolean") {
    if (/^(y|true|1)/i.test(wanted[0] ?? "")) wanted = ["Yes"];
    else if (/^(n|false|0)/i.test(wanted[0] ?? "")) wanted = ["No"];
  }
  return { wanted, fallback };
}

/** Widget kinds where only committing a rendered option counts as success. */
function requiresOptionCommit(field: NormalizedField): boolean {
  return (
    field.type === "select" ||
    field.type === "multi_select" ||
    field.type === "location" ||
    field.options.length > 0
  );
}

export interface FillFieldOptions {
  page: Page;
  answer: ResolvedAnswer;
  chooseOption?: ChooseOptionFn;
}

export async function fillField({ page, answer, chooseOption }: FillFieldOptions): Promise<FieldFillReport> {
  const { field } = answer;
  const base = { fieldId: field.id, label: field.label };

  if (field.type === "file") {
    return { ...base, status: "skipped", strategy: null, committed: null, detail: "file field (handled separately)" };
  }

  const { wanted, fallback } = wantedValues(answer);
  if (wanted.length === 0) {
    return { ...base, status: "skipped", strategy: null, committed: null, detail: "no answer value" };
  }

  const located = await locateWidget(page, field);
  if (!located) {
    return { ...base, status: "failed", strategy: null, committed: null, detail: "widget not found on page" };
  }

  const ctx: InteractionContext = {
    page,
    wanted,
    fallbackValues: fallback,
    chooseOption,
    fieldLabel: field.label,
    requiresOptionCommit: requiresOptionCommit(field),
  };

  try {
    const result = await dispatch(located, ctx);
    return {
      ...base,
      status: result.ok ? "filled" : "failed",
      strategy: result.strategy,
      committed: result.committed,
      detail: result.detail ?? null,
    };
  } catch (e) {
    return {
      ...base,
      status: "failed",
      strategy: located.kind,
      committed: null,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

async function dispatch(located: LocatedWidget, ctx: InteractionContext): Promise<InteractionResult> {
  const { kind, control, container } = located;
  switch (kind) {
    case "native_select":
      return fillNativeSelect(control!, ctx);
    case "combobox":
      return fillCombobox(control!, container, ctx);
    case "radio_group":
      return fillRadioGroup(container ?? control!.locator("xpath=../.."), ctx);
    case "checkbox_group":
      return fillCheckboxGroup(container!, ctx);
    case "single_checkbox":
      return fillSingleCheckbox(control!, ctx);
    case "button_group":
      return fillButtonGroup(container!, ctx);
    case "date_input":
      return fillDateInput(control!, ctx);
    case "text":
    case "textarea":
      return fillText(control!, ctx.wanted.join("; "));
    case "file":
      return { ok: false, strategy: "file", committed: null, detail: "file fields are handled separately" };
    case "unknown":
    default: {
      // Last resort: a container with buttons (Ashby Yes/No) or an inner input.
      if (container) return fillButtonGroup(container, ctx);
      return { ok: false, strategy: "unknown", committed: null, detail: "unrecognized widget" };
    }
  }
}
