# Smart Roster Management System — Antigravity Build Spec

> How to use (Claude Code extension inside Antigravity): put this file (and the assessment PDF) in `/docs` of an empty repo, and `CLAUDE.md` in the repo root — Claude Code reads it automatically every session, so you can skip Prompt 0. Switch Claude Code to **plan mode** (Shift+Tab), paste a phase prompt, approve the plan, then let it build. Run Prompts 1 → 7 **one at a time**, and `/clear` between phases to keep context fresh. After each phase, check its "Done when" list and commit before moving on.

---

## Prompt 0 — Context (paste first, every new agent session)

```
You are building a take-home assessment for Datastraw (AI & Full Stack Intern): a
browser-based Smart Roster Management System for an ops team that staffs D2C brands.
Read /docs/ANTIGRAVITY_BUILD_SPEC.md fully before doing anything. It is the source of truth.

Evaluators care most about: (1) correct scheduling logic, (2) clear conflict detection,
(3) handling a change after a roster is generated, (4) explaining decisions.
A pretty UI that produces invalid rosters FAILS. Never silently produce an invalid roster.

Stack (do not change): Vite + React + TypeScript + Tailwind + shadcn/ui, Supabase (Postgres),
Vitest for tests, deploy on Vercel. Scheduling + validation = pure TypeScript functions in
src/lib/scheduler with no DB or React imports, so they are unit-testable.

Work in phases. Produce an implementation plan for Phase 1 only, wait for my approval.
Do not start later phases on your own.
```

---

## 1. Problem summary (what the assessment demands)

- ≥30 employees, multiple brands, processes (CS, ACC, NDR, Retention…), pods with pod leads.
- ~80% of brands have **one** employee doing all processes; the rest have 2–3 employees, usually on different processes, sometimes sharing a process.
- Per brand-process operating calendars: 365 days / every day except public holidays / Sundays + public holidays off. Per-day minimum staffing.
- Monthly roster generation considering calendars, assignments, weekly offs, holidays, leaves, comp-offs, min staffing, multi-brand employees, preferences.
- Conflict detection (hard vs soft), five views (company, pod, brand, process, employee), manual edits with re-validation, and handling a change after generation (with resolution suggestions).
- Deliverables: deployed URL with sample data, GitHub repo + README + `.env.example`, 3–5 min demo video, approach note, README "Tell us how you think" (8 questions).

---

## 2. Data model (Supabase / Postgres)

```
pods(id, name, lead_employee_id → employees.id nullable)
employees(id, name, email, pod_id, role: 'agent'|'pod_lead'|'floater',
          weekly_offs_per_week int default 1, max_consecutive_work_days int default 6,
          preferred_off_weekday int null (0=Sun..6=Sat), active bool)
processes(id, code text unique 'CS'|'ACC'|'NDR'|'RET'|..., name)
brands(id, name, pod_id, active bool)
brand_processes(id, brand_id, process_id,
                calendar_rule: 'ALL_DAYS'|'NO_PUBLIC_HOLIDAYS'|'NO_SUN_NO_PH'|'CUSTOM',
                custom_weekdays int[] null,      -- used when CUSTOM
                min_staff int default 1,
                shift_start time, shift_end time)
coverage_overrides(id, brand_process_id, weekday int null, date date null, min_staff int)
                -- e.g. "CS needs 2 on Mondays" or "2 on 2026-12-26 (sale day)"
assignments(id, employee_id, brand_process_id, kind: 'primary'|'backup')
                -- primary = normally works it; backup = cross-trained, can cover gaps
public_holidays(id, date, name)
leaves(id, employee_id, start_date, end_date,
       type: 'PLANNED'|'SICK'|'COMP_OFF', status: 'PENDING'|'APPROVED'|'REJECTED')
comp_off_ledger(id, employee_id, earned_on date, reason, used_on date null)
rosters(id, month date, version int, status: 'DRAFT'|'PUBLISHED', created_at, notes)
roster_days(id, roster_id, employee_id, date,
            status: 'WORK'|'WEEK_OFF'|'LEAVE'|'COMP_OFF'|'HOLIDAY'|'NOT_SCHEDULED',
            source: 'AUTO'|'MANUAL', locked bool)
roster_coverage(id, roster_id, date, employee_id, brand_process_id)
                -- who covers what on a WORK day (includes backup cover)
roster_issues(id, roster_id, date, severity: 'HARD'|'SOFT', code, brand_process_id null,
              employee_id null, message, suggestion jsonb)
change_log(id, roster_id, at, actor, action, payload jsonb)
```

