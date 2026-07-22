import { generateObject } from "ai";
import { extractText, getDocumentProxy } from "unpdf";
import { getModel, rateLimited } from "../llm";
import { candidateProfileSchema, type CandidateProfile } from "./types";

export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.trim();
}

export async function parseResume(resumeText: string): Promise<CandidateProfile> {
  const { object } = await rateLimited(() =>
    generateObject({
      model: getModel(),
      schema: candidateProfileSchema,
      prompt: `Extract a structured candidate profile from the resume below.

Rules:
- Copy contact details exactly as written (email, phone, links).
- workHistory must be ordered most-recent first.
- For links, include full URLs when present in the resume.
- For unknown optional fields, return null (every key must be present). Do not invent anything.
- workAuthorization: resumes rarely state this. Unless the resume says otherwise, set
  authorizedToWorkInUS=true and requiresSponsorship=true (the user corrects it in the UI).
- skills: a flat list of concrete technical and professional skills.
- summary: write a 3-5 sentence professional summary in first person based on the resume.

RESUME:
${resumeText.slice(0, 30_000)}`,
    }),
  );
  return object;
}
