/**
 * §3.1 Demand calendar: how many people each brand-process needs on each date.
 * This is the client's OPERATING calendar — separate from anyone's working schedule.
 */
import type { BrandProcess } from '../../types/db.ts'
import { buildContext, type Context } from './context.ts'
import { weekdayOf } from './dates.ts'
import type { SchedulerInput } from './types.ts'

/** bp id → date → required staff (0 = not operating) */
export type Demand = Map<string, Map<string, number>>

/** Does the brand-process operate on this date under its calendar rule? */
export function operates(bp: BrandProcess, date: string, isHoliday: boolean): boolean {
  const wd = weekdayOf(date)
  switch (bp.calendar_rule) {
    case 'ALL_DAYS':
      return true
    case 'NO_PUBLIC_HOLIDAYS':
      return !isHoliday
    case 'NO_SUN_NO_PH':
      return !isHoliday && wd !== 0
    case 'CUSTOM':
      // Assumption: CUSTOM calendars also close on public holidays.
      return !isHoliday && (bp.custom_weekdays ?? []).includes(wd)
  }
}

export function demandFromContext(ctx: Context, input: Pick<SchedulerInput, 'coverage_overrides'>): Demand {
  const byDate = new Map<string, number>() // "bp|date" → min_staff
  const byWeekday = new Map<string, number>() // "bp|weekday" → min_staff
  for (const o of input.coverage_overrides) {
    if (o.date !== null) byDate.set(`${o.brand_process_id}|${o.date}`, o.min_staff)
    else if (o.weekday !== null) byWeekday.set(`${o.brand_process_id}|${o.weekday}`, o.min_staff)
  }

  const demand: Demand = new Map()
  for (const bp of ctx.brandProcesses) {
    const perDate = new Map<string, number>()
    // extended to the boundary weeks' outside days, so weekly-off rules can look across months
    for (const date of ctx.extendedDates) {
      if (!operates(bp, date, ctx.holidays.has(date))) {
        perDate.set(date, 0)
        continue
      }
      // precedence: date override > weekday override > default
      const required =
        byDate.get(`${bp.id}|${date}`) ?? byWeekday.get(`${bp.id}|${weekdayOf(date)}`) ?? bp.min_staff
      perDate.set(date, Math.max(0, required))
    }
    demand.set(bp.id, perDate)
  }
  return demand
}

export function buildDemand(input: SchedulerInput): Demand {
  return demandFromContext(buildContext(input), input)
}

export function required(demand: Demand, bpId: string, date: string): number {
  return demand.get(bpId)?.get(date) ?? 0
}
