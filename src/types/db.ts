/**
 * Database types mirroring supabase/migrations/20261122000000_init_schema.sql (spec §2).
 *
 * Hand-written for Phase 1. Can be replaced by `npx supabase gen types typescript --local`;
 * src/types/db.test.ts checks that these enums and table names stay in sync with the migration.
 *
 * Conventions: ids are uuid strings, `date` columns are ISO "YYYY-MM-DD" strings,
 * `time` columns are "HH:MM:SS" strings, `timestamptz` are ISO timestamps.
 */

// ---------------------------------------------------------------------------
// Enums (const arrays are the single source for both runtime checks and types)
// ---------------------------------------------------------------------------
export const EMPLOYEE_ROLES = ['agent', 'pod_lead', 'floater'] as const
export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number]

export const CALENDAR_RULES = ['ALL_DAYS', 'NO_PUBLIC_HOLIDAYS', 'NO_SUN_NO_PH', 'CUSTOM'] as const
export type CalendarRule = (typeof CALENDAR_RULES)[number]

export const ASSIGNMENT_KINDS = ['primary', 'backup'] as const
export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number]

export const LEAVE_TYPES = ['PLANNED', 'SICK', 'COMP_OFF'] as const
export type LeaveType = (typeof LEAVE_TYPES)[number]

export const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const
export type LeaveStatus = (typeof LEAVE_STATUSES)[number]

export const ROSTER_STATUSES = ['DRAFT', 'PUBLISHED'] as const
export type RosterStatus = (typeof ROSTER_STATUSES)[number]

export const ROSTER_DAY_STATUSES = [
  'WORK',
  'WEEK_OFF',
  'LEAVE',
  'COMP_OFF',
  'HOLIDAY',
  'NOT_SCHEDULED',
] as const
export type RosterDayStatus = (typeof ROSTER_DAY_STATUSES)[number]

export const ROSTER_DAY_SOURCES = ['AUTO', 'MANUAL'] as const
export type RosterDaySource = (typeof ROSTER_DAY_SOURCES)[number]

export const ISSUE_SEVERITIES = ['HARD', 'SOFT'] as const
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number]

/** Postgres enum type name → allowed values. Used by the schema-sync test. */
export const DB_ENUMS = {
  employee_role: EMPLOYEE_ROLES,
  calendar_rule: CALENDAR_RULES,
  assignment_kind: ASSIGNMENT_KINDS,
  leave_type: LEAVE_TYPES,
  leave_status: LEAVE_STATUSES,
  roster_status: ROSTER_STATUSES,
  roster_day_status: ROSTER_DAY_STATUSES,
  roster_day_source: ROSTER_DAY_SOURCES,
  issue_severity: ISSUE_SEVERITIES,
} as const

// Issue codes are stored as text in roster_issues.code (spec §3.5).
export const HARD_ISSUE_CODES = [
  'UNCOVERED',
  'NO_ASSIGNED_AVAILABLE',
  'WORKING_ON_LEAVE',
  'SHIFT_OVERLAP',
  'TOO_MANY_CONSECUTIVE',
  'MISSING_WEEKLY_OFF',
] as const
export const SOFT_ISSUE_CODES = [
  'PREFERENCE_VIOLATED',
  'UNFAIR_WEEKEND_OFFS',
  'BACKUP_OVERLOAD',
  'CROSS_BRAND_IMPACT',
] as const
export type HardIssueCode = (typeof HARD_ISSUE_CODES)[number]
export type SoftIssueCode = (typeof SOFT_ISSUE_CODES)[number]
export type IssueCode = HardIssueCode | SoftIssueCode

