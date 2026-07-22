import { and, eq } from "drizzle-orm";
import type { AnswerCacheStore } from "@/lib/answer/engine";
import { EEO_DEFAULTS } from "@/lib/profile/eeo";
import type { CandidateProfile } from "@/lib/profile/types";
import { normalizeProfile } from "@/lib/profile/types";
import { db } from "./index";
import { answerCache, profile } from "./schema";

export interface ProfileRow {
  id: number;
  data: CandidateProfile;
  knowledgeBase: string[];
  resumePath: string | null;
  resumeText: string | null;
  version: number;
}

export async function getProfileRow(): Promise<ProfileRow | null> {
  const rows = await db.select().from(profile).limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    data: normalizeProfile(row.data as CandidateProfile),
    knowledgeBase: (row.knowledgeBase as string[]) ?? [],
    resumePath: row.resumePath,
    resumeText: row.resumeText,
    version: row.version,
  };
}

export async function saveProfile(
  data: CandidateProfile,
  opts: { resumePath?: string; resumeText?: string } = {},
): Promise<void> {
  const existing = await getProfileRow();
  if (!existing) {
    await db.insert(profile).values({
      data,
      eeoDefaults: EEO_DEFAULTS,
      knowledgeBase: [],
      resumePath: opts.resumePath ?? null,
      resumeText: opts.resumeText ?? null,
    });
    return;
  }
  await db
    .update(profile)
    .set({
      data,
      resumePath: opts.resumePath ?? existing.resumePath,
      resumeText: opts.resumeText ?? existing.resumeText,
      version: existing.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(profile.id, existing.id));
}

export async function setKnowledgeBase(entries: string[]): Promise<void> {
  const existing = await getProfileRow();
  if (!existing) {
    throw new Error("Create a profile before adding knowledge base entries");
  }
  await db
    .update(profile)
    .set({
      knowledgeBase: entries,
      version: existing.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(profile.id, existing.id));
}

/** Answer cache backed by Postgres, scoped to a profile version. */
export function dbAnswerCache(profileVersion: number): AnswerCacheStore {
  return {
    async get(hash) {
      const rows = await db
        .select()
        .from(answerCache)
        .where(
          and(
            eq(answerCache.questionHash, hash),
            eq(answerCache.profileVersion, profileVersion),
          ),
        )
        .limit(1);
      return rows[0]?.answer ?? null;
    },
    async set(hash, questionLabel, answer) {
      await db
        .insert(answerCache)
        .values({ questionHash: hash, profileVersion, questionLabel, answer })
        .onConflictDoNothing();
    },
  };
}
