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
