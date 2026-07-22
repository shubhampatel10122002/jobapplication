"use server";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { getProfileRow, saveProfile, setKnowledgeBase } from "@/db/repo";
import { extractPdfText, parseResume } from "@/lib/profile/parse";
import { candidateProfileSchema, EMPTY_PROFILE } from "@/lib/profile/types";

export interface ActionState {
  error?: string;
  ok?: string;
}

const DATA_DIR = path.join(process.cwd(), "data");

export async function uploadResumeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const file = formData.get("resume");
    if (!(file instanceof File) || file.size === 0) {
      return { error: "Choose a PDF file first." };
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return { error: "Only PDF resumes are supported for now." };
    }

    const buffer = await file.arrayBuffer();
    const resumeText = await extractPdfText(buffer);
    if (resumeText.length < 100) {
      return { error: "Could not extract text from this PDF (is it a scan?)." };
    }

    const parsed = await parseResume(resumeText);

    await mkdir(DATA_DIR, { recursive: true });
    const resumePath = path.join(DATA_DIR, "resume.pdf");
    await writeFile(resumePath, Buffer.from(buffer));

    await saveProfile(parsed, { resumePath, resumeText });
    revalidatePath("/profile");
    return { ok: "Resume parsed. Review the extracted profile below and fix anything that's off." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const existing = (await getProfileRow())?.data ?? EMPTY_PROFILE;

    const str = (name: string) => {
      const v = formData.get(name);
      return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
    };

    const candidate = {
      ...existing,
      firstName: str("firstName") ?? "",
      lastName: str("lastName") ?? "",
      email: str("email") ?? "",
      phone: str("phone"),
      location: str("location"),
      links: {
        ...existing.links,
        linkedin: str("linkedin"),
        github: str("github"),
        portfolio: str("portfolio"),
      },
      workAuthorization: {
        authorizedToWorkInUS: formData.get("authorizedToWorkInUS") === "on",
        requiresSponsorship: formData.get("requiresSponsorship") === "on",
        visaStatus: str("visaStatus"),
      },
      salaryExpectation: str("salaryExpectation"),
      summary: str("summary"),
      skills: (str("skills") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      workHistory: JSON.parse(str("workHistory") ?? "[]"),
      education: JSON.parse(str("education") ?? "[]"),
    };

    const parsed = candidateProfileSchema.parse(candidate);
    await saveProfile(parsed);
    revalidatePath("/profile");
    return { ok: "Profile saved." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function addKnowledgeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const entry = formData.get("entry");
    if (typeof entry !== "string" || entry.trim() === "") {
      return { error: "Write something first." };
    }
    const row = await getProfileRow();
    if (!row) return { error: "Save your profile first." };
    await setKnowledgeBase([...row.knowledgeBase, entry.trim()]);
    revalidatePath("/profile");
    return { ok: "Added." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function removeKnowledgeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const index = Number(formData.get("index"));
    const row = await getProfileRow();
    if (!row) return { error: "No profile." };
    await setKnowledgeBase(row.knowledgeBase.filter((_, i) => i !== index));
    revalidatePath("/profile");
    return { ok: "Removed." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