Key distinction the assessment asks for: a **brand-process operating calendar** (when the client needs cover) is separate from an **employee's working schedule** (roster_days).

Demo access: no login. Open RLS policies for the anon key are fine for a demo, plus a **"Reset demo data"** button that re-runs the seed. State this assumption in the README.

---

## 3. Scheduling algorithm (src/lib/scheduler)

Pure functions, deterministic (same input → same roster), fully unit-tested.

### 3.1 Build the demand calendar
For each brand_process × each date in the month → `required = 0` if not operating under its calendar_rule/holidays, else `min_staff` (apply overrides: date beats weekday beats default).

### 3.2 Build availability
For each employee × date: unavailable if APPROVED leave / comp-off. On a public holiday, an employee is off (`HOLIDAY`) only if **none** of their primary brand-processes operate that day; if they must work a public holiday, credit a comp-off to the ledger.
Days where none of an employee's processes operate → `NOT_SCHEDULED` (counts toward weekly offs).

### 3.3 Place weekly offs (core step)
Each employee needs `weekly_offs_per_week` offs per Mon–Sun week (partial weeks at month edges pro-rated; document the rule).
- Process employees **most-constrained first**: sole resource on an ALL_DAYS process → then multi-brand employees → then everyone else.
- For each week, score each candidate day and pick the lowest cost:
  - `+1000` per brand-process that would fall below `required` if this person is off (HARD)
  - `−50` if none of their processes operate that day (a "free" off)
  - `+20` if not their preferred off weekday (SOFT)
  - `+5 × (Sundays/weekends off already given to them vs team average)` for fairness
  - `+1000` if picking it breaks `max_consecutive_work_days`
- Ties broken by employee id + date, so it's deterministic.

### 3.4 Resolve unavoidable gaps with backups
A single employee on a 7-day process **cannot** cover 7/7 with a weekly off — that's a structural gap, not a bug. For each remaining gap (date, brand_process):
1. Candidate backups = employees with a `backup` assignment for that process (or same process in the same pod), who are WORK that day, with no shift overlap, and below a daily load cap (e.g. ≤3 brand-processes).
2. Rank by: same pod > fewer coverages that day > fewer total backup covers this month.
3. If found → add roster_coverage row (mark as backup cover). If not → **leave the gap and raise a HARD issue** with the top suggestions (e.g. "move X's weekly off from Tue to Wed", "approve backup Y").

### 3.5 Validator (separate function, runs on ANY roster — generated or hand-edited)
`validateRoster(input, roster) → Issue[]`

HARD:
- `UNCOVERED` — brand-process requires N, has < N on a date
- `NO_ASSIGNED_AVAILABLE` — nobody assigned (primary or backup) is available
- `WORKING_ON_LEAVE` — WORK on an approved leave/comp-off day
- `SHIFT_OVERLAP` — employee covers two brand-processes with overlapping shifts
- `TOO_MANY_CONSECUTIVE` — exceeds max_consecutive_work_days
- `MISSING_WEEKLY_OFF` — fewer offs than required in a week

SOFT:
- `PREFERENCE_VIOLATED` — off not on preferred weekday
- `UNFAIR_WEEKEND_OFFS` — weekend offs far from team average
- `BACKUP_OVERLOAD` — one person used as backup too often
- `CROSS_BRAND_IMPACT` — one employee's absence creates gaps in 2+ brands (surface this explicitly)

Every issue has a plain-English message + suggestion list. A roster with any HARD issue **cannot be published** without an explicit "Publish anyway with N acknowledged issues" override, which is logged.

### 3.6 Change handling (incremental re-plan)
`replan(input, existingRoster, change) → { roster, diff, issues }`
- Change types: add/approve leave, mark employee unavailable on a date, change brand rule/min_staff, add assignment.
- Keep `locked` and `MANUAL` days untouched; re-run 3.3–3.4 only for **affected weeks** and **affected employees + their brand-processes' other assignees**.
- Return a diff ("3 changes: Priya Tue→Wed off, Rahul covers BrandX CS on 12 Dec as backup…") that the user accepts or rejects.

