import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";

/**
 * Provider selection (July 2026):
 *  - Default: Gemini 3.6 Flash via Google AI Studio — Flash-class models are on the
 *    free tier, which comfortably covers single-user volume.
 *  - Optional: Groq (set LLM_PROVIDER=groq + GROQ_API_KEY + GROQ_MODEL) for faster
 *    open-weight models.
 */
export function hasLlmKey(): boolean {
  if (process.env.LLM_PROVIDER === "groq") return !!process.env.GROQ_API_KEY;
  return !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
}

export function getModel(): LanguageModel {
  if (process.env.LLM_PROVIDER === "groq") {
    if (!process.env.GROQ_API_KEY) {
      throw new Error("LLM_PROVIDER=groq but GROQ_API_KEY is not set");
    }
    const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
    return groq(process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile");
  }
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey",
    );
  }
  const google = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });
  return google(process.env.GEMINI_MODEL ?? "gemini-3.6-flash");
}
