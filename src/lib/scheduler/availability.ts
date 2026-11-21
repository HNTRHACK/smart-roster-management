/**
 * §3.2 Availability: each employee's status per date BEFORE weekly offs are placed.
 * Leave and comp-off are removed as availability here, so placement never touches them.
 */
import type { RosterDayStatus } from '../../types/db.ts'
import type { Context } from './context.ts'
import { required, type Demand } from './demand.ts'

/** 'WORK' here means "available to work"; weekly offs are carved out of these days in §3.3. */
export type BaseStatus = Extract<RosterDayStatus, 'WORK' | 'LEAVE' | 'COMP_OFF' | 'HOLIDAY' | 'NOT_SCHEDULED'>

/** Do any of this employee's primary brand-processes need people on this date? */
export function primaryOperates(ctx: Context, demand: Demand, employeeId: string, date: string): boolean {
  return (ctx.primaryBpsOf.get(employeeId) ?? []).some((bp) => required(demand, bp, date) > 0)
}

export function baseStatus(ctx: Context, demand: Demand, employeeId: string, date: string): BaseStatus {
  const absence = ctx.absence.get(employeeId)?.get(date)
  if (absence) return absence

  const hasPrimaries = (ctx.primaryBpsOf.get(employeeId)?.length ?? 0) > 0
  const operating = primaryOperates(ctx, demand, employeeId, date)
  if (ctx.holidays.has(date) && !operating) return 'HOLIDAY'
  // Floaters / pod leads (no primary work) are on duty every non-holiday day so they can back up.
  if (!hasPrimaries) return 'WORK'
  return operating ? 'WORK' : 'NOT_SCHEDULED'
}

/** employee → date → base status */
export function buildAvailability(ctx: Context, demand: Demand): Map<string, Map<string, BaseStatus>> {
  const out = new Map<string, Map<string, BaseStatus>>()
  for (const e of ctx.employees) {
    out.set(e.id, new Map(ctx.dates.map((d) => [d, baseStatus(ctx, demand, e.id, d)])))
  }
  return out
}

/**
 * Days of the given week's full Mon–Sun run that fall OUTSIDE the month and on which none of the
 * employee's primary brand-processes operate (and it isn't a public holiday). These count toward
 * that week's weekly off. Employees with no primary work never get this credit; leave outside
 * the month never counts.
 */
export function outsideStructuralOffs(ctx: Context, demand: Demand, employeeId: string, weekIndex: number): number {
  if ((ctx.primaryBpsOf.get(employeeId)?.length ?? 0) === 0) return 0
  const inMonth = new Set(ctx.weeks[weekIndex])
  return ctx.fullWeeks[weekIndex].filter(
    (d) => !inMonth.has(d) && !ctx.holidays.has(d) && !primaryOperates(ctx, demand, employeeId, d),
  ).length
}
