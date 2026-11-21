/**
 * npm run schedule -- 2026-12
 *
 * Generates a roster for the month from the demo seed (no database), validates it, and prints
 * coverage %, issue counts by code, and every HARD issue in full. Runs on Node's built-in TS.
 */
import { coverageStats, formatDay, scheduleMonth, type Issue } from '../src/lib/scheduler/index.ts'
import { buildSeedData, seedToSchedulerInput } from '../src/lib/seed/index.ts'
import { HARD_ISSUE_CODES as HARD_CODES, SOFT_ISSUE_CODES as SOFT_CODES } from '../src/types/db.ts'

function main(): void {
  const month = process.argv[2] ?? '2026-12'
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    console.error(`Usage: npm run schedule -- YYYY-MM   (got "${month}")`)
    process.exit(2)
  }

  const data = buildSeedData()
  const input = seedToSchedulerInput(data, month)
  const { roster, issues } = scheduleMonth(input)
  const stats = coverageStats(input, roster)

  const employee = new Map(data.employees.map((e) => [e.id, e.name]))
  const bp = new Map(data.brand_processes.map((x) => [x.id, x]))
  const brand = new Map(data.brands.map((b) => [b.id, b.name]))
  const proc = new Map(data.processes.map((p) => [p.id, p.code]))

  const count = (code: string) => issues.filter((i) => i.code === code).length
  const hard = issues.filter((i) => i.severity === 'HARD')
  const soft = issues.length - hard.length

  console.log(`Roster ${month} (demo seed: ${input.employees.length} employees, ${input.brands.length} brands)`)
  console.log()
  console.log(`  Coverage        ${stats.pct}% of required slots (${stats.coveredSlots}/${stats.requiredSlots})`)
  console.log(`  Backup covers   ${stats.backupCovers}`)
  console.log(`  Comp-offs       ${roster.comp_offs_earned.length} earned for working public holidays`)
  console.log(`  Issues          ${hard.length} HARD, ${soft} SOFT`)
  console.log()
  console.log('  By code')
  for (const code of HARD_CODES) console.log(`    HARD  ${code.padEnd(22)} ${count(code)}`)
  for (const code of SOFT_CODES) console.log(`    SOFT  ${code.padEnd(22)} ${count(code)}`)
  console.log()

  if (hard.length === 0) {
    console.log('  No HARD issues.')
    return
  }
  console.log(`  HARD issues (${hard.length})`)
  hard.forEach((i: Issue, n) => {
    const b = i.brand_process_id ? bp.get(i.brand_process_id) : undefined
    const where = b ? `${brand.get(b.brand_id)} / ${proc.get(b.process_id)}` : '-'
    console.log()
    console.log(`  ${String(n + 1).padStart(3)}. ${i.date ? formatDay(i.date) : 'month'}  ${i.code}  ${where}`)
    if (i.employee_id) console.log(`       Employee: ${employee.get(i.employee_id)}`)
    console.log(`       ${i.message}`)
    i.suggestion.forEach((s, k) => console.log(`       ${k + 1}) ${s.label}`))
  })
}

main()
