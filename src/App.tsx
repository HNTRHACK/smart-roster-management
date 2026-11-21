import { Button } from '@/components/ui/button'
import { isSupabaseConfigured } from '@/lib/supabase'

export default function App() {
  const configured = isSupabaseConfigured()

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-6 px-4 py-12">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Phase 1 scaffold</p>
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

      <div>
        <Button disabled>Generate roster</Button>
      </div>
    </main>
  )
}
