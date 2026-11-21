import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSeedData, DEMO_BRANDS, renderSeedSql, summarizeSeed, type SeedData } from './index'

const data = buildSeedData()
const summary = summarizeSeed(data)

const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]))
const processCode = new Map(data.processes.map((p) => [p.id, p.code]))
const brandByName = new Map(data.brands.map((b) => [b.name, b]))
const staffingByName = new Map(summary.brands.staffing.map((s) => [s.brand, s]))

function brandProcesses(brandName: string) {
  const brand = brandByName.get(brandName)
  if (!brand) throw new Error(`no brand ${brandName}`)
  return data.brand_processes.filter((bp) => bp.brand_id === brand.id)
}

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

describe('seed: headline requirements (spec §4)', () => {
  it('has at least 30 employees', () => {
    expect(summary.employees.total).toBeGreaterThanOrEqual(30)
    expect(summary.employees.total).toBe(30) // 33 is infeasible, see docs/ASSUMPTIONS.md
  })

  it('splits 20 brands 80/20 into 16 single-resource and 4 multi-resource', () => {
    expect(summary.brands.total).toBe(20)
    expect(summary.brands.single).toBe(16)
    expect(summary.brands.multi).toBe(4)
    expect(summary.brands.single / summary.brands.total).toBe(0.8)
  })

  it('uses the four processes CS, ACC, NDR, RET', () => {
    expect(data.processes.map((p) => p.code).sort()).toEqual(['ACC', 'CS', 'NDR', 'RET'])
  })
})

