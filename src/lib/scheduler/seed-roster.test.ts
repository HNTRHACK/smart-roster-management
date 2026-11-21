/** End-to-end behaviour on the real demo seed (spec §4) for December 2026 and January 2027. */
import { describe, expect, it } from 'vitest'
import { buildSeedData, DEMO_BRANDS, seedToSchedulerInput } from '../seed/index.ts'
import { coverageStats, generateRoster, validateRoster } from './index.ts'
import { weekdayOf } from './dates.ts'

const seed = buildSeedData()
const empId = (name: string) => seed.employees.find((e) => e.name === name)!.id
const bpOf = (brandName: string, code: string) => {
  const b = seed.brands.find((x) => x.name === brandName)!
  const p = seed.processes.find((x) => x.code === code)!
  return seed.brand_processes.find((x) => x.brand_id === b.id && x.process_id === p.id)!.id
}

function run(month: string) {
  const input = seedToSchedulerInput(seed, month)
  const roster = generateRoster(input)
  return { input, roster, issues: validateRoster(input, roster) }
}

const dec = run('2026-12')

describe.each([['2026-12'], ['2027-01']])('generator hygiene for %s', (month) => {
  const { issues } = month === '2026-12' ? dec : run(month)
  it.each(['WORKING_ON_LEAVE', 'SHIFT_OVERLAP', 'TOO_MANY_CONSECUTIVE', 'MISSING_WEEKLY_OFF'])(
    'never produces %s itself (only coverage may fall short)',
    (code) => {
      expect(issues.filter((i) => i.code === code)).toEqual([])
    },
  )
})

describe('seed roster, December 2026', () => {
  it('shows Saltmarsh Swimwear as the unfixable gap: every weekly off is a HARD gap with no backup to suggest', () => {
    const salt = bpOf(DEMO_BRANDS.unfixableGap, 'RET')
    const zoya = empId('Zoya Khan')
    const gaps = dec.issues.filter((i) => i.severity === 'HARD' && i.brand_process_id === salt)
    const zoyaOffs = dec.roster.days.filter((d) => d.employee_id === zoya && d.status === 'WEEK_OFF').map((d) => d.date)

    expect(gaps.length).toBeGreaterThanOrEqual(4)
    expect(gaps.map((g) => g.date).sort()).toEqual(zoyaOffs.sort())
    for (const g of gaps) {
      const actions = g.suggestion.map((s) => s.action?.type)
      expect(actions).not.toContain('ASSIGN_BACKUP')
      expect(actions).toContain('ADD_BACKUP_ASSIGNMENT')
    }
  })

  it('staggers the two Bloom Botanics CS agents and keeps both on Mondays', () => {
    const [sneha, karan] = [empId('Sneha Patil'), empId('Karan Thakur')]
    const offs = (id: string) =>
      dec.roster.days.filter((d) => d.employee_id === id && d.status === 'WEEK_OFF').map((d) => d.date)
    const both = offs(sneha).filter((d) => offs(karan).includes(d))
    expect(both).toEqual([])
    for (const d of [...offs(sneha), ...offs(karan)]) expect(weekdayOf(d)).not.toBe(1)
  })

  it("puts Neha's weekly off on Sundays, when only one of her two brands operates", () => {
    const neha = empId('Neha Verma')
    const offs = dec.roster.days
      .filter((d) => d.employee_id === neha && d.status === 'WEEK_OFF' && d.date <= '2026-12-27')
      .map((d) => d.date)
    expect(offs.length).toBeGreaterThan(0)
    for (const d of offs) expect(weekdayOf(d)).toBe(0)
  })

  it("surfaces CROSS_BRAND_IMPACT for Neha's leave on 8–9 Dec", () => {
    const neha = empId('Neha Verma')
    const impact = dec.issues.filter((i) => i.code === 'CROSS_BRAND_IMPACT' && i.employee_id === neha)
    expect(impact.map((i) => i.date)).toEqual(expect.arrayContaining(['2026-12-08', '2026-12-09']))
    expect(impact[0].message).toMatch(/Nimbus Knitwear/)
    expect(impact[0].message).toMatch(/Bloom Botanics/)
  })

  it('credits a comp-off to sole agents who work Christmas on 7-day brands', () => {
    const riya = empId('Riya Kapoor') // Mellowbean Coffee, ALL_DAYS
    const christmas = dec.roster.days.find((d) => d.employee_id === riya && d.date === '2026-12-25')!
    expect(christmas.status).toBe('WORK')
    expect(dec.roster.comp_offs_earned).toContainEqual(expect.objectContaining({ employee_id: riya, date: '2026-12-25' }))
    // a NO_PUBLIC_HOLIDAYS-only agent gets the holiday instead
    const pooja = empId('Pooja Desai') // Ember Spice Co
    expect(dec.roster.days.find((d) => d.employee_id === pooja && d.date === '2026-12-25')!.status).toBe('HOLIDAY')
  })

  it('ignores the pending leave and honours approved ones', () => {
    const aman = empId('Aman Saxena') // pending 29–30 Dec
    expect(dec.roster.days.find((d) => d.employee_id === aman && d.date === '2026-12-29')!.status).not.toBe('LEAVE')
    const kavya = empId('Kavya Reddy') // approved 14–16 Dec
    expect(dec.roster.days.find((d) => d.employee_id === kavya && d.date === '2026-12-15')!.status).toBe('LEAVE')
  })

  it('covers most required slots and keeps every coverage row on a WORK day', () => {
    const stats = coverageStats(dec.input, dec.roster)
    expect(stats.pct).toBeGreaterThan(90)
    expect(stats.pct).toBeLessThan(100) // the deliberate gap exists
    const status = new Map(dec.roster.days.map((d) => [`${d.employee_id}|${d.date}`, d.status]))
    for (const c of dec.roster.coverage) expect(status.get(`${c.employee_id}|${c.date}`)).toBe('WORK')
  })
})
