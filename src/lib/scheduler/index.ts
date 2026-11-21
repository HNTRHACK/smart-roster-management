/**
 * Scheduler + validator (spec §3). Pure, deterministic TypeScript: no React, no Supabase,
 * no clock or randomness — the same input always gives the same roster and issues.
 *
 *   generateRoster(input, opts?)  → Roster          (§3.1–3.4)
 *   validateRoster(input, roster) → Issue[]         (§3.5, works on any roster incl. manual edits)
 *   coverageStats(input, roster)  → coverage %      (dashboard health)
 */
import { generateRoster } from './generate.ts'
import type { Issue, Roster, SchedulerInput, SchedulerOptions } from './types.ts'
import { validateRoster } from './validate.ts'

export { buildDemand, operates, type Demand } from './demand.ts'
export { formatDay, monthDates, weekdayOf, weeksOfMonth } from './dates.ts'
export { generateRoster } from './generate.ts'
export { requiredOffsForWeek } from './rules.ts'
export { coverageStats, type BrandProcessCoverage, type CoverageStats } from './stats.ts'
export { validateRoster } from './validate.ts'
export { COST, constraintTier } from './weeklyOffs.ts'
export * from './types.ts'

/** Generate a roster and validate it in one call. */
export function scheduleMonth(input: SchedulerInput, opts: SchedulerOptions = {}): { roster: Roster; issues: Issue[] } {
  const roster = generateRoster(input, opts)
  return { roster, issues: validateRoster(input, roster, opts) }
}