### 3.7 Required unit tests (Vitest)
1. Single-resource ALL_DAYS brand → exactly one gap per week, filled by backup when one exists, HARD issue when none.
2. NO_SUN_NO_PH brand employee → Sunday becomes their off, no gaps.
3. 3-person brand, one on leave → validator says whether the remaining 2 keep coverage.
4. Public holiday on an ALL_DAYS process → employee works it and earns a comp-off.
5. Manual edit that creates a gap → validator flags it.
6. Determinism: same input twice → identical roster.
7. replan keeps locked days unchanged.

---

## 4. Seed data (supabase/seed.sql or a TS seed script)

Demo month: **December 2026** (also allow any month). Holidays configured: 25 Dec 2026 (Christmas); add 1 Jan, 26 Jan 2027 for next month. Fictional names only.

- **4 pods**, each with a pod lead (pod leads are also backups).
- **20 brands** → **16 single-resource** (80%) + **4 multi-resource**.
- Processes: CS, ACC, NDR, RET.
- Calendar mix across brands: ~40% ALL_DAYS (365), ~35% NO_PUBLIC_HOLIDAYS, ~25% NO_SUN_NO_PH. Within at least 2 brands, CS is ALL_DAYS while another process is NO_SUN_NO_PH.
- Multi-resource brands:
  - Brand A (3 people): CS / ACC / NDR — separate processes
  - Brand B (3 people): 2 share CS (min_staff 2 on Mon & sale days via override), 1 on ACC
  - Brand C (2 people): CS / RET
  - Brand D (2 people): both on CS + NDR (overlapping)
- 2–3 employees work across **two brands** (e.g. sole resource for one brand + ACC on another).
- 2 floaters with backup assignments across several processes.
- Total employees: **33** (16 + 10 + 4 pod leads + 2 floaters + 1 extra multi-brand).
- Preferences: ~half have a preferred off weekday; a few prefer Sunday on 365-day brands (so preference conflicts are visible).
- Leaves: 5–6 approved planned leaves in December, 1 pending, 2 comp-offs.
- At least **one deliberate unfixable gap** (sole resource on 365-day brand with no backup in pod) so the HARD issue flow shows in the demo.

---

## 5. Screens

1. **Dashboard** — month picker, Generate / Re-generate, coverage health (% required slots covered), counts of HARD/SOFT issues, Publish button (disabled while HARD issues unacknowledged).
2. **Roster grid (company view)** — rows = employees grouped by pod, columns = days; cells colour-coded W / OFF / LEAVE / HOL / C-OFF; red cell border where that person's absence causes a gap. Click cell → edit status → instant re-validation. Lock toggle per cell.
3. **Filters/tabs for the other views**: Pod (employees under a lead), Brand (rows = brand-processes, cells = coverage count vs required, e.g. `1/2` in red), Process (all brands for one process), Employee (calendar of one person: work days, offs, holidays, leaves, comp-off balance).
4. **Issues panel** — list grouped by date/brand, severity badge, message, suggested fixes with one-click **Apply** (applies then re-validates).
5. **Change simulator** — "Mark employee unavailable" / "Add leave" form → shows diff + new issues → Accept / Reject.
6. **Setup (CRUD)** — employees, pods, brands, brand-processes (calendar rule, min staff, shift), assignments (primary/backup), holidays, leaves (approve/reject), coverage overrides. No code changes needed to add brands/processes.
7. **Export** — CSV/XLSX of the roster (company grid + brand coverage).

Optional (only after everything above works): AI "Explain this conflict" button calling an LLM with the issue JSON; version comparison between two generated plans; pod-lead approval step.

---

## 6. Phase prompts (paste one at a time)

**Prompt 1 — Scaffold + schema**
```
Phase 1: Scaffold Vite+React+TS+Tailwind+shadcn. Create the Supabase schema from §2 as a
migration in /supabase/migrations, plus TS types in src/types. Add .env.example
(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY). Set up Vitest. No UI beyond a placeholder.
Done when: migration applies cleanly, `npm run build` and `npm test` pass.
```

**Prompt 2 — Seed data**
```
Phase 2: Write the seed per §4 as a TS script (scripts/seed.ts) that can also be triggered
by a "Reset demo data" action. Print a summary: employees, brands (single vs multi),
assignments, calendar rule mix. Verify 80/20 split and ≥30 employees with a test.
```

