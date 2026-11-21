/**
 * §3.3 Weekly-off placement — the core step.
 *
 * Employees are processed most-constrained first; for each Mon–Sun week, each missing off goes
 * to the candidate day with the lowest cost. Coverage and max-consecutive are scored here
 * (+1000 each) so they dominate preference (+20) and fairness (±5/offset).
 */
import type { Employee, RosterDayStatus } from '../../types/db.ts'
import { outsideStructuralOffs } from './availability.ts'
import { eligibleByAssignment } from './backups.ts'
import type { Context } from './context.ts'
import { isWeekend, weekdayOf } from './dates.ts'
import { required, type Demand } from './demand.ts'
import { longestWorkRun, stableHash, weeklyOffShortfall } from './rules.ts'

export const COST = {
  belowRequired: 1000,
  freeOff: -50,
  notPreferred: 20,
  weekendFairness: 5,
  tooManyConsecutive: 1000,
  /**
   * Extension to §3.3 (see docs/ASSUMPTIONS.md), for floaters / pod leads only: taking an off on a
   * day with open gaps they could fill costs +100 per gap, and +300 per gap nobody else eligible
   * is working to cover. The sum is clamped to `backupTermMax`, so it can never outweigh a spec
   * HARD term (+1000), e.g. max-consecutive.
   */
  neededAsBackup: 100,
  onlyPossibleBackup: 300,
  backupTermMax: 900,
  /**
   * Extension, for people with primary work: the off opens a gap and no eligible backup is even
   * working that day (typically a public holiday or leave). Once per day, < any +1000 term.
   */
  noBackupWorking: 500,
} as const

export type DayState = {
  status: (employeeId: string, date: string) => RosterDayStatus
  setStatus: (employeeId: string, date: string, s: RosterDayStatus) => void
  isFixed: (employeeId: string, date: string) => boolean
}

/**
 * 0 = sole resource on an ALL_DAYS process, 1 = works across 2+ brands, 2 = everyone else with
 * primary work, 3 = no primary work (floaters, pod leads). Tier 3 goes last on purpose: backups
 * place their offs after every gap is known, so they can stay on duty when they're needed.
 */
export function constraintTier(ctx: Context, employeeId: string): 0 | 1 | 2 | 3 {
  const bps = ctx.primaryBpsOf.get(employeeId) ?? []
  if (bps.length === 0) return 3
  const soleOnAllDays = bps.some(
    (bp) => ctx.brandProcess.get(bp)!.calendar_rule === 'ALL_DAYS' && ctx.primariesOf.get(bp)!.length === 1,
  )
  if (soleOnAllDays) return 0
  const brands = new Set(bps.map((bp) => ctx.brandOf(bp).id))
  return brands.size >= 2 ? 1 : 2
}

export function placementOrder(ctx: Context): Employee[] {
  return [...ctx.employees].sort(
    (a, b) => constraintTier(ctx, a.id) - constraintTier(ctx, b.id) || a.id.localeCompare(b.id),
  )
}

/** How many of this employee's primary brand-processes would be short if they're off on `date`. */
export function shortfallIfOff(ctx: Context, demand: Demand, state: DayState, employeeId: string, date: string): number {
  let short = 0
  for (const bp of ctx.primaryBpsOf.get(employeeId) ?? []) {
    const req = required(demand, bp, date)
    if (req === 0) continue
    const others = ctx.primariesOf.get(bp)!.filter((q) => q !== employeeId && state.status(q, date) === 'WORK').length
    if (others < req) short++
  }
  return short
}

