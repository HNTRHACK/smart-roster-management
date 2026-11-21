/**
 * Roster generator: §3.1 demand → §3.2 availability → §3.3 weekly offs → coverage → §3.4 backups.
 * Produces a Roster only; problems are reported by validateRoster(), which runs separately on any
 * roster (generated or hand-edited) so both are judged the same way.
 */
import type { RosterDayStatus } from '../../types/db.ts'
import { buildAvailability } from './availability.ts'
import { backupCandidates, type RosterView } from './backups.ts'
import { buildContext } from './context.ts'
import { demandFromContext, required } from './demand.ts'
import { placeWeeklyOffs, type DayState } from './weeklyOffs.ts'
import {
  DEFAULT_OPTIONS,
  type CompOffEarned,
  type CoverageEntry,
  type Roster,
  type RosterDayEntry,
  type SchedulerInput,
  type SchedulerOptions,
} from './types.ts'

const key = (a: string, b: string) => `${a}|${b}`

export function generateRoster(input: SchedulerInput, opts: SchedulerOptions = {}): Roster {
  const ctx = buildContext(input)
  const demand = demandFromContext(ctx, input)
  const loadCap = opts.dailyLoadCap ?? DEFAULT_OPTIONS.dailyLoadCap

  // §3.2 availability, then locked / manual days on top (never changed afterwards)
  const status = new Map<string, RosterDayStatus>()
  for (const [empId, perDate] of buildAvailability(ctx, demand)) {
    for (const [date, s] of perDate) status.set(key(empId, date), s)
  }
  const fixed = new Map<string, RosterDayEntry>()
  for (const f of opts.fixedDays ?? []) {
    if (!ctx.employee.has(f.employee_id) || !status.has(key(f.employee_id, f.date))) continue
    fixed.set(key(f.employee_id, f.date), f)
    status.set(key(f.employee_id, f.date), f.status)
  }

  const state: DayState = {
    status: (e, d) => status.get(key(e, d))!,
    setStatus: (e, d, s) => void status.set(key(e, d), s),
    isFixed: (e, d) => fixed.has(key(e, d)),
  }

  // §3.3 weekly offs
  placeWeeklyOffs(ctx, demand, state)

  // Coverage: everyone working covers each of their primary brand-processes that operates today.
  const coverage: CoverageEntry[] = []
  const covers = new Map<string, string[]>() // emp|date → bps
  const coveredCount = new Map<string, number>() // bp|date → people
  const backupCount = new Map<string, number>()
  const addCover = (employee_id: string, date: string, brand_process_id: string, is_backup: boolean) => {
    coverage.push({ employee_id, date, brand_process_id, is_backup })
    const k = key(employee_id, date)
    covers.set(k, [...(covers.get(k) ?? []), brand_process_id])
    coveredCount.set(key(brand_process_id, date), (coveredCount.get(key(brand_process_id, date)) ?? 0) + 1)
    if (is_backup) backupCount.set(employee_id, (backupCount.get(employee_id) ?? 0) + 1)
  }
  for (const e of ctx.employees) {
    for (const date of ctx.dates) {
      if (state.status(e.id, date) !== 'WORK') continue
      for (const bp of ctx.primaryBpsOf.get(e.id) ?? []) {
        if (required(demand, bp, date) > 0) addCover(e.id, date, bp, false)
      }
    }
  }

  // §3.4 fill remaining gaps with backups, date by date
  const view: RosterView = {
    status: state.status,
    coversOn: (e, d) => covers.get(key(e, d)) ?? [],
    backupCount: (e) => backupCount.get(e) ?? 0,
  }
  for (const date of ctx.dates) {
    for (const bp of ctx.brandProcesses) {
      let deficit = required(demand, bp.id, date) - (coveredCount.get(key(bp.id, date)) ?? 0)
      while (deficit > 0) {
        const [best] = backupCandidates(ctx, view, bp.id, date, loadCap)
        if (!best) break // unfillable → stays a gap; validateRoster reports it as HARD
        addCover(best.employeeId, date, bp.id, true)
        deficit--
      }
    }
  }

  // Comp-off credit for anyone who works a public holiday (§3.2)
  const comp_offs_earned: CompOffEarned[] = []
  for (const e of ctx.employees) {
    for (const date of ctx.dates) {
      const name = ctx.holidays.get(date)
      if (name !== undefined && state.status(e.id, date) === 'WORK' && (covers.get(key(e.id, date))?.length ?? 0) > 0) {
        comp_offs_earned.push({ employee_id: e.id, date, reason: `Worked public holiday: ${name}` })
      }
    }
  }

  const days: RosterDayEntry[] = []
  for (const e of ctx.employees) {
    for (const date of ctx.dates) {
      days.push(
        fixed.get(key(e.id, date)) ?? { employee_id: e.id, date, status: state.status(e.id, date), source: 'AUTO', locked: false },
      )
    }
  }

  coverage.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.brand_process_id.localeCompare(b.brand_process_id) ||
      a.employee_id.localeCompare(b.employee_id),
  )
  comp_offs_earned.sort((a, b) => a.date.localeCompare(b.date) || a.employee_id.localeCompare(b.employee_id))

  return { month: input.month, days, coverage, comp_offs_earned }
}
