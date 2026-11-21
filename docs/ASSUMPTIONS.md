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
