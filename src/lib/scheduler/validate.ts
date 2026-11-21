/**
 * §3.5 Validator. Runs on ANY roster — generated or hand-edited — using only (input, roster),
 * and reports every unmet rule as a HARD or SOFT issue with a plain-English message and
 * suggestions. Nothing is silently accepted.
 */
import type { RosterDayStatus } from '../../types/db.ts'
import { outsideStructuralOffs } from './availability.ts'
import { backupCandidates, eligibleByAssignment } from './backups.ts'
import { buildContext, type Context } from './context.ts'
import { isWeekend, WEEKDAY_NAMES, weekdayOf } from './dates.ts'
import { demandFromContext, required, type Demand } from './demand.ts'
import { indexRoster, type RosterIndex } from './rosterIndex.ts'
import { longestWorkRun, shiftsOverlap, weeklyOffShortfall } from './rules.ts'
import { DEFAULT_OPTIONS, type Issue, type Roster, type SchedulerInput, type SchedulerOptions, type Suggestion } from './types.ts'

const STATUS_WORDS: Record<RosterDayStatus, string> = {
  WORK: 'working',
  WEEK_OFF: 'weekly off',
  LEAVE: 'leave',
  COMP_OFF: 'comp-off',
  HOLIDAY: 'holiday',
  NOT_SCHEDULED: 'not scheduled',
}
const MAX_SUGGESTIONS = 3

type V = { ctx: Context; demand: Demand; idx: RosterIndex; opts: Required<Omit<SchedulerOptions, 'fixedDays'>> }

export function validateRoster(input: SchedulerInput, roster: Roster, options: SchedulerOptions = {}): Issue[] {
  const ctx = buildContext(input)
  const v: V = {
    ctx,
    demand: demandFromContext(ctx, input),
    idx: indexRoster(ctx, roster),
    opts: {
      dailyLoadCap: options.dailyLoadCap ?? DEFAULT_OPTIONS.dailyLoadCap,
      backupOverloadThreshold: options.backupOverloadThreshold ?? DEFAULT_OPTIONS.backupOverloadThreshold,
      unfairWeekendGap: options.unfairWeekendGap ?? DEFAULT_OPTIONS.unfairWeekendGap,
    },
  }

  const issues = [
    ...coverageGaps(v),
    ...workingOnLeave(v),
    ...shiftOverlaps(v),
    ...consecutiveDays(v),
    ...weeklyOffs(v),
    ...preferences(v),
    ...unfairWeekends(v),
    ...backupOverload(v),
    ...crossBrandImpact(v),
  ]
  return issues.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === 'HARD' ? -1 : 1) ||
      (a.date ?? '9999').localeCompare(b.date ?? '9999') ||
      a.code.localeCompare(b.code) ||
      (a.brand_process_id ?? '').localeCompare(b.brand_process_id ?? '') ||
      (a.employee_id ?? '').localeCompare(b.employee_id ?? ''),
  )
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function weekOf(ctx: Context, date: string): string[] {
  return ctx.weeks.find((w) => w.includes(date))!
}

function processCode(ctx: Context, bpId: string): string {
  const bp = ctx.brandProcess.get(bpId)!
  return ctx.process.get(bp.process_id)?.code ?? bp.process_id
}

/** Would giving `emp` an off on `date` (instead of working) leave any of their primaries short? */
function offCreatesGap(v: V, emp: string, date: string): boolean {
  return v.idx.coversOn(emp, date).some((bp) => v.idx.covered(bp, date) - 1 < required(v.demand, bp, date))
}

/** Statuses of an employee across the month, with optional overrides. */
function monthStatuses(v: V, emp: string, overrides: Record<string, RosterDayStatus> = {}) {
  return v.ctx.dates.map((d) => overrides[d] ?? v.idx.status(emp, d))
}

