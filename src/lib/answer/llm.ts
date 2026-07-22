import { generateObject, generateText } from "ai";
import { getModel } from "../llm";
import type { LlmAnswerFn, LlmQuestion } from "./engine";

function contextBlock(q: LlmQuestion): string {
  return `You are filling out a job application on behalf of a candidate. Answer truthfully,
based ONLY on the candidate profile and knowledge base below. Write in first person as
the candidate. Never invent experience, credentials, or personal details.

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
 * Select questions are constrained to the exact option labels via enum output.
 */
export const llmAnswer: LlmAnswerFn = async (q) => {
  if (q.optionLabels && q.optionLabels.length > 0) {
    const { object } = await generateObject({
      model: getModel(),
      output: "enum",
      enum: q.optionLabels,
      prompt: `${contextBlock(q)}

APPLICATION QUESTION (choose exactly one of the allowed options):
${q.label}`,
    });
    return object;
  }

  const lengthHint =
    q.type === "textarea"
      ? "Answer in 2-6 sentences (at most ~150 words). Be specific and concrete, not generic."
      : "Answer in a single short line (a few words, a number, or one sentence).";

  const { text } = await generateText({
    model: getModel(),
    prompt: `${contextBlock(q)}

APPLICATION QUESTION:
${q.label}

${lengthHint}
Return ONLY the answer text itself — no preamble, no quotes, no markdown.`,
  });
  return text.trim();
};