export function placeWeeklyOffs(ctx: Context, demand: Demand, state: DayState): void {
  const weekendOffs = new Map<string, number>()
  for (const e of ctx.employees) {
    weekendOffs.set(e.id, ctx.dates.filter((d) => isWeekend(d) && state.status(e.id, d) === 'WEEK_OFF').length)
  }
  const processed: Employee[] = []

  for (const emp of placementOrder(ctx)) {
    processed.push(emp)
    const podPeers = processed.filter((p) => p.pod_id === emp.pod_id)
    const hasPrimaries = (ctx.primaryBpsOf.get(emp.id)?.length ?? 0) > 0

    for (const [wi, week] of ctx.weeks.entries()) {
      const outsideOffs = outsideStructuralOffs(ctx, demand, emp.id, wi)
      const throughWeek = ctx.dates.slice(0, ctx.dates.indexOf(week[week.length - 1]) + 1)

      for (;;) {
        const { required: need, have } = weeklyOffShortfall(
          emp.weekly_offs_per_week,
          week.map((d) => state.status(emp.id, d)),
          outsideOffs,
        )
        if (have >= need) break
        const candidates = week.filter((d) => state.status(emp.id, d) === 'WORK' && !state.isFixed(emp.id, d))
        if (candidates.length === 0) break

        const avgWeekend = podPeers.reduce((s, p) => s + weekendOffs.get(p.id)!, 0) / podPeers.length
        const cost = (date: string): number => {
          let c = COST.belowRequired * shortfallIfOff(ctx, demand, state, emp.id, date)
          if (hasPrimaries && !(ctx.primaryBpsOf.get(emp.id) ?? []).some((bp) => required(demand, bp, date) > 0)) {
            c += COST.freeOff
          }
          if (emp.preferred_off_weekday !== null && weekdayOf(date) !== emp.preferred_off_weekday) c += COST.notPreferred
          if (isWeekend(date)) c += COST.weekendFairness * (weekendOffs.get(emp.id)! - avgWeekend)
          const run = longestWorkRun(throughWeek.map((d) => (d === date ? 'WEEK_OFF' : state.status(emp.id, d))))
          if (run > emp.max_consecutive_work_days) c += COST.tooManyConsecutive
          if (hasPrimaries && noBackupWorking(ctx, demand, state, emp.id, date)) c += COST.noBackupWorking
          if (!hasPrimaries) {
            const g = openGapsCoverableBy(ctx, demand, state, emp.id, date)
            c += Math.min(COST.backupTermMax, COST.neededAsBackup * g.gaps + COST.onlyPossibleBackup * g.onlyMe)
          }
          return c
        }

        let best = candidates[0]
        let bestCost = cost(best)
        for (const d of candidates.slice(1)) {
          const c = cost(d)
          if (c < bestCost || (c === bestCost && stableHash(`${emp.id}|${d}`) < stableHash(`${emp.id}|${best}`))) {
            best = d
            bestCost = c
          }
        }
        state.setStatus(emp.id, best, 'WEEK_OFF')
        if (isWeekend(best)) weekendOffs.set(emp.id, weekendOffs.get(emp.id)! + 1)
      }
    }
  }
}

/**
 * Gaps already open on `date` (primaries alone fall short) that this person could back up, and
 * how many of those nobody else eligible is working to cover.
 */
function openGapsCoverableBy(
  ctx: Context,
  demand: Demand,
  state: DayState,
  employeeId: string,
  date: string,
): { gaps: number; onlyMe: number } {
  let gaps = 0
  let onlyMe = 0
  for (const bp of ctx.brandProcesses) {
    const req = required(demand, bp.id, date)
    if (req === 0 || !eligibleByAssignment(ctx, employeeId, bp.id)) continue
    const primaries = ctx.primariesOf.get(bp.id) ?? []
    const working = primaries.filter((q) => state.status(q, date) === 'WORK').length
    if (working >= req) continue
    gaps++
    const someoneElse = ctx.employees.some(
      (e) =>
        e.id !== employeeId &&
        !primaries.includes(e.id) &&
        state.status(e.id, date) === 'WORK' &&
        eligibleByAssignment(ctx, e.id, bp.id) !== null,
    )
    if (!someoneElse) onlyMe++
  }
  return { gaps, onlyMe }
}

/** Would this person's off on `date` open a gap that no eligible backup is working to cover? */
function noBackupWorking(ctx: Context, demand: Demand, state: DayState, employeeId: string, date: string): boolean {
  return (ctx.primaryBpsOf.get(employeeId) ?? []).some((bp) => {
    const req = required(demand, bp, date)
    if (req === 0) return false
    const primaries = ctx.primariesOf.get(bp)!
    if (primaries.filter((q) => q !== employeeId && state.status(q, date) === 'WORK').length >= req) return false
    return !ctx.employees.some(
      (e) => !primaries.includes(e.id) && state.status(e.id, date) === 'WORK' && eligibleByAssignment(ctx, e.id, bp) !== null,
    )
  })
}