/** A move of `emp`'s weekly off from `from` to `to` that creates no new gap and no long run. */
function safeOffMove(v: V, emp: string, from: string, to: string): boolean {
  if (v.idx.status(emp, to) !== 'WORK' || v.idx.locked(emp, to) || v.idx.locked(emp, from)) return false
  if (offCreatesGap(v, emp, to)) return false
  const max = v.ctx.employee.get(emp)!.max_consecutive_work_days
  return longestWorkRun(monthStatuses(v, emp, { [from]: 'WORK', [to]: 'WEEK_OFF' })) <= max
}

// ---------------------------------------------------------------------------
// HARD
// ---------------------------------------------------------------------------
function coverageGaps(v: V): Issue[] {
  const { ctx, demand, idx } = v
  const out: Issue[] = []
  for (const date of ctx.dates) {
    for (const bp of ctx.brandProcesses) {
      const req = required(demand, bp.id, date)
      const have = idx.covered(bp.id, date)
      if (req === 0 || have >= req) continue

      const assigned = [...(ctx.primariesOf.get(bp.id) ?? []), ...(ctx.backupsOf.get(bp.id) ?? [])]
      const allAway = assigned.every((e) => ctx.absence.get(e)?.has(date))
      const primaries = ctx.primariesOf.get(bp.id) ?? []
      const why = primaries
        .filter((e) => idx.status(e, date) !== 'WORK')
        .map((e) => `${ctx.name(e)} is on ${STATUS_WORDS[idx.status(e, date) ?? 'NOT_SCHEDULED']}`)
      const reason =
        assigned.length === 0
          ? ' Nobody is assigned to it.'
          : allAway
            ? ` Everyone assigned is away (${assigned.map((e) => `${ctx.name(e)}: ${STATUS_WORDS[ctx.absence.get(e)!.get(date)!]}`).join(', ')}).`
            : why.length
              ? ` ${why.join('; ')}.`
              : ''

      const suggestion: Suggestion[] = []
      const candidates = backupCandidates(ctx, idx, bp.id, date, v.opts.dailyLoadCap)
      for (const c of candidates.slice(0, 2)) {
        suggestion.push({
          label: `Assign ${ctx.name(c.employeeId)} as backup (${c.reason}${c.samePod ? '' : ', other pod'})`,
          action: { type: 'ASSIGN_BACKUP', employee_id: c.employeeId, brand_process_id: bp.id, date },
        })
      }
      for (const p of primaries) {
        if (idx.status(p, date) !== 'WEEK_OFF') continue
        const to = weekOf(ctx, date).find((t) => t !== date && safeOffMove(v, p, date, t))
        if (to) {
          suggestion.push({
            label: `Move ${ctx.name(p)}'s weekly off from ${ctx.day(date)} to ${ctx.day(to)}`,
            action: { type: 'MOVE_WEEK_OFF', employee_id: p, from_date: date, to_date: to },
          })
        }
      }
      // People who could back this up in principle but aren't free today: say why, and offer
      // to move their weekly off if that's safe.
      const blocked = ctx.employees
        .map((e) => e.id)
        .filter(
          (e) =>
            !primaries.includes(e) &&
            eligibleByAssignment(ctx, e, bp.id) &&
            !candidates.some((c) => c.employeeId === e) &&
            !idx.coversOn(e, date).includes(bp.id),
        )
      const blockedWhy = blocked.map((e) => {
        const s = idx.status(e, date)
        if (s !== 'WORK') return `${ctx.name(e)} (${STATUS_WORDS[s ?? 'NOT_SCHEDULED']})`
        // working and eligible but not a candidate → the daily load cap is the only remaining reason
        return `${ctx.name(e)} (at the daily limit of ${v.opts.dailyLoadCap})`
      })
      for (const b of blocked) {
        if (idx.status(b, date) !== 'WEEK_OFF') continue
        const to = weekOf(ctx, date).find((t) => t !== date && safeOffMove(v, b, date, t))
        if (to) {
          suggestion.push({
            label: `Move backup ${ctx.name(b)}'s weekly off from ${ctx.day(date)} to ${ctx.day(to)}, then assign them`,
            action: { type: 'MOVE_WEEK_OFF', employee_id: b, from_date: date, to_date: to },
          })
        }
      }
      if (suggestion.length === 0) {
        const pod = ctx.pod.get(ctx.brandOf(bp.id).pod_id)?.name ?? 'the pod'
        suggestion.push({
          label:
            blocked.length === 0
              ? `No one can cover this. Add a backup for ${ctx.bpLabel(bp.id)}: nobody else in ${pod} works ${processCode(ctx, bp.id)}`
              : `No backup is free that day. Add another backup for ${ctx.bpLabel(bp.id)}`,
          action: { type: 'ADD_BACKUP_ASSIGNMENT', brand_process_id: bp.id },
        })
      }

      out.push({
        severity: 'HARD',
        code: allAway ? 'NO_ASSIGNED_AVAILABLE' : 'UNCOVERED',
        date,
        brand_process_id: bp.id,
        employee_id: primaries.length === 1 ? primaries[0] : null,
        message:
          `${ctx.bpLabel(bp.id)} needs ${req} on ${ctx.day(date)}, has ${have}.${reason}` +
          (blockedWhy.length ? ` Backups not free: ${blockedWhy.join(', ')}.` : ''),
        suggestion: suggestion.slice(0, MAX_SUGGESTIONS),
      })
    }
  }
  return out
}

