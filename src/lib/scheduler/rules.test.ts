/** Demand calendar (§3.1), week maths, and validator rules on hand-made rosters (§3.5). */
import { describe, expect, it } from 'vitest'
import { buildDemand, coverageStats, generateRoster, requiredOffsForWeek, validateRoster, weeksOfMonth } from './index.ts'
import type { Roster } from './types.ts'
import { assign, bp, brand, employee, holiday, makeInput, override } from './test/fixtures.ts'

describe('§3.1 demand calendar', () => {
  const input = makeInput({
    brands: [brand('b1')],
    brand_processes: [
      bp('all', 'b1', 'CS', 'ALL_DAYS'),
      bp('noph', 'b1', 'ACC', 'NO_PUBLIC_HOLIDAYS'),
      bp('nosun', 'b1', 'NDR', 'NO_SUN_NO_PH'),
      bp('custom', 'b1', 'RET', 'CUSTOM', { custom_weekdays: [1, 3, 5] }), // Mon, Wed, Fri
    ],
    public_holidays: [holiday('2027-02-10')], // Wednesday
    coverage_overrides: [
      override('o1', 'all', 2, { weekday: 1 }), // Mondays need 2
      override('o2', 'all', 3, { date: '2027-02-01' }), // ...but this Monday needs 3
      override('o3', 'nosun', 2, { date: '2027-02-07' }), // Sunday: not operating, override ignored
    ],
  })
  const demand = buildDemand(input)
  const req = (bpId: string, date: string) => demand.get(bpId)!.get(date)

  it('applies each calendar rule', () => {
    expect(req('all', '2027-02-10')).toBe(1) // works public holidays
    expect(req('noph', '2027-02-10')).toBe(0)
    expect(req('noph', '2027-02-07')).toBe(1) // works Sundays
    expect(req('nosun', '2027-02-07')).toBe(0)
    expect(req('nosun', '2027-02-10')).toBe(0)
    expect(req('nosun', '2027-02-08')).toBe(1)
    expect(req('custom', '2027-02-01')).toBe(1) // Monday
    expect(req('custom', '2027-02-02')).toBe(0) // Tuesday
    expect(req('custom', '2027-02-10')).toBe(0) // Wednesday, but a public holiday
  })

  it('applies overrides: date beats weekday beats default, only on operating days', () => {
    expect(req('all', '2027-02-01')).toBe(3)
    expect(req('all', '2027-02-08')).toBe(2)
    expect(req('all', '2027-02-09')).toBe(1)
    expect(req('nosun', '2027-02-07')).toBe(0)
  })

  it('covers every day of the month and skips inactive brands', () => {
    const withInactive = makeInput({
      brands: [brand('b1', { active: false })],
      brand_processes: [bp('x', 'b1', 'CS', 'ALL_DAYS')],
    })
    expect(buildDemand(withInactive).has('x')).toBe(false)
    expect(demand.get('all')!.size).toBe(28)
  })
})

describe('weeks and pro-rated weekly offs', () => {
  it('splits a month into Mon–Sun weeks clipped to the month', () => {
    const weeks = weeksOfMonth('2026-12') // Dec 1 2026 is a Tuesday
    expect(weeks.map((w) => [w[0], w[w.length - 1]])).toEqual([
      ['2026-12-01', '2026-12-06'],
      ['2026-12-07', '2026-12-13'],
      ['2026-12-14', '2026-12-20'],
      ['2026-12-21', '2026-12-27'],
      ['2026-12-28', '2026-12-31'],
    ])
  })

  it('pro-rates partial weeks: 4+ days need 1 off, 1–3 days need none', () => {
    expect(requiredOffsForWeek(1, 7)).toBe(1)
    expect(requiredOffsForWeek(1, 6)).toBe(1)
    expect(requiredOffsForWeek(1, 4)).toBe(1)
    expect(requiredOffsForWeek(1, 3)).toBe(0)
    expect(requiredOffsForWeek(2, 7)).toBe(2)
    expect(requiredOffsForWeek(2, 3)).toBe(1)
  })
})

describe('backup covers concurrently within the load cap (§3.4, Phase 3.1 rule)', () => {
  // Two sole agents on different brands in one pod, both on CS 09–18, no backup assignments:
  // each is eligible for the other's brand via "same process in the same pod".
  const pair = (e2OwnProcesses: ('CS' | 'ACC' | 'NDR')[]) =>
    makeInput({
      employees: [
        employee('e1', { name: 'Ana', preferred_off_weekday: 1 }),
        employee('e2', { name: 'Ben', preferred_off_weekday: 2 }),
      ],
      brands: [brand('b1', { name: 'Alpha' }), brand('b2', { name: 'Beta' })],
      brand_processes: [
        bp('b1cs', 'b1', 'CS', 'ALL_DAYS'),
        ...e2OwnProcesses.map((code) => bp(`b2${code}`, 'b2', code, 'ALL_DAYS')),
      ],
      assignments: [assign('e1', 'b1cs'), ...e2OwnProcesses.map((code) => assign('e2', `b2${code}`))],
    })

  it('lets a backup cover another brand during their own shift, without SHIFT_OVERLAP', () => {
    const input = pair(['CS'])
    const roster = generateRoster(input)
    const issues = validateRoster(input, roster)

    expect(issues.filter((i) => i.severity === 'HARD')).toEqual([])
    // Ana's Monday offs are covered by Ben while he works Beta at the same hours
    const benBackup = roster.coverage.filter((c) => c.employee_id === 'e2' && c.is_backup)
    expect(benBackup.map((c) => c.brand_process_id)).toEqual(['b1cs', 'b1cs', 'b1cs', 'b1cs'])
    for (const c of benBackup) {
      expect(roster.coverage).toContainEqual({ employee_id: 'e2', date: c.date, brand_process_id: 'b2CS', is_backup: false })
    }
  })

  it('stops at 3 brand-processes a day (own + covered)', () => {
    const input = pair(['CS', 'ACC', 'NDR']) // Ben already has 3 of his own
    const roster = generateRoster(input)
    const anaOffs = roster.days.filter((d) => d.employee_id === 'e1' && d.status === 'WEEK_OFF').map((d) => d.date)
    const gaps = validateRoster(input, roster).filter((i) => i.code === 'UNCOVERED' && i.brand_process_id === 'b1cs')

    expect(gaps.map((g) => g.date)).toEqual(anaOffs)
    for (const g of gaps) expect(g.message).toMatch(/Ben \(at the daily limit of 3\)/)
  })
})

