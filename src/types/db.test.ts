import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DB_ENUMS, HARD_ISSUE_CODES, SOFT_ISSUE_CODES, TABLE_NAMES } from './db'

// Guards against drift between the SQL migrations and the hand-written TS types.
const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const sql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(migrationsDir, f), 'utf8'))
  .join('\n')

function sqlEnums(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const m of sql.matchAll(/create type (\w+)\s+as enum \(([^)]*)\)/gi)) {
    out[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((v) => v[1])
  }
  return out
}

function sqlTables(): string[] {
  return [...sql.matchAll(/create table (\w+)\s*\(/gi)].map((m) => m[1])
}

describe('db types match the migration', () => {
  it('declares every Postgres enum with identical values and order', () => {
    const fromSql = sqlEnums()
    expect(Object.keys(fromSql).sort()).toEqual(Object.keys(DB_ENUMS).sort())
    for (const [name, values] of Object.entries(DB_ENUMS)) {
      expect(fromSql[name], `enum ${name}`).toEqual([...values])
    }
  })

  it('declares exactly the 15 tables from spec §2', () => {
    expect(sqlTables().sort()).toEqual([...TABLE_NAMES].sort())
    expect(TABLE_NAMES).toHaveLength(15)
  })

  it('enables RLS for every table', () => {
    for (const t of TABLE_NAMES) expect(sql).toContain(`'${t}'`)
    expect(sql).toMatch(/enable row level security/)
  })
})

describe('issue codes (spec §3.5)', () => {
  it('keeps HARD and SOFT codes disjoint', () => {
    const hard = new Set<string>(HARD_ISSUE_CODES)
    expect(SOFT_ISSUE_CODES.filter((c) => hard.has(c))).toEqual([])
    expect(HARD_ISSUE_CODES).toHaveLength(6)
    expect(SOFT_ISSUE_CODES).toHaveLength(4)
  })
})
