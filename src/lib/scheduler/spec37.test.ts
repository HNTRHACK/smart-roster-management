/**
 * The seven required scheduler tests from spec §3.7, written before the implementation.
 */
import { describe, expect, it } from 'vitest'
import { buildSeedData, seedToSchedulerInput } from '../seed/index.ts'
import { coverageStats, generateRoster, validateRoster } from './index.ts'
import type { SchedulerInput } from './types.ts'
import {
  assign,
  bp,
  brand,
  datesWithStatus,
  dayOf,
  editDay,
  employee,
  febWeek,
  holiday,
  leave,
  makeInput,
  scramble,
} from './test/fixtures.ts'

/** One employee alone on a 7-day CS brand; optionally a floater who backs it up. */
function soleAllDays(withBackup: boolean): SchedulerInput {
  return makeInput({
    employees: [
      employee('e1', { name: 'Solo Sam' }),
      ...(withBackup ? [employee('e2', { name: 'Floater Fay', role: 'floater' })] : []),
    ],
    brands: [brand('b1', { name: 'Sevenday Socks' })],
    brand_processes: [bp('bp1', 'b1', 'CS', 'ALL_DAYS')],
    assignments: [assign('e1', 'bp1'), ...(withBackup ? [assign('e2', 'bp1', 'backup')] : [])],
  })
}

function hardIssues(input: SchedulerInput) {
  const roster = generateRoster(input)
  const issues = validateRoster(input, roster)
  return { roster, issues, hard: issues.filter((i) => i.severity === 'HARD') }
}

describe('§3.7-1 single-resource ALL_DAYS brand', () => {
  it('has exactly one gap per week and raises a HARD issue for each when there is no backup', () => {
    const input = soleAllDays(false)
    const { roster, hard } = hardIssues(input)

    const offs = datesWithStatus(roster, 'e1', 'WEEK_OFF')
    expect(offs.map(febWeek)).toEqual([0, 1, 2, 3]) // one weekly off in each of the 4 weeks

    const gaps = coverageStats(input, roster).byBrandProcess.get('bp1')!.uncoveredDates
    expect(gaps).toEqual(offs) // the gap is exactly the off day
    expect(gaps.map(febWeek)).toEqual([0, 1, 2, 3])

    expect(hard).toHaveLength(4)
    for (const issue of hard) {
      expect(issue.code).toBe('UNCOVERED')
      expect(issue.brand_process_id).toBe('bp1')
      expect(offs).toContain(issue.date)
      expect(issue.message).toMatch(/Sevenday Socks/)
      // nobody can cover → the only fix is a setup change
      expect(issue.suggestion.map((s) => s.action?.type)).toContain('ADD_BACKUP_ASSIGNMENT')
    }
  })

  it('fills each weekly gap with the backup when one exists', () => {
    const input = soleAllDays(true)
    const { roster, hard } = hardIssues(input)

    expect(hard).toEqual([])
    const offs = datesWithStatus(roster, 'e1', 'WEEK_OFF')
    const backupCover = roster.coverage.filter((c) => c.is_backup).sort((a, b) => a.date.localeCompare(b.date))
    expect(backupCover.map((c) => c.date)).toEqual(offs)
    expect(backupCover.every((c) => c.employee_id === 'e2' && c.brand_process_id === 'bp1')).toBe(true)
    // the backup still gets their own weekly offs, just not on the sole agent's off days
    const backupOffs = datesWithStatus(roster, 'e2', 'WEEK_OFF')
    expect(backupOffs.map(febWeek)).toEqual([0, 1, 2, 3])
    expect(backupOffs.filter((d) => offs.includes(d))).toEqual([])
  })
})

describe('§3.7-2 NO_SUN_NO_PH employee', () => {
  it('gets Sunday as the weekly off with no gaps', () => {
    const input = makeInput({
      employees: [employee('e1')],
      brands: [brand('b1')],
      brand_processes: [bp('bp1', 'b1', 'CS', 'NO_SUN_NO_PH')],
      assignments: [assign('e1', 'bp1')],
    })
    const { roster, issues } = hardIssues(input)

    expect(datesWithStatus(roster, 'e1', 'NOT_SCHEDULED')).toEqual(['2027-02-07', '2027-02-14', '2027-02-21', '2027-02-28'])
    expect(datesWithStatus(roster, 'e1', 'WEEK_OFF')).toEqual([]) // Sunday already is the off
    expect(coverageStats(input, roster).byBrandProcess.get('bp1')!.uncoveredDates).toEqual([])
    expect(issues.filter((i) => i.severity === 'HARD')).toEqual([])
  })
})

