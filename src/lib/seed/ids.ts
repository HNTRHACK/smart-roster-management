/**
 * Deterministic UUIDs for seed rows, e.g. seedId('employee', 7) →
 * "30000000-0000-4000-8000-000000000007". The first block identifies the table, the last
 * block is the row number. Stable ids keep scheduler tie-breaks (spec §3.3) deterministic
 * and keep links/bookmarks valid across "Reset demo data".
 */
const TABLE_PREFIX = {
  pod: '10000000',
  process: '20000000',
  employee: '30000000',
  brand: '40000000',
  brandProcess: '50000000',
  coverageOverride: '60000000',
  assignment: '70000000',
  holiday: '80000000',
  leave: '90000000',
  compOff: 'a0000000',
} as const

export type SeedTable = keyof typeof TABLE_PREFIX

export function seedId(table: SeedTable, n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 999_999) {
    throw new RangeError(`seedId: row number must be 1..999999, got ${n}`)
  }
  return `${TABLE_PREFIX[table]}-0000-4000-8000-${String(n).padStart(12, '0')}`
}
