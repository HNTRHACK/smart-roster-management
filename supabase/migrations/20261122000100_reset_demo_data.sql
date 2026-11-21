-- "Reset demo data" (spec §2): replace ALL data with the seed built in src/lib/seed/data.ts.
--
-- payload = { "<table>": [ full row objects ], ... } for the 10 setup tables.
-- Runs as a single transaction: if any insert fails, nothing is truncated.
-- Roster tables (rosters, roster_days, roster_coverage, roster_issues, change_log) are emptied.
--
-- DEMO ONLY: executable by anon. This adds no new exposure, because the open demo RLS
-- policies already let anon delete every row. Remove the grant for production.

create or replace function public.reset_demo_data(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- FK-safe insert order (pods are handled separately because of the circular lead FK).
  seed_tables constant text[] := array[
    'processes', 'employees', 'brands', 'brand_processes', 'coverage_overrides',
    'assignments', 'public_holidays', 'leaves', 'comp_off_ledger'
  ];
  all_tables constant text[] := array[
    'pods', 'employees', 'processes', 'brands', 'brand_processes', 'coverage_overrides',
    'assignments', 'public_holidays', 'leaves', 'comp_off_ledger', 'rosters',
    'roster_days', 'roster_coverage', 'roster_issues', 'change_log'
  ];
  t text;
  n bigint;
  counts jsonb := '{}'::jsonb;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'reset_demo_data: payload must be a JSON object';
  end if;
  foreach t in array array['pods'] || seed_tables loop
    if jsonb_typeof(payload -> t) is distinct from 'array' then
      raise exception 'reset_demo_data: payload.% must be an array', t;
    end if;
  end loop;

  truncate table
    change_log, roster_issues, roster_coverage, roster_days, rosters,
    comp_off_ledger, leaves, public_holidays, assignments, coverage_overrides,
    brand_processes, brands, employees, processes, pods
    cascade;

  -- pods without leads first; leads are set once employees exist
  insert into pods (id, name)
  select id, name from jsonb_populate_recordset(null::pods, payload -> 'pods');

  foreach t in array seed_tables loop
    execute format(
      'insert into %1$I select * from jsonb_populate_recordset(null::%1$I, $1 -> %2$L)',
      t, t
    ) using payload;
  end loop;

  update pods p
     set lead_employee_id = s.lead_employee_id
    from jsonb_populate_recordset(null::pods, payload -> 'pods') s
   where p.id = s.id;

  foreach t in array all_tables loop
    execute format('select count(*) from %I', t) into n;
    counts := counts || jsonb_build_object(t, n);
  end loop;
  return counts;
end;
$$;

revoke all on function public.reset_demo_data(jsonb) from public;
grant execute on function public.reset_demo_data(jsonb) to anon, authenticated, service_role;
