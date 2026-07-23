import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NormalizedField } from "../ats/types";
import { fillField } from "./fill";
import type { ResolvedAnswer } from "./types";

/**
 * Offline integration tests for the fill engine: real Chromium, local HTML
 * fixtures replicating the widget patterns used by hosted ATS boards
 * (typeaheads that only commit on option click, Yes/No button groups, etc.).
 */

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});
beforeEach(async () => {
  await page?.close().catch(() => {});
  page = await browser.newPage();
});

function field(over: Partial<NormalizedField>): NormalizedField {
  return {
    id: "f1",
    label: "Field",
    type: "text",
    required: true,
    options: [],
    answerSource: "profile",
    section: "custom",
    ...over,
  };
}

function answer(f: NormalizedField, value: string, valueLabel: string | null = null): ResolvedAnswer {
  return { field: f, value, valueLabel };
}

/** Ashby-style location typeahead: typing shows suggestions after a delay; the
 * value is only committed when a rendered option is clicked. */
const TYPEAHEAD_FIXTURE = `
<label for="loc">Location</label>
<input id="loc" name="loc" role="combobox" aria-autocomplete="list" autocomplete="off" />
<ul id="list" role="listbox" hidden></ul>
<script>
  const CITIES = [
    "New York, New York, United States",
    "Newark, New Jersey, United States",
    "New York Mills, Minnesota, United States",
    "San Francisco, California, United States",
  ];
  const input = document.getElementById("loc");
  const list = document.getElementById("list");
  input.addEventListener("input", () => {
    setTimeout(() => {
      list.innerHTML = "";
      const q = input.value.toLowerCase();
      const matches = q ? CITIES.filter((c) => c.toLowerCase().includes(q)) : [];
      for (const m of matches) {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.textContent = m;
        li.addEventListener("click", () => {
          input.value = m;
          document.body.dataset.committed = m;
          list.hidden = true;
          list.innerHTML = "";
        });
        list.appendChild(li);
      }
      list.hidden = matches.length === 0;
    }, 150);
  });
</script>`;

