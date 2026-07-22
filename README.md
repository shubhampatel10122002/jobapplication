# JobPilot

Auto-apply agent for public job boards (Greenhouse, Lever, Ashby) — no login-required
platforms in scope yet. Paste a job URL, the app fetches the application form schema
via each ATS's public API (no scraping), checks eligibility, fills standard fields from
your profile, answers EEO questions from fixed defaults, and (next milestone) generates
screening-question answers with an LLM before submitting.

## Current status (milestone 1)

- **ATS adapters** (`src/lib/ats/`) — detect a job URL and fetch the job + normalized
  application form:
  - Greenhouse: `boards-api.greenhouse.io` with `?questions=true` (includes EEOC questions)
  - Ashby: public `non-user-graphql` endpoint used by the hosted job board itself
  - Lever: public postings API (standard fields; custom questions come with the
    Playwright submission path later)
- **Eligibility filter** (`src/lib/eligibility/`) — regex-only, zero API cost. Skips jobs
  that say "no visa sponsorship", "must not require sponsorship now or in the future",
  "U.S. citizens / green card holders only", exclude F-1/OPT/CPT, or require a security
  clearance / ITAR U.S.-persons status. Applies when the posting is silent or only
  requires current U.S. work authorization.
- **EEO defaults** (`src/lib/profile/eeo.ts`) — deterministic answers, never guessed by
  the LLM: disability = No, protected veteran = No, race = Asian (not Hispanic or
  Latino), gender = Male.
- **Job inspector UI** — paste a URL on the home page to see the parsed form, the
  eligibility verdict (with the matched sentences), and the planned answer (with its
  source) for every field, previewed against your saved profile.
- **Database schema** (`src/db/schema.ts`) — profile, jobs, applications, per-question
  answers (powers the post-application review screen), and an LLM answer cache.
- **Profile** (`/profile`) — upload a resume PDF and the LLM (Gemini 3.6 Flash by
  default, Groq optional via `LLM_PROVIDER=groq`) extracts a structured profile you can
  review and edit; plus a free-form knowledge base the AI uses as context for
  screening questions.
- **Answer engine** (`src/lib/answer/`) — deterministic profile mapping for identity
  fields, fixed EEO defaults, LLM answers (constrained to the exact options for select
  questions) with a Postgres-backed cache keyed on question hash + profile version.

## Getting started

```bash
pnpm install
cp .env.example .env
docker compose up -d      # local Postgres (only needed once persistence lands)
pnpm db:push              # create tables
pnpm dev                  # http://localhost:3000
```

## Tests

```bash
pnpm test        # unit tests (eligibility filter, EEO mapping, URL detection)
pnpm test:live   # + live smoke tests against real Greenhouse/Ashby/Lever boards
```

## Roadmap

1. ~~ATS adapters + eligibility filter + EEO defaults~~
2. ~~Profile: resume upload + LLM parsing into a structured profile, knowledge base~~
3. ~~Answer engine: LLM answers for screening questions, answer cache~~ (this milestone)
4. Submission: Ashby/Greenhouse structured submit, Playwright fallback, audit trail
   with per-question answers + confirmation screenshot
5. Job discovery: poll tracked company boards for new matching postings

## Stack

Next.js (App Router) · TypeScript · PostgreSQL + Drizzle · pg-boss (queue, lives in
Postgres) · Vitest. Deploy target: single Hetzner VPS with Dokploy.
