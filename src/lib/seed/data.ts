/**
 * Demo dataset (spec §4) for December 2026. Pure and deterministic: no I/O, stable ids.
 *
 * Shape: 4 pods × (4 single-resource brands + 1 multi-resource brand) = 20 brands, 30 employees.
 * Headcount is 30, not the 33 in §4, because §4's team sizes plus 2 multi-brand employees cap
 * it at 30 (see docs/ASSUMPTIONS.md, Phase 2).
 *
 * NOTE: relative imports with .ts extensions so `node scripts/seed.ts` runs this file directly.
 */
import type {
  Assignment,
  AssignmentKind,
  Brand,
  BrandProcess,
  CalendarRule,
  CompOffLedgerEntry,
  CoverageOverride,
  Employee,
  EmployeeRole,
  Leave,
  LeaveStatus,
  LeaveType,
  Pod,
  Process,
  PublicHoliday,
  Weekday,
} from '../../types/db.ts'
import { seedId } from './ids.ts'

/** Full rows keyed by table name — the payload for the reset_demo_data() RPC. */
export interface SeedData {
  pods: Pod[]
  processes: Process[]
  employees: Employee[]
  brands: Brand[]
  brand_processes: BrandProcess[]
  coverage_overrides: CoverageOverride[]
  assignments: Assignment[]
  public_holidays: PublicHoliday[]
  leaves: Leave[]
  comp_off_ledger: CompOffLedgerEntry[]
}

export const DEMO_MONTH = '2026-12-01'
export const EMAIL_DOMAIN = 'roster-demo.test'

// ---------------------------------------------------------------------------
// Declarative spec — edit here, ids and rows are derived below
// ---------------------------------------------------------------------------
type PodKey = 'nova' | 'orbit' | 'pulse' | 'quartz'
type ProcessCode = 'CS' | 'ACC' | 'NDR' | 'RET'

const PODS: { key: PodKey; name: string }[] = [
  { key: 'nova', name: 'Pod Nova' },
  { key: 'orbit', name: 'Pod Orbit' },
  { key: 'pulse', name: 'Pod Pulse' },
  { key: 'quartz', name: 'Pod Quartz' },
]

const PROCESSES: { code: ProcessCode; name: string }[] = [
  { code: 'CS', name: 'Customer Support' },
  { code: 'ACC', name: 'Accounts' },
  { code: 'NDR', name: 'Non-Delivery Resolution' },
  { code: 'RET', name: 'Retention' },
]

interface EmployeeSpec {
  key: string
  name: string
  pod: PodKey
  role: EmployeeRole
  pref?: Weekday
}

