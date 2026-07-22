import { generateObject, generateText } from "ai";
import { getModel, rateLimited } from "../llm";
import type { LlmAnswerFn, LlmQuestion } from "./engine";

function contextBlock(q: LlmQuestion): string {
  return `You are filling out a job application on behalf of a candidate. Answer truthfully,
based ONLY on the candidate profile and knowledge base below. Write in first person as
the candidate. Never invent experience, credentials, or personal details.

If the profile and knowledge base do not contain enough information to answer, reply with
exactly the single token UNKNOWN (nothing else). Do NOT write meta comments like
"not mentioned in the profile" or "I don't know".

JOB: ${q.jobTitle} at ${q.companyName}

JOB DESCRIPTION (truncated):
${q.jobDescription.slice(0, 6_000)}

CANDIDATE PROFILE (JSON):
${JSON.stringify(q.profile)}

CANDIDATE KNOWLEDGE BASE (facts and preferences stated by the candidate):
${q.knowledgeBase.length > 0 ? q.knowledgeBase.map((k) => `- ${k}`).join("\n") : "(empty)"}`;
}

/**
 * Real LLM implementation of the answer engine's LlmAnswerFn.
 * Select / boolean questions are constrained to the exact option labels via enum output.
 */
export const llmAnswer: LlmAnswerFn = async (q) => {
  if (q.optionLabels && q.optionLabels.length > 0) {
    const { object } = await rateLimited(() =>
      generateObject({
        model: getModel(),
        output: "enum",
        enum: q.optionLabels!,
        prompt: `${contextBlock(q)}

APPLICATION QUESTION (choose exactly one of the allowed options):
${q.label}

If you cannot choose from the options based on the profile, pick the safest honest option
that matches the profile (e.g. work-authorization Yes/No from workAuthorization).`,
      }),
    );
    return object;
  }

  const lengthHint =
    q.type === "textarea"
      ? "Answer in 2-6 sentences (at most ~150 words). Be specific and concrete, not generic."
      : q.type === "date"
        ? "Answer as a calendar date in YYYY-MM-DD format only (or UNKNOWN)."
        : "Answer in a single short line (a few words or a number). No full sentences unless required.";

  const { text } = await rateLimited(() =>
    generateText({
      model: getModel(),
      prompt: `${contextBlock(q)}

APPLICATION QUESTION:
${q.label}

${lengthHint}
Return ONLY the answer text itself — no preamble, no quotes, no markdown. If unknown: UNKNOWN.`,
    }),
  );
  return text.trim();
};