function workingOnLeave(v: V): Issue[] {
  const { ctx, idx } = v
  const out: Issue[] = []
  for (const e of ctx.employees) {
    for (const [date, kind] of ctx.absence.get(e.id) ?? []) {
      if (idx.status(e.id, date) !== 'WORK') continue
      out.push({
        severity: 'HARD',
        code: 'WORKING_ON_LEAVE',
        date,
        brand_process_id: null,
        employee_id: e.id,
        message: `${e.name} is rostered to work on ${ctx.day(date)} but has an approved ${STATUS_WORDS[kind]}.`,
        suggestion: [
          { label: `Mark ${e.name} as ${STATUS_WORDS[kind]} on ${ctx.day(date)}`, action: { type: 'SET_DAY_STATUS', employee_id: e.id, date, status: kind } },
        ],
      })
    }
  }
  return out
}

function shiftOverlaps(v: V): Issue[] {
  const { ctx, idx } = v
  const out: Issue[] = []
  const hhmm = (bpId: string) => {
    const bp = ctx.brandProcess.get(bpId)!
    return `${bp.shift_start.slice(0, 5)}–${bp.shift_end.slice(0, 5)}`
  }
  for (const e of ctx.employees) {
    for (const date of ctx.dates) {
      // Primary work only: backup cover may run concurrently within the load cap.
      const covers = idx.primaryCoversOn(e.id, date)
      let clash: [string, string] | null = null
      for (let i = 0; i < covers.length && !clash; i++) {
        for (let j = i + 1; j < covers.length && !clash; j++) {
          const [a, b] = [covers[i], covers[j]]
          if (ctx.brandOf(a).id !== ctx.brandOf(b).id && shiftsOverlap(ctx.shift.get(a)!, ctx.shift.get(b)!)) clash = [a, b]
        }
      }
      if (!clash) continue
      const [a, b] = clash
      out.push({
        severity: 'HARD',
        code: 'SHIFT_OVERLAP',
        date,
        brand_process_id: b,
        employee_id: e.id,
        message: `${e.name} covers ${ctx.bpLabel(a)} (${hhmm(a)}) and ${ctx.bpLabel(b)} (${hhmm(b)}) at the same time on ${ctx.day(date)}.`,
        suggestion: [{ label: `Give ${ctx.bpLabel(b)} to someone else that day, or change one brand's shift` }],
      })
    }
  }
  return out
}

