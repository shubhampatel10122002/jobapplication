import { generateObject } from "ai";
import { getModel, rateLimited } from "../llm";
import type { ChooseOptionFn } from "./types";

/**
 * LLM fallback for ambiguous dropdown choices. Only consulted when the
 * deterministic matcher is not confident (dynamic typeaheads whose rendered
 * suggestions differ from the planned answer text). The interaction itself
 * stays deterministic — the LLM only picks WHICH rendered option to click.
 */
export const llmChooseOption: ChooseOptionFn = async ({ fieldLabel, want, options }) => {
  if (options.length === 0) return null;
  const { object } = await rateLimited(() =>
    generateObject({
      model: getModel(),
      output: "enum",
      enum: options as [string, ...string[]],
      prompt: `A job application form field "${fieldLabel}" shows a dropdown of options.
The intended answer is: "${want}"

Pick the option that best represents the intended answer. If several are close,
pick the most specific correct one.`,
    }),
  );
  return object;
};
