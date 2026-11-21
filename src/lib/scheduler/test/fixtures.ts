/**
 * Tiny fixture builder for scheduler tests. Ids are readable strings ("e1", "bp1"), not UUIDs —
 * the scheduler only needs them to be stable and unique.
 *
 * Default month is Feb 2027: it starts on a Monday and has exactly 4 Mon–Sun weeks, which keeps
 * "one per week" assertions clean.
 */
import type {
  Assignment,
  AssignmentKind,
  Brand,
  BrandProcess,
  CalendarRule,
  CoverageOverride,
  Employee,
  Leave,
  LeaveType,
  PublicHoliday,
  Weekday,
} from '../../../types/db.ts'
import type { Roster, RosterDayEntry, SchedulerInput } from '../types.ts'

export const FEB = '2027-02'
export const POD = 'pod1'

export function employee(id: string, o: Partial<Employee> = {}): Employee {
  return {
    id,
    name: o.name ?? `Emp ${id}`,
    email: null,
    pod_id: POD,
    role: 'agent',
    weekly_offs_per_week: 1,
    max_consecutive_work_days: 6,
    preferred_off_weekday: null,
    active: true,
    ...o,
  }
}

export function brand(id: string, o: Partial<Brand> = {}): Brand {
  return { id, name: o.name ?? `Brand ${id}`, pod_id: POD, active: true, ...o }
}

export function bp(
  id: string,
  brandId: string,
  processCode: 'CS' | 'ACC' | 'NDR' | 'RET',
  rule: CalendarRule,
  o: Partial<BrandProcess> = {},
): BrandProcess {
  return {
    id,
    brand_id: brandId,
    process_id: processCode,
    calendar_rule: rule,
    custom_weekdays: null,
    min_staff: 1,
    shift_start: '09:00:00',
    shift_end: '18:00:00',
    ...o,
  }
}

let assignmentSeq = 0
export function assign(employeeId: string, bpId: string, kind: AssignmentKind = 'primary'): Assignment {
  assignmentSeq++
  return { id: `a-${employeeId}-${bpId}-${assignmentSeq}`, employee_id: employeeId, brand_process_id: bpId, kind }
}

export function leave(employeeId: string, start: string, end = start, type: LeaveType = 'PLANNED'): Leave {
  return { id: `l-${employeeId}-${start}`, employee_id: employeeId, start_date: start, end_date: end, type, status: 'APPROVED' }
}

export function holiday(date: string, name = 'Test Holiday'): PublicHoliday {
  return { id: `h-${date}`, date, name }
}

export function override(id: string, bpId: string, min_staff: number, at: { weekday?: Weekday; date?: string }): CoverageOverride {
  return { id, brand_process_id: bpId, weekday: at.weekday ?? null, date: at.date ?? null, min_staff }
}

export function makeInput(parts: Partial<Omit<SchedulerInput, 'processes' | 'pods'>> & { month?: string }): SchedulerInput {
  return {
    month: parts.month ?? FEB,
    pods: [{ id: POD, name: 'Pod One', lead_employee_id: null }],
    processes: [
      { id: 'CS', code: 'CS', name: 'Customer Support' },
      { id: 'ACC', code: 'ACC', name: 'Accounts' },
      { id: 'NDR', code: 'NDR', name: 'Non-Delivery Resolution' },
      { id: 'RET', code: 'RET', name: 'Retention' },
    ],
    employees: parts.employees ?? [],
    brands: parts.brands ?? [],
    brand_processes: parts.brand_processes ?? [],
    coverage_overrides: parts.coverage_overrides ?? [],
    assignments: parts.assignments ?? [],
    public_holidays: parts.public_holidays ?? [],
    leaves: parts.leaves ?? [],
  }
}

// ---- roster helpers --------------------------------------------------------
export function dayOf(roster: Roster, employeeId: string, date: string): RosterDayEntry | undefined {
  return roster.days.find((d) => d.employee_id === employeeId && d.date === date)
}

export function datesWithStatus(roster: Roster, employeeId: string, status: RosterDayEntry['status']): string[] {
  return roster.days
    .filter((d) => d.employee_id === employeeId && d.status === status)
    .map((d) => d.date)
    .sort()
}

/** Returns a copy of the roster with one day changed, as a manual edit would. */
export function editDay(roster: Roster, employeeId: string, date: string, status: RosterDayEntry['status']): Roster {
  return {
    ...roster,
    days: roster.days.map((d) =>
      d.employee_id === employeeId && d.date === date ? { ...d, status, source: 'MANUAL' as const } : d,
    ),
  }
}

/** Mon–Sun week index (0-based) of a Feb 2027 date — Feb 1 is a Monday. */
export function febWeek(date: string): number {
  return Math.floor((Number(date.slice(8, 10)) - 1) / 7)
}

/** Deterministic shuffle (reverse + rotate) for order-independence tests. */
export function scramble<T>(xs: T[]): T[] {
  const r = [...xs].reverse()
  return r.length > 2 ? [...r.slice(1), r[0]] : r
}