/** 0 = Sunday … 6 = Saturday (matches JS Date#getDay and the DB check constraints). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------
export type Pod = {
  id: string
  name: string
  lead_employee_id: string | null
}

export type Employee = {
  id: string
  name: string
  email: string | null
  pod_id: string | null
  role: EmployeeRole
  weekly_offs_per_week: number
  max_consecutive_work_days: number
  preferred_off_weekday: Weekday | null
  active: boolean
}

export type Process = {
  id: string
  code: string // 'CS' | 'ACC' | 'NDR' | 'RET' | … (open-ended by design)
  name: string
}

export type Brand = {
  id: string
  name: string
  pod_id: string
  active: boolean
}

export type BrandProcess = {
  id: string
  brand_id: string
  process_id: string
  calendar_rule: CalendarRule
  custom_weekdays: Weekday[] | null
  min_staff: number
  shift_start: string
  shift_end: string
}

export type CoverageOverride = {
  id: string
  brand_process_id: string
  weekday: Weekday | null
  date: string | null
  min_staff: number
}

export type Assignment = {
  id: string
  employee_id: string
  brand_process_id: string
  kind: AssignmentKind
}

export type PublicHoliday = {
  id: string
  date: string
  name: string
}

export type Leave = {
  id: string
  employee_id: string
  start_date: string
  end_date: string
  type: LeaveType
  status: LeaveStatus
}

export type CompOffLedgerEntry = {
  id: string
  employee_id: string
  earned_on: string
  reason: string
  used_on: string | null
}

export type Roster = {
  id: string
  month: string // first day of month, "YYYY-MM-01"
  version: number
  status: RosterStatus
  created_at: string
  notes: string | null
}

export type RosterDay = {
  id: string
  roster_id: string
  employee_id: string
  date: string
  status: RosterDayStatus
  source: RosterDaySource
  locked: boolean
}

export type RosterCoverage = {
  id: string
  roster_id: string
  date: string
  employee_id: string
  brand_process_id: string
  is_backup: boolean
}

export type IssueSuggestion = {
  label: string
  /** Machine-readable action the UI can apply (shape defined by the scheduler in Phase 3). */
  action?: { [key: string]: Json | undefined }
}

export type RosterIssue = {
  id: string
  roster_id: string
  date: string | null
  severity: IssueSeverity
  code: IssueCode | (string & {})
  brand_process_id: string | null
  employee_id: string | null
  message: string
  suggestion: IssueSuggestion[]
}

export type ChangeLogEntry = {
  id: string
  roster_id: string | null
  at: string
  actor: string
  action: string
  payload: { [key: string]: Json | undefined }
}

// ---------------------------------------------------------------------------
// supabase-js Database shape
// ---------------------------------------------------------------------------
/** Insert = Row with defaulted/nullable columns optional; Update = any subset. */
type TableDef<Row, Optional extends keyof Row> = {
  Row: Row
  Insert: Omit<Row, Optional> & Partial<Pick<Row, Optional>>
  Update: Partial<Row>
  Relationships: []
}

export const TABLE_NAMES = [
  'pods',
  'employees',
  'processes',
  'brands',
  'brand_processes',
  'coverage_overrides',
  'assignments',
  'public_holidays',
  'leaves',
  'comp_off_ledger',
  'rosters',
  'roster_days',
  'roster_coverage',
  'roster_issues',
  'change_log',
] as const
export type TableName = (typeof TABLE_NAMES)[number]

export type Database = {
  public: {
    Tables: {
      pods: TableDef<Pod, 'id' | 'lead_employee_id'>
      employees: TableDef<
        Employee,
        | 'id'
        | 'email'
        | 'pod_id'
        | 'role'
        | 'weekly_offs_per_week'
        | 'max_consecutive_work_days'
        | 'preferred_off_weekday'
        | 'active'
      >
      processes: TableDef<Process, 'id'>
      brands: TableDef<Brand, 'id' | 'active'>
      brand_processes: TableDef<
        BrandProcess,
        'id' | 'custom_weekdays' | 'min_staff' | 'shift_start' | 'shift_end'
      >
      coverage_overrides: TableDef<CoverageOverride, 'id' | 'weekday' | 'date'>
      assignments: TableDef<Assignment, 'id'>
      public_holidays: TableDef<PublicHoliday, 'id'>
      leaves: TableDef<Leave, 'id' | 'status'>
      comp_off_ledger: TableDef<CompOffLedgerEntry, 'id' | 'used_on'>
      rosters: TableDef<Roster, 'id' | 'version' | 'status' | 'created_at' | 'notes'>
      roster_days: TableDef<RosterDay, 'id' | 'source' | 'locked'>
      roster_coverage: TableDef<RosterCoverage, 'id' | 'is_backup'>
      roster_issues: TableDef<
        RosterIssue,
        'id' | 'date' | 'brand_process_id' | 'employee_id' | 'suggestion'
      >
      change_log: TableDef<ChangeLogEntry, 'id' | 'roster_id' | 'at' | 'actor' | 'payload'>
    }
    Views: { [_ in never]: never }
    Functions: {
      /** Wipes all tables and loads the demo seed atomically (demo only; see migration). */
      reset_demo_data: {
        Args: { payload: Json }
        Returns: Json // { <table>: row count, … }
      }
    }
    Enums: {
      employee_role: EmployeeRole
      calendar_rule: CalendarRule
      assignment_kind: AssignmentKind
      leave_type: LeaveType
      leave_status: LeaveStatus
      roster_status: RosterStatus
      roster_day_status: RosterDayStatus
      roster_day_source: RosterDaySource
      issue_severity: IssueSeverity
    }
    CompositeTypes: { [_ in never]: never }
  }
}
