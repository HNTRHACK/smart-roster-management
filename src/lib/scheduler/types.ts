/**
 * Scheduler API types. Shapes mirror the DB rows (snake_case) so Phase 4 can persist them
 * directly: a Roster is roster_days + roster_coverage without ids, an Issue is a roster_issues
 * row without ids.
 */
import type {
  Assignment,
  Brand,
  BrandProcess,
  CoverageOverride,
  Employee,
  IssueCode,
  IssueSeverity,
  Leave,
  Pod,
  Process,
  PublicHoliday,
  RosterCoverage,
  RosterDay,
  RosterDayStatus,
} from '../../types/db.ts'

/** Everything the scheduler needs for one month. Keys match DB table names. */
export type SchedulerInput = {
  /** "YYYY-MM" */
  month: string
  pods: Pod[]
  employees: Employee[]
  brands: Brand[]
  processes: Process[]
  brand_processes: BrandProcess[]
  coverage_overrides: CoverageOverride[]
  assignments: Assignment[]
  public_holidays: PublicHoliday[]
  /** All leaves; only APPROVED ones affect scheduling. */
  leaves: Leave[]
}

export type RosterDayEntry = Omit<RosterDay, 'id' | 'roster_id'>
export type CoverageEntry = Omit<RosterCoverage, 'id' | 'roster_id'>

export type CompOffEarned = { employee_id: string; date: string; reason: string }

export type Roster = {
  month: string
  /** One row per active employee per day of the month. */
  days: RosterDayEntry[]
  /** Who covers which brand-process on WORK days (is_backup marks backup cover). */
  coverage: CoverageEntry[]
  /** Public holidays worked → comp-off credits (to be written to comp_off_ledger). */
  comp_offs_earned: CompOffEarned[]
}

/** Machine-readable fix the UI can apply (Phase 5 "Apply"). */
export type SuggestionAction =
  | { type: 'ASSIGN_BACKUP'; employee_id: string; brand_process_id: string; date: string }
  | { type: 'MOVE_WEEK_OFF'; employee_id: string; from_date: string; to_date: string }
  | { type: 'SET_DAY_STATUS'; employee_id: string; date: string; status: RosterDayStatus }
  /** Setup change, not a roster edit: a person must be cross-trained / assigned first. */
  | { type: 'ADD_BACKUP_ASSIGNMENT'; brand_process_id: string }

export type Suggestion = { label: string; action?: SuggestionAction }

export type Issue = {
  severity: IssueSeverity
  code: IssueCode
  /** null for month-wide issues */
  date: string | null
  brand_process_id: string | null
  employee_id: string | null
  message: string
  suggestion: Suggestion[]
}

export type SchedulerOptions = {
  /**
   * Day rows the generator must keep exactly as given (locked cells and MANUAL edits).
   * They count toward weekly offs / consecutive days like any other day.
   */
  fixedDays?: RosterDayEntry[]
  /** Max brand-processes one person may cover on a day, incl. backup cover (spec §3.4). */
  dailyLoadCap?: number
  /** BACKUP_OVERLOAD fires above this many backup covers per month. */
  backupOverloadThreshold?: number
  /** UNFAIR_WEEKEND_OFFS fires when someone is this many weekend offs below the pod average. */
  unfairWeekendGap?: number
}

export const DEFAULT_OPTIONS = {
  dailyLoadCap: 3,
  backupOverloadThreshold: 8,
  unfairWeekendGap: 2,
} as const
