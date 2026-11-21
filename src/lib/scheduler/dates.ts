/** ISO date helpers. UTC only, so results never depend on the machine's time zone. */
import type { Weekday } from '../../types/db.ts'

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

export function parseMonth(month: string): { year: number; month: number } {
  const m = MONTH_RE.exec(month)
  if (!m) throw new Error(`Invalid month "${month}": expected YYYY-MM`)
  return { year: Number(m[1]), month: Number(m[2]) }
}

function toUtc(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Every date of the month, in order. */
export function monthDates(month: string): string[] {
  const { year, month: m } = parseMonth(month)
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate()
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}

export function weekdayOf(date: string): Weekday {
  return new Date(toUtc(date)).getUTCDay() as Weekday
}

export function addDays(date: string, n: number): string {
  return fromUtc(toUtc(date) + n * 86_400_000)
}

export function isWeekend(date: string): boolean {
  const d = weekdayOf(date)
  return d === 0 || d === 6
}

/** Mon–Sun weeks of the month, clipped to the month (first/last weeks may be partial). */
export function weeksOfMonth(month: string): string[][] {
  const weeks: string[][] = []
  for (const date of monthDates(month)) {
    if (weeks.length === 0 || weekdayOf(date) === 1) weeks.push([])
    weeks[weeks.length - 1].push(date)
  }
  return weeks
}

/** "Tue 8 Dec" */
export function formatDay(date: string): string {
  return `${DAY_NAMES[weekdayOf(date)]} ${Number(date.slice(8, 10))} ${MONTH_NAMES[Number(date.slice(5, 7)) - 1]}`
}
