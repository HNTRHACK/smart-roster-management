import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/db'

export type RosterSupabaseClient = SupabaseClient<Database>

let client: RosterSupabaseClient | null = null

/** True when both env vars are present, so the UI can show a setup hint instead of crashing. */
export function isSupabaseConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
}

/**
 * Lazily creates the typed Supabase client. Created on first use (not at import time)
 * so `npm run build` and `npm test` work without a .env file.
 */
export function getSupabase(): RosterSupabaseClient {
  if (client) return client
  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env (see .env.example).',
    )
  }
  client = createClient<Database>(url, anonKey)
  return client
}
