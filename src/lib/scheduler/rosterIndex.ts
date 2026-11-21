/**
 * Index over an existing Roster (generated or hand-edited), used by the validator and stats.
 * Only "effective" coverage counts: a coverage row whose employee isn't WORK that day is ignored.
 */
import type { RosterDayStatus } from '../../types/db.ts'
import type { RosterView } from './backups.ts'
import type { Context } from './context.ts'
import type { Roster } from './types.ts'

const key = (a: string, b: string) => `${a}|${b}`

export type RosterIndex = RosterView & {
  locked: (employeeId: string, date: string) => boolean
  /** distinct people effectively covering bp on date */
  covered: (bpId: string, date: string) => number
  coverersOf: (bpId: string, date: string) => { employeeId: string; isBackup: boolean }[]
  /** bp ids this employee covers on this date as PRIMARY work (backup cover excluded) */
  primaryCoversOn: (employeeId: string, date: string) => string[]
  /** employees that have at least one day row */
  rostered: Set<string>
}

export function indexRoster(ctx: Context, roster: Roster): RosterIndex {
  const status = new Map<string, RosterDayStatus>()
  const locked = new Set<string>()
  const rostered = new Set<string>()
  for (const d of roster.days) {
    if (!ctx.employee.has(d.employee_id)) continue
    status.set(key(d.employee_id, d.date), d.status)
    if (d.locked) locked.add(key(d.employee_id, d.date))
    rostered.add(d.employee_id)
  }

  const covers = new Map<string, string[]>()
  const primaryCovers = new Map<string, string[]>()
  const coverers = new Map<string, { employeeId: string; isBackup: boolean }[]>()
  const backupCount = new Map<string, number>()
  const seen = new Set<string>()
  for (const c of roster.coverage) {
    if (status.get(key(c.employee_id, c.date)) !== 'WORK' || !ctx.brandProcess.has(c.brand_process_id)) continue
    const dedupe = `${c.employee_id}|${c.date}|${c.brand_process_id}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    const ek = key(c.employee_id, c.date)
    covers.set(ek, [...(covers.get(ek) ?? []), c.brand_process_id])
    if (!c.is_backup) primaryCovers.set(ek, [...(primaryCovers.get(ek) ?? []), c.brand_process_id])
    const bk = key(c.brand_process_id, c.date)
    coverers.set(bk, [...(coverers.get(bk) ?? []), { employeeId: c.employee_id, isBackup: c.is_backup }])
    if (c.is_backup) backupCount.set(c.employee_id, (backupCount.get(c.employee_id) ?? 0) + 1)
  }
  for (const list of [...covers.values(), ...primaryCovers.values()]) list.sort()
  for (const list of coverers.values()) list.sort((a, b) => a.employeeId.localeCompare(b.employeeId))

  return {
    status: (e, d) => status.get(key(e, d)),
    locked: (e, d) => locked.has(key(e, d)),
    coversOn: (e, d) => covers.get(key(e, d)) ?? [],
    backupCount: (e) => backupCount.get(e) ?? 0,
    covered: (bp, d) => coverers.get(key(bp, d))?.length ?? 0,
    coverersOf: (bp, d) => coverers.get(key(bp, d)) ?? [],
    primaryCoversOn: (e, d) => primaryCovers.get(key(e, d)) ?? [],
    rostered,
  }
}