describe('§3.7-3 three-person brand with one person on leave', () => {
  const threePeople = (minStaff: number) =>
    makeInput({
      employees: [employee('e1'), employee('e2'), employee('e3')],
      brands: [brand('b1', { name: 'Trio Tea' })],
      brand_processes: [bp('bp1', 'b1', 'CS', 'ALL_DAYS', { min_staff: minStaff })],
      assignments: [assign('e1', 'bp1'), assign('e2', 'bp1'), assign('e3', 'bp1')],
      leaves: [leave('e1', '2027-02-10')],
    })

  it('keeps coverage when the remaining two meet min_staff 2', () => {
    const input = threePeople(2)
    const { roster, hard } = hardIssues(input)
    expect(dayOf(roster, 'e1', '2027-02-10')?.status).toBe('LEAVE')
    expect(dayOf(roster, 'e2', '2027-02-10')?.status).toBe('WORK')
    expect(dayOf(roster, 'e3', '2027-02-10')?.status).toBe('WORK')
    expect(hard).toEqual([]) // offs are staggered around the leave
  })

  it('says coverage is lost when min_staff is 3', () => {
    const input = threePeople(3)
    const { hard } = hardIssues(input)
    const onLeaveDay = hard.filter((i) => i.date === '2027-02-10')
    expect(onLeaveDay).toHaveLength(1)
    expect(onLeaveDay[0].code).toBe('UNCOVERED')
    expect(onLeaveDay[0].message).toMatch(/needs 3/)
    expect(onLeaveDay[0].message).toMatch(/has 2/)
  })
})

describe('§3.7-4 public holiday on an ALL_DAYS process', () => {
  it('has the employee work it and earn a comp-off; a NO_PUBLIC_HOLIDAYS employee gets the day off', () => {
    const input = makeInput({
      employees: [employee('e1', { preferred_off_weekday: 0 }), employee('e2')],
      brands: [brand('b1'), brand('b2')],
      brand_processes: [bp('bp1', 'b1', 'CS', 'ALL_DAYS'), bp('bp2', 'b2', 'CS', 'NO_PUBLIC_HOLIDAYS')],
      assignments: [assign('e1', 'bp1'), assign('e2', 'bp2')],
      public_holidays: [holiday('2027-02-10')],
    })
    const roster = generateRoster(input)

    expect(dayOf(roster, 'e1', '2027-02-10')?.status).toBe('WORK')
    expect(roster.comp_offs_earned).toEqual([
      expect.objectContaining({ employee_id: 'e1', date: '2027-02-10' }),
    ])
    expect(dayOf(roster, 'e2', '2027-02-10')?.status).toBe('HOLIDAY')
  })
})

