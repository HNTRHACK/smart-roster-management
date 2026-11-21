/**
 * Derives a summary from seed data. Everything is computed, nothing is hard-coded, so the
 * printed summary and the tests describe the data as it actually is.
 */
import type { CalendarRule, EmployeeRole } from '../../types/db.ts'
import type { SeedData } from './data.ts'

export interface BrandStaffing {
  brandId: string
  brand: string
  pod: string
  primaryEmployeeIds: string[]
  processes: string[]
  /** The brand's CS calendar rule, or its first process's rule if it has no CS. */
  mainRule: CalendarRule
}

export interface SeedSummary {
  employees: { total: number; byRole: Record<EmployeeRole, number>; withPreferredOff: number }
  brands: { total: number; single: number; multi: number; singlePct: number; staffing: BrandStaffing[] }
  multiBrandEmployees: { id: string; name: string; brands: string[] }[]
  assignments: { total: number; primary: number; backup: number }
  calendarMix: {
    byBrand: Record<CalendarRule, number>
    byBrandProcess: Record<CalendarRule, number>
  }
  leaves: { approvedPlanned: number; pending: number; compOff: number; total: number }
  compOffLedger: number
  coverageOverrides: number
  publicHolidays: string[]
}

const emptyRuleCount = (): Record<CalendarRule, number> => ({
  ALL_DAYS: 0,
  NO_PUBLIC_HOLIDAYS: 0,
  NO_SUN_NO_PH: 0,
  CUSTOM: 0,
})

/** Per brand: who works it as primary, and its main calendar rule. */
export function brandStaffing(data: SeedData): BrandStaffing[] {
  const processCode = new Map(data.processes.map((p) => [p.id, p.code]))
  const podName = new Map(data.pods.map((p) => [p.id, p.name]))

  return data.brands.map((b) => {
    const bps = data.brand_processes.filter((bp) => bp.brand_id === b.id)
    const bpIds = new Set(bps.map((bp) => bp.id))
    const primaries = new Set(
      data.assignments
        .filter((a) => a.kind === 'primary' && bpIds.has(a.brand_process_id))
        .map((a) => a.employee_id),
    )
    const cs = bps.find((bp) => processCode.get(bp.process_id) === 'CS')
    const main = cs ?? bps[0]
    if (!main) throw new Error(`seed: brand "${b.name}" has no processes`)
    return {
      brandId: b.id,
      brand: b.name,
      pod: podName.get(b.pod_id) ?? '?',
      primaryEmployeeIds: [...primaries].sort(),
      processes: bps.map((bp) => processCode.get(bp.process_id) ?? '?'),
      mainRule: main.calendar_rule,
    }
  })
}

export function summarizeSeed(data: SeedData): SeedSummary {
  const byRole: Record<EmployeeRole, number> = { agent: 0, pod_lead: 0, floater: 0 }
  for (const e of data.employees) byRole[e.role]++

  const staffing = brandStaffing(data)
  const single = staffing.filter((s) => s.primaryEmployeeIds.length === 1).length
  const multi = staffing.filter((s) => s.primaryEmployeeIds.length >= 2).length

  // Employees who are primary on processes of 2+ brands.
  const brandsByEmployee = new Map<string, Set<string>>()
  for (const s of staffing) {
    for (const id of s.primaryEmployeeIds) {
      if (!brandsByEmployee.has(id)) brandsByEmployee.set(id, new Set())
      brandsByEmployee.get(id)!.add(s.brand)
    }
  }
  const empName = new Map(data.employees.map((e) => [e.id, e.name]))
  const multiBrandEmployees = [...brandsByEmployee.entries()]
    .filter(([, brands]) => brands.size >= 2)
    .map(([id, brands]) => ({ id, name: empName.get(id) ?? id, brands: [...brands] }))
    .sort((a, b) => a.id.localeCompare(b.id))

  const byBrand = emptyRuleCount()
  for (const s of staffing) byBrand[s.mainRule]++
  const byBrandProcess = emptyRuleCount()
  for (const bp of data.brand_processes) byBrandProcess[bp.calendar_rule]++

  const primary = data.assignments.filter((a) => a.kind === 'primary').length

  return {
    employees: {
      total: data.employees.length,
      byRole,
      withPreferredOff: data.employees.filter((e) => e.preferred_off_weekday !== null).length,
    },
    brands: {
      total: data.brands.length,
      single,
      multi,
      singlePct: data.brands.length ? Math.round((single / data.brands.length) * 100) : 0,
      staffing,
    },
    multiBrandEmployees,
    assignments: { total: data.assignments.length, primary, backup: data.assignments.length - primary },
    calendarMix: { byBrand, byBrandProcess },
    leaves: {
      approvedPlanned: data.leaves.filter((l) => l.type === 'PLANNED' && l.status === 'APPROVED').length,
      pending: data.leaves.filter((l) => l.status === 'PENDING').length,
      compOff: data.leaves.filter((l) => l.type === 'COMP_OFF').length,
      total: data.leaves.length,
    },
    compOffLedger: data.comp_off_ledger.length,
    coverageOverrides: data.coverage_overrides.length,
    publicHolidays: data.public_holidays.map((h) => `${h.date} ${h.name}`),
  }
}

function pct(n: number, total: number): string {
  return total ? `${Math.round((n / total) * 100)}%` : '0%'
}

function ruleLine(counts: Record<CalendarRule, number>): string {
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  return (Object.keys(counts) as CalendarRule[])
    .filter((r) => counts[r] > 0)
    .map((r) => `${r} ${counts[r]} (${pct(counts[r], total)})`)
    .join(' · ')
}

/** Plain-text summary for the CLI. */
export function formatSummary(s: SeedSummary): string {
  const lines = [
    'Seed summary',
    `  Employees       ${s.employees.total}  (agents ${s.employees.byRole.agent}, pod leads ${s.employees.byRole.pod_lead}, floaters ${s.employees.byRole.floater}; ${s.employees.withPreferredOff} with a preferred off day)`,
    `  Brands          ${s.brands.total}  (single-resource ${s.brands.single} = ${s.brands.singlePct}%, multi-resource ${s.brands.multi})`,
    `  Multi-brand     ${s.multiBrandEmployees.map((m) => `${m.name} [${m.brands.join(' + ')}]`).join('; ') || 'none'}`,
    `  Assignments     ${s.assignments.total}  (primary ${s.assignments.primary}, backup ${s.assignments.backup})`,
    `  Calendar mix    by brand:         ${ruleLine(s.calendarMix.byBrand)}`,
    `                  by brand-process: ${ruleLine(s.calendarMix.byBrandProcess)}`,
    `  Leaves          ${s.leaves.total}  (approved planned ${s.leaves.approvedPlanned}, pending ${s.leaves.pending}, comp-off ${s.leaves.compOff}); comp-off ledger ${s.compOffLedger}`,
    `  Overrides       ${s.coverageOverrides}`,
    `  Holidays        ${s.publicHolidays.join(', ')}`,
    '',
    '  Multi-resource brands:',
    ...s.brands.staffing
      .filter((b) => b.primaryEmployeeIds.length >= 2)
      .map((b) => `    ${b.brand} (${b.pod}): ${b.primaryEmployeeIds.length} people on ${b.processes.join(' / ')}`),
  ]
  return lines.join('\n')
}
