# Assumptions

Every assumption made while building, grouped by phase. The README's assumptions list is drawn from this file.

## Phase 1: Schema and scaffold

- **Demo access has no login.** RLS is turned on for every table, with a single open policy (`demo_open_access`) for the `anon` and `authenticated` roles. This is acceptable only for a demo; production would use role-based policies, for example letting a pod lead edit only their own pod.
- **UUID primary keys** (`gen_random_uuid()`) on every table.
- **Processes are data, not an enum.** `processes.code` is unique text, so a new process (beyond CS/ACC/NDR/RET) can be added without a migration. Brands work the same way.
- **Overnight shifts are allowed.** If `shift_end < shift_start`, the shift crosses midnight. A zero-length shift (`shift_end = shift_start`) is rejected.
- **`custom_weekdays` must be set exactly when `calendar_rule = 'CUSTOM'`.** It must be non-empty and use 0 = Sunday … 6 = Saturday, the same as JS `Date#getDay`.
- **A coverage override targets either a weekday or a specific date, never both.** There is at most one override per brand-process per weekday and one per date. The scheduler applies them in the order date > weekday > default `min_staff` (§3.1).
- **`roster_coverage.is_backup` was added.** §2 doesn't list this column, but §3.4 needs to "mark as backup cover", and the views and the `BACKUP_OVERLOAD` check need to tell backup cover apart from primary cover.
- **`rosters.month` is always the first day of the month**, enforced by a check constraint. Versions are unique per month.
- **`roster_issues.code` is text, not an enum**, so new validator rules don't need a migration. The known codes live in `src/types/db.ts`. `roster_issues.date` is null for issues that cover the whole month, such as `UNFAIR_WEEKEND_OFFS`.
- **`change_log.roster_id` is nullable**, so setup changes that aren't tied to a roster (for example editing a brand's calendar) can also be logged. `actor` defaults to `demo-user` because there is no login.
- **Deletes:** removing a roster deletes its days, coverage, issues and log entries. Removing an employee deletes their assignments, leaves and roster rows. A process can't be deleted while a brand still uses it.
- **DB types are hand-written** in `src/types/db.ts`. A test (`src/types/db.test.ts`) parses the migrations and fails if the enums or table names drift. They can be swapped for `npx supabase gen types typescript --local` later.

## Phase 2: Seed data

- **30 employees instead of the 33 in spec §4.** The §4 numbers can't all be true at once:
  - The brand teams need 10 slots (A=3, B=3, C=2, D=2).
  - A multi-brand employee ("sole resource for one brand + ACC on another") has to fill one of those slots, or a team grows past its stated size.
  - With 2 multi-brand employees, that gives 16 sole agents + 8 people who only work on team brands + 4 pod leads + 2 floaters = **30**. That's the maximum.
  - Reaching 33 would mean adding floaters or making teams bigger. We kept every other §4 rule exact instead, and 30 still meets the assessment's "≥30 employees".
- **Single vs multi-resource** is counted by *distinct primary assignees* on a brand's processes: 1 person = single-resource, 2 or more = multi-resource. This gives 16/4 = 80/20.
- **Multi-brand employees:** Neha Verma (sole agent on Nimbus Knitwear, plus ACC on Bloom Botanics) and Ishita Banerjee (sole agent on Velvet Moth Candles, plus RET on Cobalt Cookware). Each works mornings on one brand and afternoons on the other, so their shifts never overlap.
- **Process names:** ACC = Accounts, NDR = Non-Delivery Resolution (failed-delivery follow-up), RET = Retention.
- **One shift per sole agent.** A sole agent handles all of their brand's processes in the same shift window. Two processes of the *same* brand overlapping in time is normal multitasking. **Phase 3:** `SHIFT_OVERLAP` should only compare shifts on *different* brands.
- **A brand's "main" calendar rule** is the rule on its CS process, or on its first process if it has no CS. The 40/35/25 mix in §4 is measured this way, giving 8/7/5. Counted per brand-process instead, the mix is 9/12/11.
- **The deliberate unfixable gap** is Saltmarsh Swimwear: a RET-only brand that operates every day, in Pod Quartz. No one else in that pod works RET and nobody has a backup assignment for it. So every weekly off its sole agent (Zoya Khan) takes is a HARD `UNCOVERED` gap. She also prefers Sundays off, so preference conflicts show up as well.
- **Comp-offs:** the 2 COMP_OFF leaves are spent from `comp_off_ledger` entries earned in November 2026.
- **The pending leave** (Aman Saxena, 29–30 Dec) is not approved, so the scheduler must ignore it.
- **Seed IDs are fixed UUIDs** (`src/lib/seed/ids.ts`). The first block identifies the table and the last block is the row number. That keeps scheduler tie-breaks the same after every reset.
- **What "Reset demo data" does:**
  - It replaces **all** data, including every generated roster, issue and change-log entry.
  - It runs as one transaction inside the `reset_demo_data(jsonb)` Postgres function. If it fails, nothing changes.
  - That function is `security definer` and anyone with the anon key can run it. This is demo-only, and it adds no new exposure, because the open RLS policies already let anon delete every row.
- **One dataset, three ways to load it:** `npm run seed` (CLI), the app's Reset button, and `npx supabase db reset`. The last one loads `supabase/seed.sql`, which is generated from the TS data with `npm run seed -- --sql`. A test fails if that file is out of date.
- **Local Supabase ports are 544xx** (API 54421, DB 54422), not the default 543xx, so this project can run alongside another local Supabase project.

## Phase 3: Scheduler and validator