// Order defines employee ids: pod leads 1–4, floaters 5–6, sole agents 7–22, team members 23–30.
const EMPLOYEES: EmployeeSpec[] = [
  { key: 'lead_nova', name: 'Meera Kulkarni', pod: 'nova', role: 'pod_lead' },
  { key: 'lead_orbit', name: 'Arjun Bhatt', pod: 'orbit', role: 'pod_lead' },
  { key: 'lead_pulse', name: 'Sana Qureshi', pod: 'pulse', role: 'pod_lead' },
  { key: 'lead_quartz', name: 'Vikram Rao', pod: 'quartz', role: 'pod_lead' },
  { key: 'float_ishaan', name: 'Ishaan Mehta', pod: 'orbit', role: 'floater' },
  { key: 'float_tara', name: 'Tara Dsouza', pod: 'pulse', role: 'floater' },
  // Sole agents of single-resource brands
  { key: 's01', name: 'Riya Kapoor', pod: 'nova', role: 'agent', pref: 0 }, // Sunday on ALL_DAYS brand
  { key: 's02', name: 'Kabir Joshi', pod: 'nova', role: 'agent', pref: 6 },
  { key: 's03', name: 'Ananya Iyer', pod: 'nova', role: 'agent', pref: 0 },
  { key: 's04', name: 'Dev Malhotra', pod: 'nova', role: 'agent', pref: 3 },
  { key: 's05', name: 'Priya Nair', pod: 'orbit', role: 'agent', pref: 0 }, // Sunday on ALL_DAYS brand
  { key: 's06', name: 'Rohan Gupta', pod: 'orbit', role: 'agent', pref: 1 },
  { key: 's07', name: 'Neha Verma', pod: 'orbit', role: 'agent' }, // multi-brand (+ Bloom ACC)
  { key: 's08', name: 'Aditya Menon', pod: 'orbit', role: 'agent', pref: 0 },
  { key: 's09', name: 'Kavya Reddy', pod: 'pulse', role: 'agent', pref: 2 },
  { key: 's10', name: 'Farhan Sheikh', pod: 'pulse', role: 'agent', pref: 5 },
  { key: 's11', name: 'Ishita Banerjee', pod: 'pulse', role: 'agent' }, // multi-brand (+ Cobalt RET)
  { key: 's12', name: 'Nikhil Pillai', pod: 'pulse', role: 'agent' },
  { key: 's13', name: 'Zoya Khan', pod: 'quartz', role: 'agent', pref: 0 }, // deliberate unfixable gap
  { key: 's14', name: 'Aman Saxena', pod: 'quartz', role: 'agent' },
  { key: 's15', name: 'Pooja Desai', pod: 'quartz', role: 'agent' },
  { key: 's16', name: 'Siddharth Jain', pod: 'quartz', role: 'agent' },
  // Members of multi-resource brands
  { key: 'a1', name: 'Rahul Sinha', pod: 'nova', role: 'agent', pref: 0 }, // Sunday on ALL_DAYS CS
  { key: 'a2', name: 'Divya Chawla', pod: 'nova', role: 'agent' },
  { key: 'a3', name: 'Manish Yadav', pod: 'nova', role: 'agent' },
  { key: 'b1', name: 'Sneha Patil', pod: 'orbit', role: 'agent', pref: 1 },
  { key: 'b2', name: 'Karan Thakur', pod: 'orbit', role: 'agent', pref: 3 },
  { key: 'c1', name: 'Aisha Siddiqui', pod: 'pulse', role: 'agent', pref: 6 },
  { key: 'd1', name: 'Varun Mishra', pod: 'quartz', role: 'agent', pref: 6 },
  { key: 'd2', name: 'Lakshmi Krishnan', pod: 'quartz', role: 'agent' },
]

interface ProcessSpec {
  code: ProcessCode
  rule: CalendarRule
  shift?: [start: string, end: string] // default 09:00–18:00
  primary: string[]
  backup?: string[]
}

interface BrandSpec {
  key: string
  name: string
  pod: PodKey
  processes: ProcessSpec[]
}

const FULL_DAY: [string, string] = ['09:00:00', '18:00:00']
const MORNING: [string, string] = ['09:00:00', '13:00:00']
const AFTERNOON: [string, string] = ['14:00:00', '18:00:00']
const LATE: [string, string] = ['10:00:00', '19:00:00']