describe('seed: pods and roles', () => {
  it('has 4 pods, each led by a pod_lead who belongs to that pod', () => {
    const employees = byId(data.employees)
    expect(data.pods).toHaveLength(4)
    for (const pod of data.pods) {
      const lead = employees.get(pod.lead_employee_id ?? '')
      expect(lead?.role, pod.name).toBe('pod_lead')
      expect(lead?.pod_id, pod.name).toBe(pod.id)
    }
  })

  it('gives every pod lead at least one backup assignment in their own pod', () => {
    const bpBrandPod = new Map(
      data.brand_processes.map((bp) => [bp.id, data.brands.find((b) => b.id === bp.brand_id)!.pod_id]),
    )
    for (const lead of data.employees.filter((e) => e.role === 'pod_lead')) {
      const backups = data.assignments.filter((a) => a.employee_id === lead.id && a.kind === 'backup')
      expect(backups.length, lead.name).toBeGreaterThan(0)
      for (const a of backups) expect(bpBrandPod.get(a.brand_process_id)).toBe(lead.pod_id)
    }
  })

  it('has 2 floaters, each backing up at least 3 different processes', () => {
    const floaters = data.employees.filter((e) => e.role === 'floater')
    expect(floaters).toHaveLength(2)
    const bps = byId(data.brand_processes)
    for (const f of floaters) {
      const assigned = data.assignments.filter((a) => a.employee_id === f.id)
      expect(assigned.every((a) => a.kind === 'backup'), f.name).toBe(true)
      const codes = new Set(assigned.map((a) => processCode.get(bps.get(a.brand_process_id)!.process_id)))
      expect(codes.size, f.name).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('seed: multi-resource brands', () => {
  it('Brand A: 3 people on separate processes CS / ACC / NDR', () => {
    const bps = brandProcesses(DEMO_BRANDS.A)
    expect(staffingByName.get(DEMO_BRANDS.A)?.primaryEmployeeIds).toHaveLength(3)
    expect(bps.map((bp) => processCode.get(bp.process_id)).sort()).toEqual(['ACC', 'CS', 'NDR'])
    for (const bp of bps) {
      expect(data.assignments.filter((a) => a.brand_process_id === bp.id && a.kind === 'primary')).toHaveLength(1)
    }
  })

  it('Brand B: 2 share CS (2 needed on Mondays and the sale day), 1 on ACC', () => {
    const bps = brandProcesses(DEMO_BRANDS.B)
    expect(staffingByName.get(DEMO_BRANDS.B)?.primaryEmployeeIds).toHaveLength(3)
    const cs = bps.find((bp) => processCode.get(bp.process_id) === 'CS')!
    const acc = bps.find((bp) => processCode.get(bp.process_id) === 'ACC')!
    expect(data.assignments.filter((a) => a.brand_process_id === cs.id && a.kind === 'primary')).toHaveLength(2)
    expect(data.assignments.filter((a) => a.brand_process_id === acc.id && a.kind === 'primary')).toHaveLength(1)
    const overrides = data.coverage_overrides.filter((o) => o.brand_process_id === cs.id)
    expect(overrides).toContainEqual(expect.objectContaining({ weekday: 1, date: null, min_staff: 2 }))
    expect(overrides).toContainEqual(expect.objectContaining({ weekday: null, date: '2026-12-26', min_staff: 2 }))
  })

  it('Brand C: 2 people on CS / RET', () => {
    expect(staffingByName.get(DEMO_BRANDS.C)?.primaryEmployeeIds).toHaveLength(2)
    expect(staffingByName.get(DEMO_BRANDS.C)?.processes.sort()).toEqual(['CS', 'RET'])
  })

  it('Brand D: 2 people, both primary on CS and NDR', () => {
    const people = staffingByName.get(DEMO_BRANDS.D)!.primaryEmployeeIds
    expect(people).toHaveLength(2)
    for (const bp of brandProcesses(DEMO_BRANDS.D)) {
      const primaries = data.assignments
        .filter((a) => a.brand_process_id === bp.id && a.kind === 'primary')
        .map((a) => a.employee_id)
        .sort()
      expect(primaries).toEqual(people)
    }
  })

  it('has 2–3 multi-brand employees whose shifts on different brands do not overlap', () => {
    expect(summary.multiBrandEmployees.length).toBeGreaterThanOrEqual(2)
    expect(summary.multiBrandEmployees.length).toBeLessThanOrEqual(3)
    const bps = byId(data.brand_processes)
    for (const m of summary.multiBrandEmployees) {
      const shifts = data.assignments
        .filter((a) => a.employee_id === m.id && a.kind === 'primary')
        .map((a) => bps.get(a.brand_process_id)!)
      for (const x of shifts) {
        for (const y of shifts) {
          if (x.brand_id === y.brand_id) continue
          const overlap =
            toMinutes(x.shift_start) < toMinutes(y.shift_end) && toMinutes(y.shift_start) < toMinutes(x.shift_end)
          expect(overlap, `${m.name}: ${x.id} vs ${y.id}`).toBe(false)
        }
      }
    }
  })
})

describe('seed: calendars, preferences, leaves', () => {
  it('mixes calendar rules ~40/35/25 across brands', () => {
    const { byBrand } = summary.calendarMix
    const near = (n: number, target: number) => Math.abs(n / summary.brands.total - target) <= 0.1
    expect(near(byBrand.ALL_DAYS, 0.4)).toBe(true)
    expect(near(byBrand.NO_PUBLIC_HOLIDAYS, 0.35)).toBe(true)
    expect(near(byBrand.NO_SUN_NO_PH, 0.25)).toBe(true)
  })

  it('has at least 2 brands where CS is ALL_DAYS and another process is NO_SUN_NO_PH', () => {
    const mixed = data.brands.filter((b) => {
      const bps = data.brand_processes.filter((bp) => bp.brand_id === b.id)
      const csAll = bps.some((bp) => processCode.get(bp.process_id) === 'CS' && bp.calendar_rule === 'ALL_DAYS')
      const otherSat = bps.some((bp) => processCode.get(bp.process_id) !== 'CS' && bp.calendar_rule === 'NO_SUN_NO_PH')
      return csAll && otherSat
    })
    expect(mixed.length).toBeGreaterThanOrEqual(2)
  })

  it('configures the three public holidays', () => {
    expect(data.public_holidays.map((h) => h.date).sort()).toEqual(['2026-12-25', '2027-01-01', '2027-01-26'])
  })

  it('gives about half the employees a preferred off day, incl. Sunday on 7-day brands', () => {
    const ratio = summary.employees.withPreferredOff / summary.employees.total
    expect(ratio).toBeGreaterThanOrEqual(0.4)
    expect(ratio).toBeLessThanOrEqual(0.6)

    const allDaysPrimaries = new Set(
      data.assignments
        .filter((a) => a.kind === 'primary')
        .filter((a) => data.brand_processes.find((bp) => bp.id === a.brand_process_id)?.calendar_rule === 'ALL_DAYS')
        .map((a) => a.employee_id),
    )
    const sundayOn365 = data.employees.filter((e) => e.preferred_off_weekday === 0 && allDaysPrimaries.has(e.id))
    expect(sundayOn365.length).toBeGreaterThanOrEqual(2)
  })

  it('has 5–6 approved planned leaves, 1 pending and 2 comp-offs in December 2026', () => {
    expect(summary.leaves.approvedPlanned).toBeGreaterThanOrEqual(5)
    expect(summary.leaves.approvedPlanned).toBeLessThanOrEqual(6)
    expect(summary.leaves.pending).toBe(1)
    expect(summary.leaves.compOff).toBe(2)
    for (const l of data.leaves) {
      expect(l.start_date >= '2026-12-01' && l.end_date <= '2026-12-31', l.id).toBe(true)
    }
  })

  it('backs every comp-off leave with a ledger entry used on that day', () => {
    for (const l of data.leaves.filter((x) => x.type === 'COMP_OFF')) {
      const entry = data.comp_off_ledger.find((c) => c.employee_id === l.employee_id && c.used_on === l.start_date)
      expect(entry, l.id).toBeDefined()
      expect(entry!.earned_on < l.start_date).toBe(true)
    }
  })
})

describe('seed: deliberate unfixable gap', () => {
  it('has a sole resource on an ALL_DAYS brand with no backup candidate (spec §3.4 rule)', () => {
    const brand = brandByName.get(DEMO_BRANDS.unfixableGap)!
    expect(staffingByName.get(brand.name)!.primaryEmployeeIds).toHaveLength(1)
    const bps = brandProcesses(brand.name)
    for (const bp of bps) {
      expect(bp.calendar_rule).toBe('ALL_DAYS')
      // 1. nobody holds a backup assignment for it
      expect(data.assignments.filter((a) => a.brand_process_id === bp.id && a.kind === 'backup')).toEqual([])
      // 2. nobody else in the same pod is assigned to the same process anywhere
      const samePodSameProcess = data.assignments.filter((a) => {
        if (a.brand_process_id === bp.id) return false
        const other = data.brand_processes.find((x) => x.id === a.brand_process_id)!
        const otherBrand = data.brands.find((b) => b.id === other.brand_id)!
        return other.process_id === bp.process_id && otherBrand.pod_id === brand.pod_id
      })
      expect(samePodSameProcess).toEqual([])
    }
  })
})

describe('seed: integrity (mirrors DB constraints)', () => {
  function expectFk(rows: Record<string, unknown>[], col: string, target: { id: string }[], nullable = false) {
    const ids = new Set(target.map((t) => t.id))
    for (const r of rows) {
      const v = r[col] as string | null
      if (v === null && nullable) continue
      expect(ids.has(v as string), `${col}=${v}`).toBe(true)
    }
  }

  it('resolves every foreign key', () => {
    const d: SeedData = data
    expectFk(d.pods as never, 'lead_employee_id', d.employees, true)
    expectFk(d.employees as never, 'pod_id', d.pods, true)
    expectFk(d.brands as never, 'pod_id', d.pods)
    expectFk(d.brand_processes as never, 'brand_id', d.brands)
    expectFk(d.brand_processes as never, 'process_id', d.processes)
    expectFk(d.coverage_overrides as never, 'brand_process_id', d.brand_processes)
    expectFk(d.assignments as never, 'employee_id', d.employees)
    expectFk(d.assignments as never, 'brand_process_id', d.brand_processes)
    expectFk(d.leaves as never, 'employee_id', d.employees)
    expectFk(d.comp_off_ledger as never, 'employee_id', d.employees)
  })

  it('keeps ids and unique keys unique', () => {
    const unique = (xs: unknown[]) => new Set(xs).size === xs.length
    for (const [table, rows] of Object.entries(data)) {
      expect(unique((rows as { id: string }[]).map((r) => r.id)), table).toBe(true)
    }
    expect(unique(data.employees.map((e) => e.email))).toBe(true)
    expect(unique(data.brands.map((b) => b.name))).toBe(true)
    expect(unique(data.brand_processes.map((bp) => `${bp.brand_id}|${bp.process_id}`))).toBe(true)
    expect(unique(data.assignments.map((a) => `${a.employee_id}|${a.brand_process_id}`))).toBe(true)
    expect(unique(data.public_holidays.map((h) => h.date))).toBe(true)
  })

  it('satisfies the check constraints', () => {
    for (const e of data.employees) {
      if (e.preferred_off_weekday !== null) expect(e.preferred_off_weekday).toBeGreaterThanOrEqual(0)
      expect(e.preferred_off_weekday ?? 0).toBeLessThanOrEqual(6)
    }
    for (const bp of data.brand_processes) {
      expect(bp.shift_start).not.toBe(bp.shift_end)
      expect(bp.calendar_rule === 'CUSTOM').toBe(bp.custom_weekdays !== null)
    }
    for (const o of data.coverage_overrides) expect([o.weekday, o.date].filter((v) => v !== null)).toHaveLength(1)
    for (const l of data.leaves) expect(l.end_date >= l.start_date).toBe(true)
  })

  it('gives every brand at least one primary and every brand-process a primary', () => {
    for (const bp of data.brand_processes) {
      expect(data.assignments.some((a) => a.brand_process_id === bp.id && a.kind === 'primary'), bp.id).toBe(true)
    }
  })
})

describe('seed: determinism and generated SQL', () => {
  it('builds identical data every time', () => {
    expect(buildSeedData()).toEqual(data)
  })

  it('keeps supabase/seed.sql in sync (regenerate with `npm run seed -- --sql`)', () => {
    const onDisk = readFileSync(join(process.cwd(), 'supabase', 'seed.sql'), 'utf8').replace(/\r\n/g, '\n')
    expect(onDisk).toBe(renderSeedSql(data))
  })
})