describe("fillField", () => {
  it("selects a location typeahead suggestion by clicking a rendered option", async () => {
    await page.setContent(TYPEAHEAD_FIXTURE);
    const report = await fillField({
      page,
      answer: answer(field({ id: "loc", label: "Location", type: "location" }), "New York, NY"),
    });
    expect(report.status).toBe("filled");
    // The commit only happens through the option's click handler.
    const committed = await page.evaluate(() => document.body.dataset.committed);
    expect(committed).toBe("New York, New York, United States");
  }, 60_000);

  it("fails (instead of pretending) when a typeahead has no matching suggestion", async () => {
    await page.setContent(TYPEAHEAD_FIXTURE);
    const report = await fillField({
      page,
      answer: answer(field({ id: "loc", label: "Location", type: "location" }), "Atlantis Under The Sea"),
    });
    expect(report.status).toBe("failed");
    const committed = await page.evaluate(() => document.body.dataset.committed);
    expect(committed).toBeUndefined();
  }, 60_000);

  it("accepts typed free text when suggestions never render for a text field", async () => {
    await page.setContent(`
      <label for="company">Current company</label>
      <input id="company" name="company" aria-autocomplete="list" autocomplete="off" />
    `);
    const report = await fillField({
      page,
      answer: answer(field({ id: "company", label: "Current company", type: "text" }), "Acme Corp"),
    });
    expect(report.status).toBe("filled");
    expect(await page.inputValue("#company")).toBe("Acme Corp");
  }, 60_000);

  it("fills a native select by best label match", async () => {
    await page.setContent(`
      <label for="deg">Degree</label>
      <select id="deg" name="deg">
        <option value="">Select…</option>
        <option value="1">High School</option>
        <option value="2">Bachelor's Degree</option>
        <option value="3">Master's Degree</option>
      </select>
    `);
    const f = field({
      id: "deg",
      label: "Degree",
      type: "select",
      options: [
        { label: "High School", value: "1" },
        { label: "Bachelor's Degree", value: "2" },
        { label: "Master's Degree", value: "3" },
      ],
    });
    const report = await fillField({ page, answer: answer(f, "2", "Bachelor's Degree") });
    expect(report.status).toBe("filled");
    expect(await page.inputValue("#deg")).toBe("2");
  }, 30_000);

  it("picks the right radio in a radio group", async () => {
    await page.setContent(`
      <fieldset>
        <legend>Are you legally authorized to work in the United States?</legend>
        <label><input type="radio" name="auth" value="1"> Yes</label>
        <label><input type="radio" name="auth" value="0"> No</label>
      </fieldset>
    `);
    const f = field({
      id: "auth",
      label: "Are you legally authorized to work in the United States?",
      type: "boolean",
    });
    const report = await fillField({ page, answer: answer(f, "No") });
    expect(report.status).toBe("filled");
    expect(await page.isChecked('input[value="0"]')).toBe(true);
    expect(await page.isChecked('input[value="1"]')).toBe(false);
  }, 30_000);

  it("checks every wanted option of a multi-select checkbox group", async () => {
    await page.setContent(`
      <fieldset>
        <legend>Which languages are you proficient in?</legend>
        <label><input type="checkbox" value="ts"> TypeScript</label>
        <label><input type="checkbox" value="py"> Python</label>
        <label><input type="checkbox" value="go"> Go</label>
      </fieldset>
    `);
    const f = field({
      id: "langs",
      label: "Which languages are you proficient in?",
      type: "multi_select",
      options: [
        { label: "TypeScript", value: "ts" },
        { label: "Python", value: "py" },
        { label: "Go", value: "go" },
      ],
    });
    const report = await fillField({
      page,
      answer: answer(f, "ts; py", "TypeScript; Python"),
    });
    expect(report.status).toBe("filled");
    expect(await page.isChecked('input[value="ts"]')).toBe(true);
    expect(await page.isChecked('input[value="py"]')).toBe(true);
    expect(await page.isChecked('input[value="go"]')).toBe(false);
  }, 30_000);

  it("clicks Yes/No toggle buttons (Ashby-style boolean)", async () => {
    await page.setContent(`
      <div class="field">
        <label>Will you require visa sponsorship?</label>
        <div>
          <button type="button" aria-pressed="false"
            onclick="this.setAttribute('aria-pressed','true')">Yes</button>
          <button type="button" aria-pressed="false"
            onclick="this.setAttribute('aria-pressed','true')">No</button>
        </div>
      </div>
    `);
    const f = field({ id: "visa", label: "Will you require visa sponsorship?", type: "boolean" });
    const report = await fillField({ page, answer: answer(f, "Yes, I will require sponsorship.") });
    expect(report.status).toBe("filled");
    expect(await page.getAttribute('button:has-text("Yes")', "aria-pressed")).toBe("true");
  }, 30_000);

  it("types a formatted date into a masked date input", async () => {
    await page.setContent(`
      <label for="start">Earliest start date</label>
      <input id="start" name="start" placeholder="MM/DD/YYYY" />
    `);
    const f = field({ id: "start", label: "Earliest start date", type: "date" });
    const report = await fillField({ page, answer: answer(f, "2026-08-03") });
    expect(report.status).toBe("filled");
    expect(await page.inputValue("#start")).toBe("08/03/2026");
  }, 30_000);

  it("fills a native date input with ISO format", async () => {
    await page.setContent(`
      <label for="start">Earliest start date</label>
      <input id="start" name="start" type="date" />
    `);
    const f = field({ id: "start", label: "Earliest start date", type: "date" });
    const report = await fillField({ page, answer: answer(f, "August 3, 2026") });
    expect(report.status).toBe("filled");
    expect(await page.inputValue("#start")).toBe("2026-08-03");
  }, 30_000);

  it("checks a single consent checkbox", async () => {
    await page.setContent(`
      <div>
        <label><input type="checkbox" name="consent" id="consent"> I agree to the privacy policy</label>
      </div>
    `);
    const f = field({ id: "consent", label: "I agree to the privacy policy", type: "boolean" });
    const report = await fillField({ page, answer: answer(f, "Yes") });
    expect(report.status).toBe("filled");
    expect(await page.isChecked("#consent")).toBe(true);
  }, 30_000);

  it("fills plain text inputs and verifies the value stuck", async () => {
    await page.setContent(`
      <label for="fn">First name</label>
      <input id="fn" name="first_name" />
    `);
    const f = field({ id: "first_name", label: "First name", type: "text" });
    const report = await fillField({ page, answer: answer(f, "Jane") });
    expect(report.status).toBe("filled");
    expect(report.committed).toBe("Jane");
  }, 30_000);

  it("consults the chooseOption fallback for ambiguous suggestions", async () => {
    await page.setContent(`
      <label for="school">School</label>
      <input id="school" name="school" role="combobox" aria-autocomplete="list" />
      <ul role="listbox">
        <li role="option">Univ. of Cambridge — UK</li>
        <li role="option">Cambridge College — Boston MA</li>
      </ul>
      <script>
        document.querySelectorAll('[role="option"]').forEach((li) =>
          li.addEventListener("click", () => {
            document.getElementById("school").value = li.textContent;
          }),
        );
      </script>
    `);
    const f = field({ id: "school", label: "School", type: "select" });
    const report = await fillField({
      page,
      answer: answer(f, "MIT"),
      chooseOption: async ({ options }) => options[1],
    });
    expect(report.status).toBe("filled");
    expect(await page.inputValue("#school")).toBe("Cambridge College — Boston MA");
  }, 60_000);
});