// Main calendar rule per brand (its CS rule, else its first process):
// ALL_DAYS 8 · NO_PUBLIC_HOLIDAYS 7 · NO_SUN_NO_PH 5  (40 / 35 / 25 %)
const BRANDS: BrandSpec[] = [
  // ---- Pod Nova ----
  {
    key: 'mellowbean', name: 'Mellowbean Coffee', pod: 'nova',
    processes: [{ code: 'CS', rule: 'ALL_DAYS', primary: ['s01'], backup: ['lead_nova', 'float_ishaan'] }],
  },
  {
    key: 'tidepool', name: 'Tidepool Skincare', pod: 'nova',
    processes: [
      { code: 'CS', rule: 'NO_PUBLIC_HOLIDAYS', primary: ['s02'], backup: ['lead_nova'] },
      { code: 'NDR', rule: 'NO_PUBLIC_HOLIDAYS', primary: ['s02'], backup: ['float_tara'] },
    ],
  },
  {
    key: 'paperkite', name: 'Paperkite Stationery', pod: 'nova',
    processes: [{ code: 'CS', rule: 'NO_SUN_NO_PH', primary: ['s03'] }],
  },
  {
    // CS every day, ACC only Mon–Sat: a brand with mixed calendars.
    key: 'ironfern', name: 'Ironfern Fitness', pod: 'nova',
    processes: [
      { code: 'CS', rule: 'ALL_DAYS', primary: ['s04'], backup: ['lead_nova'] },
      { code: 'ACC', rule: 'NO_SUN_NO_PH', primary: ['s04'], backup: ['lead_nova'] },
    ],
  },
  {
    // Brand A — 3 people on separate processes; CS every day, ACC Mon–Sat.
    key: 'aurora', name: 'Aurora Athleisure', pod: 'nova',
    processes: [
      { code: 'CS', rule: 'ALL_DAYS', primary: ['a1'], backup: ['lead_nova'] },
      { code: 'ACC', rule: 'NO_SUN_NO_PH', shift: LATE, primary: ['a2'], backup: ['float_tara'] },
      { code: 'NDR', rule: 'NO_PUBLIC_HOLIDAYS', shift: LATE, primary: ['a3'] },
    ],
  },
  // ---- Pod Orbit ----
  {
    key: 'lumen', name: 'Lumen Lamps', pod: 'orbit',
    processes: [{ code: 'CS', rule: 'ALL_DAYS', primary: ['s05'], backup: ['lead_orbit', 'float_ishaan'] }],
  },
  {
    key: 'brightbark', name: 'Brightbark Pet Co', pod: 'orbit',
    processes: [
      { code: 'CS', rule: 'NO_PUBLIC_HOLIDAYS', primary: ['s06'], backup: ['lead_orbit'] },
      { code: 'RET', rule: 'NO_PUBLIC_HOLIDAYS', primary: ['s06'], backup: ['float_ishaan'] },
    ],
  },
  {
    // Neha works mornings here and afternoons on Bloom ACC.
    key: 'nimbus', name: 'Nimbus Knitwear', pod: 'orbit',
    processes: [{ code: 'CS', rule: 'NO_PUBLIC_HOLIDAYS', shift: MORNING, primary: ['s07'] }],
  },
  {
    key: 'sundial', name: 'Sundial Teas', pod: 'orbit',
    processes: [
      { code: 'CS', rule: 'NO_SUN_NO_PH', primary: ['s08'], backup: ['lead_orbit'] },
      { code: 'ACC', rule: 'NO_SUN_NO_PH', primary: ['s08'] },
    ],
  },
  {
    // Brand B — 2 share CS (2 needed on Mondays + sale day), ACC by a multi-brand employee.
    key: 'bloom', name: 'Bloom Botanics', pod: 'orbit',
    processes: [
      { code: 'CS', rule: 'ALL_DAYS', primary: ['b1', 'b2'], backup: ['lead_orbit'] },
      { code: 'ACC', rule: 'NO_SUN_NO_PH', shift: AFTERNOON, primary: ['s07'], backup: ['float_ishaan'] },
    ],
  },
  // ---- Pod Pulse ----
  {
    key: 'copperleaf', name: 'Copperleaf Kitchen', pod: 'pulse',
    processes: [{ code: 'CS', rule: 'ALL_DAYS', primary: ['s09'], backup: ['lead_pulse', 'float_ishaan'] }],
  },
  {
    key: 'driftwood', name: 'Driftwood Home', pod: 'pulse',
    processes: [
      { code: 'CS', rule: 'NO_PUBLIC_HOLIDAYS', primary: ['s10'], backup: ['lead_pulse'] },
      { code: 'NDR', rule: 'NO_PUBLIC_HOLIDAYS', primary: ['s10'], backup: ['float_tara'] },
    ],
  },
  {
    // Ishita works mornings here and afternoons on Cobalt RET.
    key: 'velvetmoth', name: 'Velvet Moth Candles', pod: 'pulse',
    processes: [{ code: 'CS', rule: 'NO_PUBLIC_HOLIDAYS', shift: MORNING, primary: ['s11'] }],
  },
  {
    key: 'pebblepine', name: 'Pebble & Pine Toys', pod: 'pulse',
    processes: [{ code: 'CS', rule: 'NO_SUN_NO_PH', primary: ['s12'], backup: ['lead_pulse'] }],
  },
  {
    // Brand C — CS / RET, RET by a multi-brand employee.
    key: 'cobalt', name: 'Cobalt Cookware', pod: 'pulse',
    processes: [
      { code: 'CS', rule: 'NO_PUBLIC_HOLIDAYS', primary: ['c1'], backup: ['lead_pulse'] },
      { code: 'RET', rule: 'NO_PUBLIC_HOLIDAYS', shift: AFTERNOON, primary: ['s11'], backup: ['float_tara'] },
    ],
  },
  // ---- Pod Quartz ----
  {
    // DELIBERATE UNFIXABLE GAP: 7-day RET brand, nobody else in Pod Quartz does RET, no backups.
    key: 'saltmarsh', name: 'Saltmarsh Swimwear', pod: 'quartz',
    processes: [{ code: 'RET', rule: 'ALL_DAYS', primary: ['s13'] }],
  },
  {
    key: 'honeycomb', name: 'Honeycomb Haircare', pod: 'quartz',
    processes: [
      { code: 'CS', rule: 'ALL_DAYS', primary: ['s14'], backup: ['lead_quartz'] },
      { code: 'NDR', rule: 'ALL_DAYS', primary: ['s14'], backup: ['lead_quartz', 'float_tara'] },
    ],
  },
  {
    key: 'emberspice', name: 'Ember Spice Co', pod: 'quartz',
    processes: [{ code: 'CS', rule: 'NO_PUBLIC_HOLIDAYS', primary: ['s15'], backup: ['lead_quartz'] }],
  },
  {
    key: 'fieldnote', name: 'Fieldnote Journals', pod: 'quartz',
    processes: [
      { code: 'CS', rule: 'NO_SUN_NO_PH', primary: ['s16'] },
      { code: 'ACC', rule: 'NO_SUN_NO_PH', primary: ['s16'] },
    ],
  },
  {
    // Brand D — both people primary on CS and NDR (overlapping).
    key: 'dune', name: 'Dune Denim', pod: 'quartz',
    processes: [
      { code: 'CS', rule: 'NO_SUN_NO_PH', primary: ['d1', 'd2'], backup: ['lead_quartz'] },
      { code: 'NDR', rule: 'NO_SUN_NO_PH', primary: ['d1', 'd2'] },
    ],
  },
]

