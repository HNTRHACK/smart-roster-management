/**
 * Indexes over the scheduler input, built once and shared by the generator and the validator.
 * Everything is sorted by id here so later iteration is deterministic regardless of input order.
 */
import type { Assignment, Brand, BrandProcess, Employee, Pod, Process } from '../../types/db.ts'
import { addDays, formatDay, monthDates, weekdayOf, weeksOfMonth } from './dates.ts'
import { shiftMinutes } from './rules.ts'
import type { SchedulerInput } from './types.ts'

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export type AbsenceKind = 'LEAVE' | 'COMP_OFF'

export type Context = {
  month: string
  dates: string[]
  /** Mon–Sun weeks clipped to the month */
  weeks: string[][]
  /** the same weeks as full Mon–Sun runs of 7 dates, including days outside the month */
  fullWeeks: string[][]
  /** month dates plus the outside days of its boundary weeks (for demand look-ahead) */
  extendedDates: string[]
  holidays: Map<string, string> // date → name (all input holidays, not only this month's)
  employees: Employee[] // active, sorted by id
  employee: Map<string, Employee>
  brand: Map<string, Brand>
  pod: Map<string, Pod>
  process: Map<string, Process>
  brandProcesses: BrandProcess[] // of active brands, sorted by id
  brandProcess: Map<string, BrandProcess>
  primariesOf: Map<string, string[]> // bp → active primary employee ids
  backupsOf: Map<string, string[]> // bp → active backup employee ids
  primaryBpsOf: Map<string, string[]> // employee → bp ids they're primary on
  assignmentsOf: Map<string, Assignment[]> // employee → all assignments (active bps)
  /** employee → date → approved absence */
  absence: Map<string, Map<string, AbsenceKind>>
  shift: Map<string, [number, number]> // bp → minutes
  brandOf: (bpId: string) => Brand
  /** "Saltmarsh Swimwear · RET" */
  bpLabel: (bpId: string) => string
  name: (employeeId: string) => string
  day: (date: string) => string
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k)
  if (list) list.push(v)
  else m.set(k, [v])
}

export function buildContext(input: SchedulerInput): Context {
  const dates = monthDates(input.month)

  const employees = input.employees.filter((e) => e.active).sort(byId)
  const employee = new Map(employees.map((e) => [e.id, e]))
  const brand = new Map([...input.brands].sort(byId).map((b) => [b.id, b]))
  const pod = new Map([...input.pods].sort(byId).map((p) => [p.id, p]))
  const process = new Map([...input.processes].sort(byId).map((p) => [p.id, p]))

  const brandProcesses = input.brand_processes
    .filter((bp) => brand.get(bp.brand_id)?.active)
    .sort(byId)
  const brandProcess = new Map(brandProcesses.map((bp) => [bp.id, bp]))

  const primariesOf = new Map<string, string[]>()
  const backupsOf = new Map<string, string[]>()
  const primaryBpsOf = new Map<string, string[]>()
  const assignmentsOf = new Map<string, Assignment[]>()
  const assignments = [...input.assignments].sort(
    (a, b) => a.brand_process_id.localeCompare(b.brand_process_id) || a.employee_id.localeCompare(b.employee_id),
  )
  for (const a of assignments) {
    if (!employee.has(a.employee_id) || !brandProcess.has(a.brand_process_id)) continue
    push(assignmentsOf, a.employee_id, a)
    if (a.kind === 'primary') {
      push(primariesOf, a.brand_process_id, a.employee_id)
      push(primaryBpsOf, a.employee_id, a.brand_process_id)
    } else {
      push(backupsOf, a.brand_process_id, a.employee_id)
    }
  }
  for (const list of [...primariesOf.values(), ...backupsOf.values(), ...primaryBpsOf.values()]) list.sort()

  const absence = new Map<string, Map<string, AbsenceKind>>()
  for (const l of input.leaves) {
    if (l.status !== 'APPROVED' || !employee.has(l.employee_id)) continue
    const kind: AbsenceKind = l.type === 'COMP_OFF' ? 'COMP_OFF' : 'LEAVE'
    for (const d of dates) {
      if (d < l.start_date || d > l.end_date) continue
      if (!absence.has(l.employee_id)) absence.set(l.employee_id, new Map())
      const m = absence.get(l.employee_id)!
      // a planned/sick leave wins over a comp-off on the same day
      if (m.get(d) !== 'LEAVE') m.set(d, kind)
    }
  }

  const holidays = new Map(
    input.public_holidays.map((h) => [h.date, h.name] as const),
  )
  const weeks = weeksOfMonth(input.month)
  const fullWeeks = weeks.map((w) => {
    const monday = weekdayOf(w[0]) === 1 ? w[0] : addDays(w[0], -((weekdayOf(w[0]) + 6) % 7))
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  })
  const shift = new Map(brandProcesses.map((bp) => [bp.id, shiftMinutes(bp.shift_start, bp.shift_end)]))

  const brandOf = (bpId: string) => brand.get(brandProcess.get(bpId)!.brand_id)!
  const bpLabel = (bpId: string) => {
    const bp = brandProcess.get(bpId)!
    return `${brandOf(bpId).name} · ${process.get(bp.process_id)?.code ?? bp.process_id}`
  }

  return {
    month: input.month,
    dates,
    weeks,
    fullWeeks,
    extendedDates: [...new Set(fullWeeks.flat())].sort(),
    holidays,
    employees,
    employee,
    brand,
    pod,
    process,
    brandProcesses,
    brandProcess,
    primariesOf,
    backupsOf,
    primaryBpsOf,
    assignmentsOf,
    absence,
    shift,
    brandOf,
    bpLabel,
    name: (id) => employee.get(id)?.name ?? id,
    day: formatDay,
  }
}
