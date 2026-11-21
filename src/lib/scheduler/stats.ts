/** Coverage health: share of required (brand-process × date) slots that are covered. */
import { buildContext } from './context.ts'
import { demandFromContext } from './demand.ts'
import { indexRoster } from './rosterIndex.ts'
import type { Roster, SchedulerInput } from './types.ts'

export type BrandProcessCoverage = { requiredSlots: number; coveredSlots: number; uncoveredDates: string[] }

export type CoverageStats = {
  requiredSlots: number
  coveredSlots: number
  /** 0–100, one decimal; 100 when nothing is required */
  pct: number
  backupCovers: number
  byBrandProcess: Map<string, BrandProcessCoverage>
}

export function coverageStats(input: SchedulerInput, roster: Roster): CoverageStats {
  const ctx = buildContext(input)
  const demand = demandFromContext(ctx, input)
  const idx = indexRoster(ctx, roster)

  const byBrandProcess = new Map<string, BrandProcessCoverage>()
  let requiredSlots = 0
  let coveredSlots = 0
  let backupCovers = 0
  for (const bp of ctx.brandProcesses) {
    const row: BrandProcessCoverage = { requiredSlots: 0, coveredSlots: 0, uncoveredDates: [] }
    for (const date of ctx.dates) {
      const req = demand.get(bp.id)!.get(date)!
      if (req === 0) continue
      const coverers = idx.coverersOf(bp.id, date)
      const have = Math.min(req, coverers.length)
      row.requiredSlots += req
      row.coveredSlots += have
      if (coverers.length < req) row.uncoveredDates.push(date)
      backupCovers += coverers.filter((c) => c.isBackup).length
    }
    requiredSlots += row.requiredSlots
    coveredSlots += row.coveredSlots
    byBrandProcess.set(bp.id, row)
  }
  const pct = requiredSlots === 0 ? 100 : Math.round((coveredSlots / requiredSlots) * 1000) / 10
  return { requiredSlots, coveredSlots, pct, backupCovers, byBrandProcess }
}