/** Brand B CS needs 2 people on Mondays and on the 26 Dec sale day (spec §4). */
const OVERRIDES: { brand: string; code: ProcessCode; weekday?: Weekday; date?: string; min_staff: number }[] = [
  { brand: 'bloom', code: 'CS', weekday: 1, min_staff: 2 },
  { brand: 'bloom', code: 'CS', date: '2026-12-26', min_staff: 2 },
]

const HOLIDAYS: { date: string; name: string }[] = [
  { date: '2026-12-25', name: 'Christmas' },
  { date: '2027-01-01', name: 'New Year' },
  { date: '2027-01-26', name: 'Republic Day' },
]

const LEAVES: { emp: string; start: string; end: string; type: LeaveType; status: LeaveStatus }[] = [
  { emp: 's15', start: '2026-12-02', end: '2026-12-04', type: 'PLANNED', status: 'APPROVED' },
  // Multi-brand employee away → gaps on two brands (CROSS_BRAND_IMPACT)
  { emp: 's07', start: '2026-12-08', end: '2026-12-09', type: 'PLANNED', status: 'APPROVED' },
  // Sole resource on a 7-day brand that has backups → backup cover
  { emp: 's09', start: '2026-12-14', end: '2026-12-16', type: 'PLANNED', status: 'APPROVED' },
  { emp: 'd1', start: '2026-12-17', end: '2026-12-18', type: 'PLANNED', status: 'APPROVED' },
  // Covers Monday 21 Dec, when Bloom CS needs 2 people
  { emp: 'b1', start: '2026-12-21', end: '2026-12-23', type: 'PLANNED', status: 'APPROVED' },
  { emp: 'a3', start: '2026-12-28', end: '2026-12-31', type: 'PLANNED', status: 'APPROVED' },
  { emp: 's14', start: '2026-12-29', end: '2026-12-30', type: 'PLANNED', status: 'PENDING' },
  { emp: 's04', start: '2026-12-11', end: '2026-12-11', type: 'COMP_OFF', status: 'APPROVED' },
  { emp: 'c1', start: '2026-12-18', end: '2026-12-18', type: 'COMP_OFF', status: 'APPROVED' },
]