function consecutiveDays(v: V): Issue[] {
  const { ctx, idx } = v
  const out: Issue[] = []
  for (const e of ctx.employees) {
    if (!idx.rostered.has(e.id)) continue
    let run = 0
    let start = ''
    for (const date of ctx.dates) {
      if (idx.status(e.id, date) !== 'WORK') {
        run = 0
        continue
      }
      if (run === 0) start = date
      run++
      if (run !== e.max_consecutive_work_days + 1) continue
      out.push({
        severity: 'HARD',
        code: 'TOO_MANY_CONSECUTIVE',
        date,
        brand_process_id: null,
        employee_id: e.id,
        message: `${e.name} works more than ${e.max_consecutive_work_days} days in a row (from ${ctx.day(start)}).`,
        suggestion: [
          { label: `Give ${e.name} a weekly off on ${ctx.day(date)}`, action: { type: 'SET_DAY_STATUS', employee_id: e.id, date, status: 'WEEK_OFF' } },
        ],
      })
    }
  }
  return out
}

function weeklyOffs(v: V): Issue[] {
  const { ctx, idx } = v
  const out: Issue[] = []
  for (const e of ctx.employees) {
    if (!idx.rostered.has(e.id)) continue
    for (const [wi, week] of ctx.weeks.entries()) {
      const statuses = week.map((d) => idx.status(e.id, d))
      if (statuses.every((s) => s === undefined)) continue
      const outside = outsideStructuralOffs(ctx, v.demand, e.id, wi)
      const { required: need, have } = weeklyOffShortfall(e.weekly_offs_per_week, statuses, outside)
      if (have >= need) continue
      const safeDay = week.find((d) => idx.status(e.id, d) === 'WORK' && !idx.locked(e.id, d) && !offCreatesGap(v, e.id, d))
      out.push({
        severity: 'HARD',
        code: 'MISSING_WEEKLY_OFF',
        date: week[0],
        brand_process_id: null,
        employee_id: e.id,
        message: `${e.name} has ${have} of ${need} weekly off${need === 1 ? '' : 's'} in the week of ${ctx.day(week[0])}.`,
        suggestion: safeDay
          ? [{ label: `Give ${e.name} ${ctx.day(safeDay)} off`, action: { type: 'SET_DAY_STATUS', employee_id: e.id, date: safeDay, status: 'WEEK_OFF' } }]
          : [{ label: `Every working day that week is needed for cover; arrange a backup, then give ${e.name} a day off` }],
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// SOFT
// ---------------------------------------------------------------------------
function preferences(v: V): Issue[] {
  const { ctx, idx } = v
  const out: Issue[] = []
  for (const e of ctx.employees) {
    if (e.preferred_off_weekday === null || !idx.rostered.has(e.id)) continue
    const prefName = WEEKDAY_NAMES[e.preferred_off_weekday]
    for (const week of ctx.weeks) {
      const off = week.find((d) => idx.status(e.id, d) === 'WEEK_OFF')
      const pref = week.find((d) => weekdayOf(d) === e.preferred_off_weekday)
      if (!off || !pref || idx.status(e.id, pref) !== 'WORK') continue
      const needed = idx
        .coversOn(e.id, pref)
        .filter((bp) => idx.covered(bp, pref) - 1 < required(v.demand, bp, pref))
        .map((bp) => ctx.bpLabel(bp))
      const canMove = safeOffMove(v, e.id, off, pref)
      out.push({
        severity: 'SOFT',
        code: 'PREFERENCE_VIOLATED',
        date: off,
        brand_process_id: null,
        employee_id: e.id,
        message:
          `${e.name} prefers ${prefName}s off but got ${ctx.day(off)}.` +
          (needed.length ? ` ${ctx.day(pref)} is needed for ${needed.join(', ')}.` : ''),
        suggestion: canMove
          ? [{ label: `Move the off to ${ctx.day(pref)}`, action: { type: 'MOVE_WEEK_OFF', employee_id: e.id, from_date: off, to_date: pref } }]
          : [{ label: `Keep as is: coverage beats preference. A backup on ${ctx.day(pref)} would allow the swap` }],
      })
    }
  }
  return out
}

function unfairWeekends(v: V): Issue[] {
  const { ctx, idx } = v
  const out: Issue[] = []
  for (const pod of ctx.pod.values()) {
    // only people who actually work some weekends are compared
    const members = ctx.employees.filter(
      (e) =>
        e.pod_id === pod.id &&
        ctx.dates.some((d) => isWeekend(d) && (idx.status(e.id, d) === 'WORK' || idx.status(e.id, d) === 'WEEK_OFF')),
    )
    if (members.length < 2) continue
    const count = new Map(
      members.map((e) => [e.id, ctx.dates.filter((d) => isWeekend(d) && idx.status(e.id, d) === 'WEEK_OFF').length]),
    )
    const avg = [...count.values()].reduce((a, b) => a + b, 0) / members.length
    for (const e of members) {
      const n = count.get(e.id)!
      if (avg - n < v.opts.unfairWeekendGap) continue
      out.push({
        severity: 'SOFT',
        code: 'UNFAIR_WEEKEND_OFFS',
        date: null,
        brand_process_id: null,
        employee_id: e.id,
        message: `${e.name} has ${n} weekend off${n === 1 ? '' : 's'} this month; the ${pod.name} average is ${avg.toFixed(1)}.`,
        suggestion: [{ label: `Swap one of ${e.name}'s weekday offs for a Saturday or Sunday where cover allows` }],
      })
    }
  }
  return out
}

function backupOverload(v: V): Issue[] {
  const { ctx, idx } = v
  const out: Issue[] = []
  for (const e of ctx.employees) {
    const n = idx.backupCount(e.id)
    if (n <= v.opts.backupOverloadThreshold) continue
    out.push({
      severity: 'SOFT',
      code: 'BACKUP_OVERLOAD',
      date: null,
      brand_process_id: null,
      employee_id: e.id,
      message: `${e.name} is used as backup ${n} times this month (more than ${v.opts.backupOverloadThreshold}).`,
      suggestion: [{ label: `Cross-train another person on the brands ${e.name} covers most, to share the load` }],
    })
  }
  return out
}

function crossBrandImpact(v: V): Issue[] {
  const { ctx, demand, idx } = v
  const out: Issue[] = []
  for (const e of ctx.employees) {
    const bps = ctx.primaryBpsOf.get(e.id) ?? []
    if (bps.length < 2) continue
    for (const date of ctx.dates) {
      const s = idx.status(e.id, date)
      if (s === undefined || s === 'WORK') continue
      // brand-processes this absence leaves short on primaries alone
      const hit = bps.filter((bp) => {
        const req = required(demand, bp, date)
        const primariesWorking = (ctx.primariesOf.get(bp) ?? []).filter((q) => idx.status(q, date) === 'WORK').length
        return req > 0 && primariesWorking < req
      })
      const brands = new Set(hit.map((bp) => ctx.brandOf(bp).id))
      if (brands.size < 2) continue
      const parts = hit.map(
        (bp) => `${ctx.bpLabel(bp)} (${idx.covered(bp, date) >= required(demand, bp, date) ? 'covered by backup' : 'still open'})`,
      )
      out.push({
        severity: 'SOFT',
        code: 'CROSS_BRAND_IMPACT',
        date,
        brand_process_id: hit[0],
        employee_id: e.id,
        message: `${e.name}'s ${STATUS_WORDS[s]} on ${ctx.day(date)} affects ${brands.size} brands: ${parts.join(', ')}.`,
        suggestion: [{ label: `Plan backups for every brand ${e.name} works on before approving time off` }],
      })
    }
  }
  return out
}
