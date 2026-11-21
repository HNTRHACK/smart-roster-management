# Smart Roster Management System — Datastraw assessment

Read `docs/ANTIGRAVITY_BUILD_SPEC.md` before any work. It is the source of truth for the data model (§2), scheduling algorithm (§3), seed data (§4), screens (§5) and phases (§6).

## Priorities
1. Correct scheduling logic and clear conflict detection beat UI polish. Never silently produce an invalid roster — every unmet constraint becomes a HARD or SOFT issue with a message and suggestions.
2. Hard constraints (coverage, leave, max consecutive days, weekly offs, shift overlap) always beat soft ones (preferred off day, fairness).
3. Work one phase at a time. Don't start the next phase unless asked.

## Stack (do not change)
Vite + React + TypeScript + Tailwind + shadcn/ui, Supabase (Postgres), Vitest, deployed on Vercel.

## Rules
- `src/lib/scheduler/` holds pure, deterministic TS functions — no React, no Supabase imports. Generator and validator are separate functions; the validator runs on every roster, including manual edits.
- Write scheduler tests before implementation (spec §3.7). `npm test` and `npm run build` must pass before a phase is done.
- Secrets only in `.env` (git-ignored); keep `.env.example` updated.
- Record every assumption you make in `docs/ASSUMPTIONS.md` — the README needs them.
- NEVER run git commit, git push, or stage files. The user commits manually. At the end of
  each phase, stop and say it's ready to commit, with a suggested commit message.

## Commands
- `npm run dev` · `npm test` · `npm run build` · `npm run seed`