/** Comp-offs earned in November and spent by the COMP_OFF leaves above. */
const COMP_OFFS: { emp: string; earned_on: string; reason: string; used_on: string }[] = [
  { emp: 's04', earned_on: '2026-11-15', reason: 'Worked weekly off during the November sale', used_on: '2026-12-11' },
  { emp: 'c1', earned_on: '2026-11-22', reason: 'Covered Cobalt CS on a weekly off', used_on: '2026-12-18' },
]

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------
function emailFor(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@${EMAIL_DOMAIN}`
}

function lookup<T>(map: Map<string, T>, key: string, what: string): T {
  const v = map.get(key)
  if (v === undefined) throw new Error(`seed: unknown ${what} "${key}"`)
  return v
}

export function buildSeedData(): SeedData {
  const podIds = new Map(PODS.map((p, i) => [p.key, seedId('pod', i + 1)]))
  const processIds = new Map(PROCESSES.map((p, i) => [p.code, seedId('process', i + 1)]))
  const empIds = new Map(EMPLOYEES.map((e, i) => [e.key, seedId('employee', i + 1)]))

  const employees: Employee[] = EMPLOYEES.map((e) => ({
    id: lookup(empIds, e.key, 'employee'),
    name: e.name,
    email: emailFor(e.name),
    pod_id: lookup(podIds, e.pod, 'pod'),
    role: e.role,
    weekly_offs_per_week: 1,
    max_consecutive_work_days: 6,
    preferred_off_weekday: e.pref ?? null,
    active: true,
  }))

  const pods: Pod[] = PODS.map((p) => {
    const lead = EMPLOYEES.find((e) => e.role === 'pod_lead' && e.pod === p.key)
    return {
      id: lookup(podIds, p.key, 'pod'),
      name: p.name,
      lead_employee_id: lead ? lookup(empIds, lead.key, 'employee') : null,
    }
  })

  const processes: Process[] = PROCESSES.map((p) => ({
    id: lookup(processIds, p.code, 'process'),
    code: p.code,
    name: p.name,
  }))

  const brands: Brand[] = []
  const brand_processes: BrandProcess[] = []
  const assignments: Assignment[] = []
  const bpIds = new Map<string, string>() // "brandKey:CODE" → id

  BRANDS.forEach((b, bi) => {
    const brandId = seedId('brand', bi + 1)
    brands.push({ id: brandId, name: b.name, pod_id: lookup(podIds, b.pod, 'pod'), active: true })

    for (const p of b.processes) {
      const bpId = seedId('brandProcess', brand_processes.length + 1)
      bpIds.set(`${b.key}:${p.code}`, bpId)
      const [shift_start, shift_end] = p.shift ?? FULL_DAY
      brand_processes.push({
        id: bpId,
        brand_id: brandId,
        process_id: lookup(processIds, p.code, 'process'),
        calendar_rule: p.rule,
        custom_weekdays: null,
        min_staff: 1,
        shift_start,
        shift_end,
      })
      const add = (keys: string[] | undefined, kind: AssignmentKind) => {
        for (const k of keys ?? []) {
          assignments.push({
            id: seedId('assignment', assignments.length + 1),
            employee_id: lookup(empIds, k, 'employee'),
            brand_process_id: bpId,
            kind,
          })
        }
      }
      add(p.primary, 'primary')
      add(p.backup, 'backup')
    }
  })

  const coverage_overrides: CoverageOverride[] = OVERRIDES.map((o, i) => ({
    id: seedId('coverageOverride', i + 1),
    brand_process_id: lookup(bpIds, `${o.brand}:${o.code}`, 'brand-process'),
    weekday: o.weekday ?? null,
    date: o.date ?? null,
    min_staff: o.min_staff,
  }))

  const public_holidays: PublicHoliday[] = HOLIDAYS.map((h, i) => ({
    id: seedId('holiday', i + 1),
    date: h.date,
    name: h.name,
  }))

  const leaves: Leave[] = LEAVES.map((l, i) => ({
    id: seedId('leave', i + 1),
    employee_id: lookup(empIds, l.emp, 'employee'),
    start_date: l.start,
    end_date: l.end,
    type: l.type,
    status: l.status,
  }))

  const comp_off_ledger: CompOffLedgerEntry[] = COMP_OFFS.map((c, i) => ({
    id: seedId('compOff', i + 1),
    employee_id: lookup(empIds, c.emp, 'employee'),
    earned_on: c.earned_on,
    reason: c.reason,
    used_on: c.used_on,
  }))

  return {
    pods,
    processes,
    employees,
    brands,
    brand_processes,
    coverage_overrides,
    assignments,
    public_holidays,
    leaves,
    comp_off_ledger,
  }
}

/** Seed brand key → name, for tests and docs that need to find specific demo brands. */
export const DEMO_BRANDS = {
  A: 'Aurora Athleisure',
  B: 'Bloom Botanics',
  C: 'Cobalt Cookware',
  D: 'Dune Denim',
  unfixableGap: 'Saltmarsh Swimwear',
} as const