**Calendars and demand (§3.1)**
- **CUSTOM calendars also close on public holidays.** They operate only on their listed weekdays, and not on a public holiday that falls on one of them.
- **Coverage overrides only apply on days the brand-process operates.** This follows the wording of §3.1. A sale-day override on a closed Sunday is ignored. Order of precedence: date > weekday > default `min_staff`.
- **Inactive brands and employees are left out completely.**

**Availability (§3.2)**
- **A public holiday given as the day off (HOLIDAY) does not count toward the weekly off** (user decision). Holidays are extra. So in Christmas week, a sole agent on a NO_PUBLIC_HOLIDAYS brand still needs a weekly off on a working day.
- **Working a public holiday earns a comp-off.** It's returned in `roster.comp_offs_earned`, to be written to `comp_off_ledger` in Phase 4. This applies to anyone rostered WORK on a holiday while covering something.
- **Floaters and pod leads** (no primary assignments) are on duty every day except public holidays, so they can act as backups. They still get weekly offs.
- **Only APPROVED leaves count.** PENDING and REJECTED leaves are ignored. A planned or sick leave takes priority over a comp-off on the same day.

**Weekly offs (§3.3)**
- **Partial weeks are pro-rated.** Weeks run Mon–Sun, clipped to the month. Offs needed = `round(weekly_offs_per_week × days / 7)`, so with 1 off a week, a stub of 4–7 days needs 1 off and a stub of 1–3 days needs none.
- **The requirement is capped at the days that could hold an off.** A week spent mostly on leave doesn't demand impossible offs. WEEK_OFF and NOT_SCHEDULED days count toward it; HOLIDAY, LEAVE and COMP_OFF don't.
- **Each month starts a fresh consecutive-days count on day 1.** The previous month's roster isn't consulted yet; Phase 6 replan can add that.
- **Processing order:**
  1. Sole resources on an ALL_DAYS process.
  2. Employees who work across 2 or more brands.
  3. Everyone else with primary work.
  4. **Floaters and pod leads, last.** §3.3 only lists the first three groups. Putting backups last lets them place their offs once every gap is known.

  Ties within a group go by employee id.
- **Extensions to the §3.3 cost function.** §3.3 scores every day of a sole agent at +1000, so the +20 preference ends up deciding. Without these extensions, offs piled up on the same days (often Sundays, because of preferences), beyond what a pod's backups could cover. In December that left 44 HARD issues and 95.3% coverage; with the extensions it's 23 HARD and 97.5%. The extensions:
  - **+500 when an off opens a gap and no backup is left free that day.** It's charged once per day, so it can never outweigh a spec +1000 term such as max-consecutive. Each chosen off earmarks a backup, so later offs compete for whatever capacity is left.
  - **For floaters and pod leads:** +100 for each open gap they could fill that day, and +300 for each gap they're already earmarked for.
  - **The trade-off:** more SOFT `PREFERENCE_VIOLATED` issues (17 instead of 8 in December), because coverage beats preference.
- **Tie-break.** "employee id + date" is implemented as a stable hash of `employee_id|date`. It's deterministic, and unlike "earliest date wins" it doesn't put everyone's off on a Monday.
- **Locked and MANUAL days** passed in as `fixedDays` are never changed. They count toward weekly offs and consecutive days like any other day. This is the basis for test 7; `replan` (§3.6) itself arrives in Phase 6.

**Backups (§3.4)**
- **Who counts as a candidate:** someone with a backup assignment on that brand-process, or anyone in the same pod assigned (primary or backup) to the same process on another brand.
- **Load limits:** at most 3 brand-processes per person per day. A backup can't cover two *different* brands with overlapping shifts. Because almost every demo brand runs 09:00–18:00, in practice a backup covers one other brand per day, and that limit is what drives most of the remaining gaps.
- **Shift overlap is only checked across different brands.** Processes of the same brand overlapping in time count as normal multitasking. An end time at or before the start time means an overnight shift.

**Validator (§3.5)**
- **What it reads:** it uses only `(input, roster)`, so it treats generated and hand-edited rosters the same way. A coverage row only counts if that employee is WORK that day. A missing day row counts as not working.
- **One HARD issue per gap, never two:**
  - `NO_ASSIGNED_AVAILABLE` when everyone assigned (primary and backup) is on approved leave or comp-off, or nobody is assigned at all. Nothing can be rearranged among them.
  - `UNCOVERED` otherwise.
- **Suggestions, in order, at most 3:**
  1. A free backup (`ASSIGN_BACKUP`).
  2. Moving a primary's or backup's weekly off to another day in the same week, if that opens no new gap and keeps the consecutive-days limit (`MOVE_WEEK_OFF`).
  3. Otherwise a setup change: add a backup (`ADD_BACKUP_ASSIGNMENT`).
- **When SOFT issues fire:**
  - `PREFERENCE_VIOLATED`: one per employee per week, when they got a weekly off but not on their preferred weekday, and that weekday was a working day that week.
  - `UNFAIR_WEEKEND_OFFS`: someone has 2 or more fewer weekend offs than the average of pod members who work weekends. Only people who are short are flagged, not people who are ahead.
  - `BACKUP_OVERLOAD`: more than 8 backup covers in a month.
  - `CROSS_BRAND_IMPACT`: on a given date, one person's absence leaves 2 or more brands short on primary staff alone, whether or not backups then fill the gaps. The message says which gaps were covered and which are still open.
- **Thresholds are options:** `dailyLoadCap`, `backupOverloadThreshold` and `unfairWeekendGap` are all in `SchedulerOptions`.
