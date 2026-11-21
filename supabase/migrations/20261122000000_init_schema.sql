-- Smart Roster Management System — initial schema (spec §2).
--
-- Core idea: a brand-process's OPERATING CALENDAR (brand_processes + coverage_overrides +
-- public_holidays) is kept separate from an employee's WORKING SCHEDULE (roster_days).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type employee_role     as enum ('agent', 'pod_lead', 'floater');
create type calendar_rule     as enum ('ALL_DAYS', 'NO_PUBLIC_HOLIDAYS', 'NO_SUN_NO_PH', 'CUSTOM');
create type assignment_kind   as enum ('primary', 'backup');
create type leave_type        as enum ('PLANNED', 'SICK', 'COMP_OFF');
create type leave_status      as enum ('PENDING', 'APPROVED', 'REJECTED');
create type roster_status     as enum ('DRAFT', 'PUBLISHED');
create type roster_day_status as enum ('WORK', 'WEEK_OFF', 'LEAVE', 'COMP_OFF', 'HOLIDAY', 'NOT_SCHEDULED');
create type roster_day_source as enum ('AUTO', 'MANUAL');
create type issue_severity    as enum ('HARD', 'SOFT');

-- ---------------------------------------------------------------------------
-- Organisation
-- ---------------------------------------------------------------------------
-- pods <-> employees is circular (pod has a lead; employee belongs to a pod),
-- so pods.lead_employee_id is added after employees exists.
create table pods (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table employees (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null,
  email                     text unique,
  pod_id                    uuid references pods (id) on delete set null,
  role                      employee_role not null default 'agent',
  weekly_offs_per_week      int  not null default 1 check (weekly_offs_per_week between 0 and 7),
  max_consecutive_work_days int  not null default 6 check (max_consecutive_work_days >= 1),
  preferred_off_weekday     int  check (preferred_off_weekday between 0 and 6), -- 0=Sun..6=Sat
  active                    boolean not null default true
);
create index employees_pod_id_idx on employees (pod_id);

alter table pods
  add column lead_employee_id uuid references employees (id) on delete set null;

-- Processes are rows, not an enum, so new ones (beyond CS/ACC/NDR/RET) need no migration.
create table processes (
  id   uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null
);

create table brands (
  id     uuid primary key default gen_random_uuid(),
  name   text not null unique,
  pod_id uuid not null references pods (id) on delete restrict,
  active boolean not null default true
);
create index brands_pod_id_idx on brands (pod_id);

-- ---------------------------------------------------------------------------
-- Demand: the unit of demand is a brand × process with its operating calendar
-- ---------------------------------------------------------------------------
create table brand_processes (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references brands (id) on delete cascade,
  process_id      uuid not null references processes (id) on delete restrict,
  calendar_rule   calendar_rule not null,
  custom_weekdays int[],                                   -- only for CUSTOM (0=Sun..6=Sat)
  min_staff       int  not null default 1 check (min_staff >= 0),
  shift_start     time not null default '09:00',
  shift_end       time not null default '18:00',
  unique (brand_id, process_id),
  -- custom_weekdays is set exactly when the rule is CUSTOM, non-empty, values 0..6
  constraint custom_weekdays_matches_rule check (
    (calendar_rule = 'CUSTOM') = (custom_weekdays is not null)
  ),
  constraint custom_weekdays_valid check (
    custom_weekdays is null
    or (cardinality(custom_weekdays) > 0 and custom_weekdays <@ array[0, 1, 2, 3, 4, 5, 6])
  ),
  -- shift_end < shift_start means an overnight shift; equal times are meaningless
  constraint shift_not_zero_length check (shift_end <> shift_start)
);
create index brand_processes_process_id_idx on brand_processes (process_id);

-- Per-day staffing overrides. Precedence (applied in the scheduler): date > weekday > default.
create table coverage_overrides (
  id               uuid primary key default gen_random_uuid(),
  brand_process_id uuid not null references brand_processes (id) on delete cascade,
  weekday          int  check (weekday between 0 and 6),
  date             date,
  min_staff        int  not null check (min_staff >= 0),
  constraint override_targets_weekday_xor_date check (num_nonnulls(weekday, date) = 1)
);
create unique index coverage_overrides_weekday_uq
  on coverage_overrides (brand_process_id, weekday) where weekday is not null;
create unique index coverage_overrides_date_uq
  on coverage_overrides (brand_process_id, date) where date is not null;

-- primary = normally works it; backup = cross-trained, can cover gaps
create table assignments (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references employees (id) on delete cascade,
  brand_process_id uuid not null references brand_processes (id) on delete cascade,
  kind             assignment_kind not null,
  unique (employee_id, brand_process_id)
);
create index assignments_brand_process_id_idx on assignments (brand_process_id);

create table public_holidays (
  id   uuid primary key default gen_random_uuid(),
  date date not null unique,
  name text not null
);

-- ---------------------------------------------------------------------------
-- Availability
-- ---------------------------------------------------------------------------
create table leaves (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees (id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  type        leave_type   not null,
  status      leave_status not null default 'PENDING',
  constraint leave_dates_ordered check (end_date >= start_date)
);
create index leaves_employee_dates_idx on leaves (employee_id, start_date, end_date);

create table comp_off_ledger (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees (id) on delete cascade,
  earned_on   date not null,
  reason      text not null,
  used_on     date,
  constraint comp_off_used_after_earned check (used_on is null or used_on >= earned_on)
);
create index comp_off_ledger_employee_id_idx on comp_off_ledger (employee_id);

-- ---------------------------------------------------------------------------
-- Rosters (versioned per month)
-- ---------------------------------------------------------------------------
create table rosters (
  id         uuid primary key default gen_random_uuid(),
  month      date not null,
  version    int  not null default 1 check (version >= 1),
  status     roster_status not null default 'DRAFT',
  created_at timestamptz   not null default now(),
  notes      text,
  unique (month, version),
  constraint month_is_first_day check (month = date_trunc('month', month)::date)
);

-- One row per employee per day of the roster month: the employee's working schedule.
create table roster_days (
  id          uuid primary key default gen_random_uuid(),
  roster_id   uuid not null references rosters (id) on delete cascade,
  employee_id uuid not null references employees (id) on delete cascade,
  date        date not null,
  status      roster_day_status not null,
  source      roster_day_source not null default 'AUTO',
  locked      boolean not null default false,
  unique (roster_id, employee_id, date)
);
create index roster_days_roster_date_idx on roster_days (roster_id, date);

-- Who covers which brand-process on a WORK day (including backup cover).
create table roster_coverage (
  id               uuid primary key default gen_random_uuid(),
  roster_id        uuid not null references rosters (id) on delete cascade,
  date             date not null,
  employee_id      uuid not null references employees (id) on delete cascade,
  brand_process_id uuid not null references brand_processes (id) on delete cascade,
  is_backup        boolean not null default false, -- §3.4 "mark as backup cover"
  unique (roster_id, date, employee_id, brand_process_id)
);
create index roster_coverage_roster_date_idx on roster_coverage (roster_id, date);
create index roster_coverage_brand_process_id_idx on roster_coverage (brand_process_id);

-- Codes are text (not an enum) so new validator rules need no migration.
-- date is null for month-wide issues (e.g. UNFAIR_WEEKEND_OFFS).
create table roster_issues (
  id               uuid primary key default gen_random_uuid(),
  roster_id        uuid not null references rosters (id) on delete cascade,
  date             date,
  severity         issue_severity not null,
  code             text not null,
  brand_process_id uuid references brand_processes (id) on delete set null,
  employee_id      uuid references employees (id) on delete set null,
  message          text  not null,
  suggestion       jsonb not null default '[]'::jsonb
);
create index roster_issues_roster_severity_idx on roster_issues (roster_id, severity);

-- roster_id is nullable so setup changes (not tied to a roster) can be logged too.
create table change_log (
  id        uuid primary key default gen_random_uuid(),
  roster_id uuid references rosters (id) on delete cascade,
  at        timestamptz not null default now(),
  actor     text  not null default 'demo-user',
  action    text  not null,
  payload   jsonb not null default '{}'::jsonb
);
create index change_log_roster_at_idx on change_log (roster_id, at);

-- ---------------------------------------------------------------------------
-- Row Level Security — DEMO ONLY: no login, open access for anon + authenticated.
-- Documented in docs/ASSUMPTIONS.md; replace with role-based policies for production.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'pods', 'employees', 'processes', 'brands', 'brand_processes', 'coverage_overrides',
    'assignments', 'public_holidays', 'leaves', 'comp_off_ledger', 'rosters',
    'roster_days', 'roster_coverage', 'roster_issues', 'change_log'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy demo_open_access on public.%I for all to anon, authenticated using (true) with check (true)',
      t
    );
  end loop;
end
$$;
