/**
 * Rules shared by the generator and the validator, so both judge a roster the same way.
 */
import type { RosterDayStatus } from '../../types/db.ts'

/**
 * Offs needed in a (possibly partial) Mon–Sun week: weekly_offs pro-rated by the days the week
 * has in this month, rounded half up. With 1 off/week: 4–7 days → 1, 1–3 days → 0.
 */
export function requiredOffsForWeek(weeklyOffs: number, daysInWeek: number): number {
  return Math.floor((weeklyOffs * daysInWeek) / 7 + 0.5)
}

/** Statuses that count as the weekly off. HOLIDAY does not (holidays are extra; see ASSUMPTIONS). */
export function countsAsOff(status: RosterDayStatus | undefined): boolean {
  return status === 'WEEK_OFF' || status === 'NOT_SCHEDULED'
}

/** Statuses during which the person can't be given a weekly off (it would be wasted). */
export function isAbsence(status: RosterDayStatus | undefined): boolean {
  return status === 'LEAVE' || status === 'COMP_OFF' || status === 'HOLIDAY'
}

/**
 * Offs still owed in a week, given the statuses of its days. The requirement is capped by the
 * days that could hold an off (anything but leave / comp-off / holiday), so a week spent mostly
 * on leave doesn't demand impossible offs.
 */
export function weeklyOffShortfall(weeklyOffs: number, weekStatuses: (RosterDayStatus | undefined)[]): {
  required: number
  have: number
} {
  const usable = weekStatuses.filter((s) => s !== undefined && !isAbsence(s)).length
  const required = Math.min(requiredOffsForWeek(weeklyOffs, weekStatuses.length), usable)
  const have = weekStatuses.filter(countsAsOff).length
  return { required, have }
}

/** Longest run of consecutive WORK days. */
export function longestWorkRun(statuses: (RosterDayStatus | undefined)[]): number {
  let best = 0
  let run = 0
  for (const s of statuses) {
    run = s === 'WORK' ? run + 1 : 0
    if (run > best) best = run
  }
  return best
}

/** Shift as [start, end) minutes; an end at or before the start means it runs past midnight. */
export function shiftMinutes(start: string, end: string): [number, number] {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const s = toMin(start)
  let e = toMin(end)
  if (e <= s) e += 24 * 60
  return [s, e]
}

export function shiftsOverlap(a: [number, number], b: [number, number]): boolean {
  // compare b as-is and shifted by a day either way, to catch overnight shifts
  return [-1440, 0, 1440].some((d) => a[0] < b[1] + d && b[0] + d < a[1])
}

/** FNV-1a hash: a deterministic tie-breaker that spreads offs instead of always picking Monday. */
export function stableHash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
