/**
 * §3.3 Weekly-off placement — the core step.
 *
 * Employees are processed most-constrained first; for each Mon–Sun week, each missing off goes
 * to the candidate day with the lowest cost. Coverage and max-consecutive are scored here
 * (+1000 each) so they dominate preference (+20) and fairness (±5/offset).
 */
import type { Employee, RosterDayStatus } from '../../types/db.ts'
import { eligibleByAssignment } from './backups.ts'
import type { Context } from './context.ts'
import { isWeekend, weekdayOf } from './dates.ts'
import { required, type Demand } from './demand.ts'
import { longestWorkRun, shiftsOverlap, stableHash, weeklyOffShortfall } from './rules.ts'

export const COST = {
  belowRequired: 1000,
  freeOff: -50,
  notPreferred: 20,
  weekendFairness: 5,
  tooManyConsecutive: 1000,
  /**
   * Extensions to §3.3 (see docs/ASSUMPTIONS.md). §3.3 scores a sole agent's every day at +1000,
   * so without these the +20 preference decides and offs pile up on the same days, beyond what
   * the pod's backups can absorb.
   */
  /** primary off opens a gap and no backup is left free that day (once per day, < any +1000) */
  noBackupFree: 500,
  /** floater/pod lead off on a day with open gaps they could fill */
  neededAsBackup: 100,
  /** floater/pod lead off on a day they're already earmarked to cover */
  reservedAsBackup: 300,
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

export function placeWeeklyOffs(ctx: Context, demand: Demand, state: DayState, loadCap: number): void {
  const plan = backupPlan(ctx, demand, state, loadCap)
  const weekendOffs = new Map<string, number>()
  for (const e of ctx.employees) {
    weekendOffs.set(e.id, ctx.dates.filter((d) => isWeekend(d) && state.status(e.id, d) === 'WEEK_OFF').length)
  }
  const processed: Employee[] = []

  for (const emp of placementOrder(ctx)) {
    processed.push(emp)
    const podPeers = processed.filter((p) => p.pod_id === emp.pod_id)
    const hasPrimaries = (ctx.primaryBpsOf.get(emp.id)?.length ?? 0) > 0

    for (const week of ctx.weeks) {
      const throughWeek = ctx.dates.slice(0, ctx.dates.indexOf(week[week.length - 1]) + 1)

      for (;;) {
        const { required: need, have } = weeklyOffShortfall(
          emp.weekly_offs_per_week,
          week.map((d) => state.status(emp.id, d)),
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
          if (hasPrimaries) {
            // charged once per day (not per brand-process) so it can never outweigh a spec
            // HARD term (+1000), e.g. max-consecutive
            const uncoverable = shortBpsIfOff(ctx, demand, state, emp.id, date).some(
              (bp) => !plan.freeBackup(bp, date, emp.id),
            )
            if (uncoverable) c += COST.noBackupFree
          } else {
            c += COST.neededAsBackup * openGapsCoverableBy(ctx, demand, state, emp.id, date)
            c += COST.reservedAsBackup * plan.reservedOn(emp.id, date)
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
        // earmark a backup for each gap this off opens, so later offs compete for what's left
        for (const bp of shortBpsIfOff(ctx, demand, state, emp.id, best)) {
          const b = plan.freeBackup(bp, best, emp.id)
          if (b) plan.reserve(b, best, bp)
        }
      }
    }
  }
}

/** The person's primary brand-processes that would be short if they were off on `date`. */
function shortBpsIfOff(ctx: Context, demand: Demand, state: DayState, employeeId: string, date: string): string[] {
  return (ctx.primaryBpsOf.get(employeeId) ?? []).filter((bp) => {
    const req = required(demand, bp, date)
    if (req === 0) return false
    return ctx.primariesOf.get(bp)!.filter((q) => q !== employeeId && state.status(q, date) === 'WORK').length < req
  })
}

/**
 * Backup capacity planning during placement. A backup working on a day can take on brand-processes
 * up to the load cap, but never two different brands with overlapping shifts. Their own primary
 * work that day occupies them too. Earmarks are only a planning aid; actual backup cover is
 * assigned after placement (§3.4) from the final schedule.
 */
function backupPlan(ctx: Context, demand: Demand, state: DayState, loadCap: number) {
  const reserved = new Map<string, string[]>() // emp|date → bps
  const busyWith = (e: string, date: string): string[] => [
    ...(ctx.primaryBpsOf.get(e) ?? []).filter((bp) => required(demand, bp, date) > 0),
    ...(reserved.get(`${e}|${date}`) ?? []),
  ]
  const canTake = (e: string, bp: string, date: string): boolean => {
    if (state.status(e, date) !== 'WORK') return false
    const busy = busyWith(e, date)
    if (busy.includes(bp) || busy.length >= loadCap) return false
    const brand = ctx.brandOf(bp).id
    const shift = ctx.shift.get(bp)!
    return !busy.some((b) => ctx.brandOf(b).id !== brand && shiftsOverlap(ctx.shift.get(b)!, shift))
  }
  return {
    freeBackup(bp: string, date: string, exclude: string): string | null {
      const pod = ctx.brandOf(bp).pod_id
      let best: { id: string; samePod: boolean; load: number } | null = null
      for (const e of ctx.employees) {
        if (e.id === exclude || !eligibleByAssignment(ctx, e.id, bp) || !canTake(e.id, bp, date)) continue
        const cand = { id: e.id, samePod: e.pod_id === pod, load: busyWith(e.id, date).length }
        if (
          !best ||
          Number(cand.samePod) > Number(best.samePod) ||
          (cand.samePod === best.samePod && cand.load < best.load)
        ) {
          best = cand
        }
      }
      return best?.id ?? null
    },
    reserve(e: string, date: string, bp: string) {
      const k = `${e}|${date}`
      reserved.set(k, [...(reserved.get(k) ?? []), bp])
    },
    reservedOn(e: string, date: string): number {
      return reserved.get(`${e}|${date}`)?.length ?? 0
    },
  }
}

/** Gaps already open on `date` (primaries alone fall short) that this person could back up. */
function openGapsCoverableBy(ctx: Context, demand: Demand, state: DayState, employeeId: string, date: string): number {
  let n = 0
  for (const bp of ctx.brandProcesses) {
    const req = required(demand, bp.id, date)
    if (req === 0 || !eligibleByAssignment(ctx, employeeId, bp.id)) continue
    const working = (ctx.primariesOf.get(bp.id) ?? []).filter((q) => state.status(q, date) === 'WORK').length
    if (working < req) n++
  }
  return n
}
