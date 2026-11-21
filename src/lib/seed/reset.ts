import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '../../types/db.ts'
import { buildSeedData } from './data.ts'

export type ResetCounts = Record<string, number>

/**
 * "Reset demo data": replaces ALL data (including generated rosters) with the demo seed.
 * Runs as one transaction inside the reset_demo_data() Postgres function, so a failure
 * leaves the old data untouched. Shared by `npm run seed` and the app.
 */
export async function resetDemoData(client: SupabaseClient<Database>): Promise<ResetCounts> {
  // SeedData is plain JSON-serialisable rows; interfaces just lack Json's index signature.
  const payload = buildSeedData() as unknown as Json
  const { data, error } = await client.rpc('reset_demo_data', { payload })
  if (error) throw new Error(`Reset demo data failed: ${error.message}`)
  return data as ResetCounts
}
