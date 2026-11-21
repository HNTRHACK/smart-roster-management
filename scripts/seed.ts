/**
 * npm run seed                 → print summary, then replace ALL data in Supabase with the demo seed
 * npm run seed -- --dry-run    → print summary only (no database)
 * npm run seed -- --sql        → print summary and regenerate supabase/seed.sql
 *
 * Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from the environment (.env is loaded by
 * the npm script via `node --env-file-if-exists=.env`). Runs on Node's built-in TS support.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/db.ts'
import {
  buildSeedData,
  formatSummary,
  renderSeedSql,
  resetDemoData,
  summarizeSeed,
} from '../src/lib/seed/index.ts'

const KNOWN_FLAGS = new Set(['--dry-run', '--sql'])

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const unknown = args.filter((a) => !KNOWN_FLAGS.has(a))
  if (unknown.length) {
    console.error(`Unknown option(s): ${unknown.join(' ')}. Use --dry-run or --sql.`)
    process.exit(2)
  }

  const data = buildSeedData()
  console.log(formatSummary(summarizeSeed(data)))
  console.log()

  if (args.includes('--sql')) {
    const target = fileURLToPath(new URL('../supabase/seed.sql', import.meta.url))
    writeFileSync(target, renderSeedSql(data))
    console.log(`Wrote ${target}`)
    return
  }
  if (args.includes('--dry-run')) {
    console.log('Dry run: database not touched.')
    return
  }

  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) {
    console.error(
      'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill them in ' +
        '(local: `npx supabase status`), or run with --dry-run.',
    )
    process.exit(1)
  }

  const client = createClient<Database>(url, key, { auth: { persistSession: false } })
  const counts = await resetDemoData(client)
  console.log(`Seeded ${url}:`)
  for (const [table, n] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${table.padEnd(20)} ${n}`)
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
