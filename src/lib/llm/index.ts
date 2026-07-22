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
function activeProvider(): "groq" | "google" | null {
  if (process.env.LLM_PROVIDER === "groq") {
    return process.env.GROQ_API_KEY ? "groq" : null;
  }
  if (process.env.LLM_PROVIDER === "google") {
    return process.env.GOOGLE_GENERATIVE_AI_API_KEY ? "google" : null;
  }
  // No explicit provider: prefer Groq (better free tier: ~1000 req/day vs Gemini's
  // dynamic per-project quota), fall back to Google.
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return "google";
  return null;
}

export function hasLlmKey(): boolean {
  return activeProvider() !== null;
}

/**
 * Serialize LLM calls with a minimum interval between starts. The Gemini free tier
 * allows only ~5 requests/minute on gemini-3.6-flash, so we default to a safe 13s
 * spacing. Set LLM_MIN_INTERVAL_MS=0 when on a paid tier or Groq.
 */
let lastCallAt = 0;
let queue: Promise<unknown> = Promise.resolve();

export function rateLimited<T>(fn: () => Promise<T>): Promise<T> {
  // Groq free tier: 30 requests/min -> 2.5s spacing. Gemini free tier: ~5/min -> 13s.
  const defaultInterval = activeProvider() === "groq" ? 2_500 : 13_000;
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
  const provider = activeProvider();
  if (provider === "groq") {
    const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
    // llama-3.3-70b-versatile is deprecated (shutdown 2026-08-16); gpt-oss-120b is
    // Groq's recommended replacement with a 1000 req/day free tier.
    return groq(process.env.GROQ_MODEL ?? "openai/gpt-oss-120b");
  }
  if (provider === "google") {
    const google = createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    });
    return google(process.env.GEMINI_MODEL ?? "gemini-3.5-flash");
  }
  throw new Error(
    "No LLM key configured. Set GOOGLE_GENERATIVE_AI_API_KEY (free: https://aistudio.google.com/apikey) or GROQ_API_KEY.",
  );
}
