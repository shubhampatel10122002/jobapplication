import { generateObject } from "ai";
import { extractText, getDocumentProxy } from "unpdf";
import { getModel } from "../llm";
import { candidateProfileSchema, type CandidateProfile } from "./types";

export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.trim();
}

export async function parseResume(resumeText: string): Promise<CandidateProfile> {
  const { object } = await generateObject({
    model: getModel(),
    schema: candidateProfileSchema,
    prompt: `Extract a structured candidate profile from the resume below.

Rules:
- Copy contact details exactly as written (email, phone, links).
- workHistory must be ordered most-recent first.
- For links, include full URLs when present in the resume.
- Leave fields null/empty when the resume does not mention them. Do not invent anything.
- skills: a flat list of concrete technical and professional skills.
- summary: write a 3-5 sentence professional summary in first person based on the resume.

RESUME:
${resumeText.slice(0, 30_000)}`,
  });
  return object;
}
