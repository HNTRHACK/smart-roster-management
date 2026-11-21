import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { ResetCounts } from '@/lib/seed'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'

type ResetState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; counts: ResetCounts }
  | { kind: 'error'; message: string }

const SHOWN_COUNTS: [table: string, label: string][] = [
  ['employees', 'employees'],
  ['brands', 'brands'],
  ['brand_processes', 'brand-processes'],
  ['assignments', 'assignments'],
  ['leaves', 'leaves'],
  ['public_holidays', 'holidays'],
]

export default function App() {
  const configured = isSupabaseConfigured()
  const [reset, setReset] = useState<ResetState>({ kind: 'idle' })

  async function runReset() {
    setReset({ kind: 'running' })
    try {
      // Loaded on demand so the seed dataset isn't in the main bundle.
      const { resetDemoData } = await import('@/lib/seed')
      setReset({ kind: 'done', counts: await resetDemoData(getSupabase()) })
    } catch (err) {
      setReset({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-6 px-4 py-12">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Phase 2: seed data</p>
        <h1 className="text-3xl font-semibold tracking-tight">Smart Roster</h1>
        <p className="text-muted-foreground">
          Monthly rosters for brand support teams. Coverage checks, conflict detection and
          change handling arrive in later phases.
        </p>
      </div>

      <p className="text-sm">
        Database:{' '}
        <span className={configured ? 'text-foreground' : 'text-destructive'}>
          {configured
            ? 'Supabase is configured.'
            : 'Supabase isn’t configured. Copy .env.example to .env and fill in both values.'}
        </span>
      </p>

      <div className="flex flex-wrap gap-3">
        <Button disabled>Generate roster</Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={!configured || reset.kind === 'running'}>
              {reset.kind === 'running' ? 'Resetting…' : 'Reset demo data'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Replace all data with the demo dataset?</AlertDialogTitle>
              <AlertDialogDescription>
                Employees, brands, assignments, leaves and holidays go back to the December 2026
                demo. Every generated roster is deleted. This can’t be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep current data</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={runReset}>
                Reset demo data
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div aria-live="polite" className="text-sm">
        {reset.kind === 'done' && (
          <p>
            Demo data loaded:{' '}
            {SHOWN_COUNTS.map(([t, label]) => `${reset.counts[t] ?? 0} ${label}`).join(', ')}.
          </p>
        )}
        {reset.kind === 'error' && <p className="text-destructive">{reset.message}</p>}
      </div>
    </main>
  )
}