**Prompt 3 — Scheduler + validator (most important)**
```
Phase 3: Implement src/lib/scheduler exactly per §3.1–3.5 as pure functions with no DB
imports. Write all tests in §3.7 first, then implement until green. Add a CLI script that
runs the generator on the seed for December 2026 and prints coverage % and issues by code.
Do not build UI in this phase.
```

**Prompt 4 — Persistence + generate flow**
```
Phase 4: Wire generator to Supabase: load inputs, generate, save roster version +
roster_days + roster_coverage + roster_issues. Dashboard screen (§5.1) with month picker,
Generate, health stats, Publish guarded by HARD issues.
```

**Prompt 5 — Views + editing**
```
Phase 5: Build §5.2–5.4: company grid, pod/brand/process/employee views, issues panel with
Apply-suggestion. Every edit re-runs validateRoster and updates issues live. Use the
browser to verify each view renders the seed roster correctly and screenshot them.
```

**Prompt 6 — Change handling + setup CRUD + export**
```
Phase 6: Implement replan (§3.6) and the change simulator screen with diff + accept/reject,
change_log entries. Build Setup CRUD (§5.6) and CSV/XLSX export. Demo scenario must work:
sole-resource employee marked unavailable on a required day → gap flagged → backup suggested
→ apply → issue resolved.
```

**Prompt 7 — Deploy + docs**
```
Phase 7: Deploy to Vercel with Supabase env vars. Write README: overview, live URL, setup,
architecture diagram (mermaid), assumptions list, the 8 "Tell us how you think" answers
(§7 draft below — refine to match what was actually built), and known limitations.
Write docs/APPROACH.md (one page).
```

---

## 7. README "Tell us how you think" — answer skeleton

1. **Modelling** — brand_processes is the unit of demand; assignments (primary/backup) link employees to it; pods group employees with a lead; operating calendar lives on brand_process, working schedule lives on roster_days.
2. **Generation + constraint check** — demand calendar → availability → most-constrained-first weekly-off placement with a cost function → backup gap filling → independent validator. Generator and validator are separate so any roster (incl. manual edits) is checked the same way.
3. **Single vs multi-resource** — single-resource 7-day brands have a guaranteed weekly gap, so they're scheduled first and backups are planned up front; multi-resource brands stagger offs so min_staff holds.
4. **Sole resource unavailable** — HARD `UNCOVERED` issue; ranked backups (same pod, same process, lowest load, no shift clash); if none, flagged with suggestions instead of hiding it.
5. **Conflicts / insufficient staff** — hard beats soft (coverage > preference); unresolvable → HARD issue blocks publish unless explicitly acknowledged and logged.
6. **Automated vs human** — automated: off placement, backup suggestions, validation, replans. Human: leave approval, accepting backups, publishing, overrides — because they involve client relationships and people's time.
7. **2× scale** — move generation to a Supabase Edge Function / worker, swap greedy for a CP-SAT/ILP solver (OR-Tools), role-based auth for pod leads, notifications.
8. **One more week** — optimiser comparing alternative plans, pod-lead approval workflow, notifications on published-roster changes, a skills matrix for backups.

---

## 8. Demo video script (3–5 min)

1. (20s) Problem + stack in one line.
2. (40s) Setup screen: show a single-resource 365-day brand, a 3-person brand with shared CS, a NO_SUN_NO_PH brand.
3. (60s) Generate December → coverage %, company grid, brand view showing `1/1`, `2/2`, a red `0/1`.
4. (50s) Issues panel: HARD vs SOFT, explain the structural gap, apply a backup suggestion.
5. (60s) Change: mark the sole-resource employee unavailable on a required day → diff → new gap → backup → accept. Show cross-brand impact for a multi-brand employee.
6. (30s) Manual edit that breaks coverage → instantly flagged; Publish blocked.
7. (20s) Export CSV, wrap up with the approach in two sentences.

---

## 9. Submission checklist

- [ ] Live Vercel URL loads with seeded December data, no login required
- [ ] GitHub repo public, README with the 8 answers, `.env.example`, no secrets committed
- [ ] Demo video (Loom/YouTube unlisted), 3–5 min
- [ ] docs/APPROACH.md
- [ ] LinkedIn link works in incognito
- [ ] Email to ozair.shaikh@datastraw.in and aryan.jaiswal@datastraw.in, CC talent@datastraw (the PDF cuts the domain off — likely `.in`, confirm before sending), subject: `Smart Roster Management System Assignment - Hardik Bhatia`, with URL, repo, LinkedIn, 2–3 sentence approach note
