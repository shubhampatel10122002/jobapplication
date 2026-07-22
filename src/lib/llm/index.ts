import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";

/**
 * Provider selection (July 2026):
 *  - Default: Gemini 3.5 Flash via Google AI Studio. Note: the newest 3.6-flash has a
 *    tiny free-tier quota (20 requests/day), while 3.5-flash-class models allow
 *    ~1500/day — so 3.5 is the practical free default. Set GEMINI_MODEL to override
 *    (e.g. gemini-3.6-flash on a paid tier).
 *  - Optional: Groq (set LLM_PROVIDER=groq + GROQ_API_KEY + GROQ_MODEL) for faster
 *    open-weight models.
 */
export function hasLlmKey(): boolean {
  if (process.env.LLM_PROVIDER === "groq") return !!process.env.GROQ_API_KEY;
  return !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
}

/**
 * Serialize LLM calls with a minimum interval between starts. The Gemini free tier
 * allows only ~5 requests/minute on gemini-3.6-flash, so we default to a safe 13s
 * spacing. Set LLM_MIN_INTERVAL_MS=0 when on a paid tier or Groq.
 */
let lastCallAt = 0;
let queue: Promise<unknown> = Promise.resolve();

export function rateLimited<T>(fn: () => Promise<T>): Promise<T> {
  const defaultInterval = process.env.LLM_PROVIDER === "groq" ? 0 : 13_000;
  const minInterval = Number(process.env.LLM_MIN_INTERVAL_MS ?? defaultInterval);
  const run = queue.then(async () => {
    const wait = lastCallAt + minInterval - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
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
  return google(process.env.GEMINI_MODEL ?? "gemini-3.5-flash");
}