describe('§3.7-5 manual edits are re-validated', () => {
  it('flags a gap created by a manual edit', () => {
    const input = soleAllDays(true)
    const roster = generateRoster(input)
    expect(validateRoster(input, roster).filter((i) => i.severity === 'HARD')).toEqual([])

    // pick a day e1 works and nobody else covers, and give e1 the day off by hand
    const day = roster.days.find(
      (d) =>
        d.employee_id === 'e1' &&
        d.status === 'WORK' &&
        !roster.coverage.some((c) => c.date === d.date && c.employee_id === 'e2'),
    )!
    const edited = editDay(roster, 'e1', day.date, 'WEEK_OFF')
    const issues = validateRoster(input, edited)
    expect(issues).toContainEqual(
      expect.objectContaining({ severity: 'HARD', code: 'UNCOVERED', date: day.date, brand_process_id: 'bp1' }),
    )
    // the backup is working that day and is suggested
    const gap = issues.find((i) => i.code === 'UNCOVERED' && i.date === day.date)!
    expect(gap.suggestion[0].action).toEqual({ type: 'ASSIGN_BACKUP', employee_id: 'e2', brand_process_id: 'bp1', date: day.date })
  })

  it('flags WORK on an approved leave day', () => {
    const input = makeInput({
      employees: [employee('e1'), employee('e2')],
      brands: [brand('b1')],
      brand_processes: [bp('bp1', 'b1', 'CS', 'ALL_DAYS')],
      assignments: [assign('e1', 'bp1'), assign('e2', 'bp1')],
      leaves: [leave('e1', '2027-02-10')],
    })
    const edited = editDay(generateRoster(input), 'e1', '2027-02-10', 'WORK')
    expect(validateRoster(input, edited)).toContainEqual(
      expect.objectContaining({ severity: 'HARD', code: 'WORKING_ON_LEAVE', employee_id: 'e1', date: '2027-02-10' }),
    )
  })

  it('flags overlapping shifts on different brands, but not within one brand', () => {
    const input = makeInput({
      employees: [employee('e1')],
      brands: [brand('b1'), brand('b2')],
      brand_processes: [
        bp('bp1', 'b1', 'CS', 'ALL_DAYS'),
        bp('bp2', 'b1', 'ACC', 'ALL_DAYS'), // same brand, same hours → normal multitasking
        bp('bp3', 'b2', 'CS', 'ALL_DAYS', { shift_start: '12:00:00', shift_end: '20:00:00' }),
      ],
      assignments: [assign('e1', 'bp1'), assign('e1', 'bp2'), assign('e1', 'bp3')],
    })
    const roster = generateRoster(input)
    const overlaps = validateRoster(input, roster).filter((i) => i.code === 'SHIFT_OVERLAP')
    const workDays = datesWithStatus(roster, 'e1', 'WORK')
    // one issue per work day: b2 clashes with b1; bp1 vs bp2 (same brand) is never reported
    expect(overlaps.map((i) => i.date).sort()).toEqual(workDays)
    for (const i of overlaps) expect(i.message).toMatch(/Brand b1/)
  })
})

describe('§3.7-6 determinism', () => {
  it('produces an identical roster from the same input, regardless of input order', () => {
    const input = seedToSchedulerInput(buildSeedData(), '2026-12')
    const a = generateRoster(input)
    const b = generateRoster(input)
    expect(b).toEqual(a)

    const shuffled: SchedulerInput = {
      ...input,
      employees: scramble(input.employees),
      brands: scramble(input.brands),
      brand_processes: scramble(input.brand_processes),
      assignments: scramble(input.assignments),
      leaves: scramble(input.leaves),
      coverage_overrides: scramble(input.coverage_overrides),
      public_holidays: scramble(input.public_holidays),
    }
    expect(generateRoster(shuffled)).toEqual(a)
    expect(validateRoster(shuffled, a)).toEqual(validateRoster(input, a))
  })
})

describe('§3.7-7 locked days are kept unchanged', () => {
  it('keeps locked and manual days exactly and plans around them', () => {
    const input = soleAllDays(true)
    const fixedDays = [
      { employee_id: 'e1', date: '2027-02-03', status: 'WEEK_OFF' as const, source: 'MANUAL' as const, locked: true },
      { employee_id: 'e1', date: '2027-02-07', status: 'WORK' as const, source: 'MANUAL' as const, locked: true },
    ]
    const roster = generateRoster(input, { fixedDays })

    for (const f of fixedDays) expect(dayOf(roster, f.employee_id, f.date)).toEqual(f)
    // the fixed Wednesday off is e1's only off in week 1; the backup covers it
    expect(datesWithStatus(roster, 'e1', 'WEEK_OFF').filter((d) => febWeek(d) === 0)).toEqual(['2027-02-03'])
    expect(roster.coverage).toContainEqual(
      expect.objectContaining({ date: '2027-02-03', employee_id: 'e2', brand_process_id: 'bp1', is_backup: true }),
    )
    expect(validateRoster(input, roster).filter((i) => i.severity === 'HARD')).toEqual([])
  })

  it.todo('replan keeps locked days unchanged (spec §3.6, Phase 6)')
})