describe('boundary weeks count closed days just outside the month', () => {
  // Dec 2026 ends on Thursday 31; Sun 3 Jan is in the same Mon–Sun week.
  const input = makeInput({
    month: '2026-12',
    employees: [employee('monSat'), employee('everyDay')],
    brands: [brand('b1'), brand('b2')],
    brand_processes: [bp('bp1', 'b1', 'CS', 'NO_SUN_NO_PH'), bp('bp2', 'b2', 'CS', 'ALL_DAYS')],
    assignments: [assign('monSat', 'bp1'), assign('everyDay', 'bp2')],
  })
  const roster = generateRoster(input)
  const offsIn = (emp: string, from: string, to: string) =>
    roster.days.filter((d) => d.employee_id === emp && d.status === 'WEEK_OFF' && d.date >= from && d.date <= to)

  it('gives a Mon–Sat agent no off in 28–31 Dec, because Sun 3 Jan is already closed for them', () => {
    expect(offsIn('monSat', '2026-12-28', '2026-12-31')).toEqual([])
    expect(validateRoster(input, roster).filter((i) => i.code === 'MISSING_WEEKLY_OFF')).toEqual([])
  })

  it('still gives an every-day agent one off in that stub', () => {
    expect(offsIn('everyDay', '2026-12-28', '2026-12-31')).toHaveLength(1)
  })
})

describe('§3.5 validator on hand-made rosters', () => {
  const input = makeInput({
    employees: [employee('e1', { name: 'Tireless Tia' })],
    brands: [brand('b1')],
    brand_processes: [bp('bp1', 'b1', 'CS', 'ALL_DAYS')],
    assignments: [assign('e1', 'bp1')],
  })
  const dates = Array.from({ length: 28 }, (_, i) => `2027-02-${String(i + 1).padStart(2, '0')}`)
  const allWork: Roster = {
    month: '2027-02',
    days: dates.map((date) => ({ employee_id: 'e1', date, status: 'WORK', source: 'MANUAL', locked: false })),
    coverage: dates.map((date) => ({ employee_id: 'e1', date, brand_process_id: 'bp1', is_backup: false })),
    comp_offs_earned: [],
  }

  it('flags one TOO_MANY_CONSECUTIVE per run and MISSING_WEEKLY_OFF per week', () => {
    const issues = validateRoster(input, allWork)
    const consecutive = issues.filter((i) => i.code === 'TOO_MANY_CONSECUTIVE')
    expect(consecutive).toHaveLength(1)
    expect(consecutive[0].date).toBe('2027-02-07') // 7th straight day
    expect(consecutive[0].message).toMatch(/Tireless Tia/)
    const missing = issues.filter((i) => i.code === 'MISSING_WEEKLY_OFF')
    expect(missing.map((i) => i.date)).toEqual(['2027-02-01', '2027-02-08', '2027-02-15', '2027-02-22'])
    expect(issues.filter((i) => i.code === 'UNCOVERED')).toEqual([])
  })

  it('ignores coverage rows of people who are not working that day', () => {
    const offOnFirst: Roster = {
      ...allWork,
      days: allWork.days.map((d) => (d.date === '2027-02-01' ? { ...d, status: 'WEEK_OFF' } : d)),
    }
    const uncovered = validateRoster(input, offOnFirst).filter((i) => i.code === 'UNCOVERED')
    expect(uncovered.map((i) => i.date)).toEqual(['2027-02-01'])
  })

  it('uses NO_ASSIGNED_AVAILABLE when everyone assigned is on leave', () => {
    const withLeave = { ...input, leaves: [{ id: 'l1', employee_id: 'e1', start_date: '2027-02-03', end_date: '2027-02-03', type: 'SICK' as const, status: 'APPROVED' as const }] }
    const roster = generateRoster(withLeave)
    const issues = validateRoster(withLeave, roster).filter((i) => i.date === '2027-02-03')
    expect(issues.map((i) => i.code)).toEqual(['NO_ASSIGNED_AVAILABLE'])
  })

  it('reports coverage % of required slots', () => {
    const stats = coverageStats(input, allWork)
    expect(stats.requiredSlots).toBe(28)
    expect(stats.coveredSlots).toBe(28)
    expect(stats.pct).toBe(100)
  })
})
