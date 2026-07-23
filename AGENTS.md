<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

JobPilot is a single Next.js 16 app (auto-apply agent for Greenhouse/Lever/Ashby). Standard commands live in `README.md` and `package.json` (`pnpm dev`, `pnpm lint`, `pnpm test`, `pnpm test:live`, `pnpm build`, `pnpm db:push`). Notes below cover only non-obvious setup for this VM.

- Postgres is installed **natively** (not Docker — Docker is unavailable). The cluster is not auto-started on boot; start it before running the app/db commands: `sudo pg_ctlcluster 16 main start`. Role/db/schema (`jobpilot`/`jobpilot`, tables from `pnpm db:push`) persist in the snapshot, so `db:push` normally reports no changes after the first run.
- `.env` is gitignored and already present (it sets `DATABASE_URL` to the local Postgres and `LLM_PROVIDER=groq`). `GROQ_API_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY` are injected as environment secrets; real env vars take precedence over `.env`, so no key value is stored in the repo.
- The submission/Playwright flow uses `pnpm exec playwright install chromium` (already cached). It **live-submits by default** (matches `src/lib/submit/mode.ts` and the README) — set `DRY_RUN=1` (or `AUTO_SUBMIT=0`) to fill the form + screenshot without clicking submit.
- pnpm here is v11 (via corepack). Build/install scripts are gated by the `allowBuilds` map in `pnpm-workspace.yaml` (v11 removed `onlyBuiltDependencies` and the `package.json#pnpm` field). `esbuild`/`sharp`/`unrs-resolver` are set to `true` there; without that, `pnpm install` hard-fails with `ERR_PNPM_IGNORED_BUILDS` (strictDepBuilds defaults to true) and every `pnpm <script>` also fails via the pre-run deps check.
- Core "hello world" flow to verify the app: `pnpm dev`, open http://localhost:3000, paste a real job URL (e.g. `https://boards.greenhouse.io/stripe/jobs/<id>`) and click Inspect — it fetches the job from the ATS public API and shows eligibility + planned answers (needs internet; no key required). LLM answers and resume parsing need a working LLM key.
