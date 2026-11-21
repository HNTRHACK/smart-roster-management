/**
 * §3.4 Backup cover. The candidate rules live here so the generator (filling gaps) and the
 * validator (suggesting fixes) apply exactly the same eligibility and ranking.
 */
import type { RosterDayStatus } from '../../types/db.ts'
import type { Context } from './context.ts'
import { shiftsOverlap } from './rules.ts'

/** Read-only view of a roster that both the generator and the validator can provide. */
export type RosterView = {
  status: (employeeId: string, date: string) => RosterDayStatus | undefined
  /** bp ids this employee covers on this date (effective coverage only) */
  coversOn: (employeeId: string, date: string) => string[]
  /** backup covers this employee already has this month */
  backupCount: (employeeId: string) => number
}

export type BackupCandidate = { employeeId: string; samePod: boolean; reason: 'backup assignment' | 'same process in pod' }

/** Could this employee ever back up this brand-process (ignoring the day's schedule)? */
export function eligibleByAssignment(ctx: Context, employeeId: string, bpId: string): BackupCandidate['reason'] | null {
  if ((ctx.backupsOf.get(bpId) ?? []).includes(employeeId)) return 'backup assignment'
  const target = ctx.brandProcess.get(bpId)!
  const targetPod = ctx.brandOf(bpId).pod_id
  for (const a of ctx.assignmentsOf.get(employeeId) ?? []) {
    if (a.brand_process_id === bpId) continue
    const other = ctx.brandProcess.get(a.brand_process_id)!
    if (other.process_id === target.process_id && ctx.brandOf(other.id).pod_id === targetPod) return 'same process in pod'
  }
  return null
}

/**
 * Ranked people who could cover `bpId` on `date` right now:
 * working that day, not already on it, under the daily load cap, and with no shift clash on a
 * different brand. Ranked: same pod > fewer coverages that day > fewer backup covers this month > id.
 */
export function backupCandidates(
  ctx: Context,
  view: RosterView,
  bpId: string,
  date: string,
  loadCap: number,
): BackupCandidate[] {
  const targetBrand = ctx.brandOf(bpId)
  const targetShift = ctx.shift.get(bpId)!
  const out: (BackupCandidate & { load: number; backups: number })[] = []

  for (const e of ctx.employees) {
    const reason = eligibleByAssignment(ctx, e.id, bpId)
    if (!reason) continue
    if (view.status(e.id, date) !== 'WORK') continue
    const covers = view.coversOn(e.id, date)
    if (covers.includes(bpId) || covers.length >= loadCap) continue
    const clash = covers.some(
      (c) => ctx.brandOf(c).id !== targetBrand.id && shiftsOverlap(ctx.shift.get(c)!, targetShift),
    )
    if (clash) continue
    out.push({ employeeId: e.id, samePod: e.pod_id === targetBrand.pod_id, reason, load: covers.length, backups: view.backupCount(e.id) })
  }

  out.sort(
    (a, b) =>
      Number(b.samePod) - Number(a.samePod) ||
      a.load - b.load ||
      a.backups - b.backups ||
      a.employeeId.localeCompare(b.employeeId),
  )
  return out.map(({ employeeId, samePod, reason }) => ({ employeeId, samePod, reason }))
}
