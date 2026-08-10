// The app's PUBLIC Supabase endpoint, as ONE committed constant.
//
// WHY THIS FILE EXISTS (2026-08-10 senior audit): the two owner-approved LIVE behavioral barriers —
// `.github/workflows/diversity-live-check.yml` and `district-suggestion-parity-live-check.yml` —
// had NEVER EXECUTED once since they shipped. Both read `${{ secrets.EXPO_PUBLIC_SUPABASE_ANON_KEY }}`,
// that repo secret was never created, so the value expanded to empty, the scripts hit their
// `SKIP-FAIL: set EXPO_PUBLIC_SUPABASE_ANON_KEY` branch and exited 1 on EVERY scheduled run. The
// barriers looked "red but known" instead of "never ran" — a guard that has never executed protects
// nothing, and the red was indistinguishable from a real regression.
//
// This value is NOT a secret and never was. It is the RLS-respecting anon/publishable key that ships
// inside the client bundle every visitor downloads. The repo ALREADY treats it as a committed
// constant in two places that work fine today — `scripts/safe-deploy.sh` (LOCK_ANON_KEY) and
// `scripts/verify-live-canon-sync.ts` — and `verify-platform-diversity-live.ts` already defaults the
// project URL the same way. Centralising it here removes a third and fourth copy rather than adding
// a new exposure, and it makes a scheduled barrier's ability to run independent of repo-secret
// configuration that nobody is watching.
//
// NEVER put the service role key here. Anything in this file is world-readable, and the live
// barriers assert production behaviour through the exact anon path real clients hit — a privileged
// key would mask precisely the RLS/permission regressions they exist to catch.

export const PUBLIC_SUPABASE_URL = 'https://aannarbkwcymrotzwdbo.supabase.co';

/** RLS-respecting anon key — shipped in the public client bundle. Not a credential to protect. */
export const PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhbm5hcmJrd2N5bXJvdHp3ZGJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDgxMDAsImV4cCI6MjA5NTk4NDEwMH0.Z-GhSpan6otYWkc8sU43Dw5PT5T_VBUMr0IDZShCQw0';

/**
 * Resolve the public endpoint a live barrier should talk to.
 *
 * Environment still WINS when set, so a run can be pointed at a branch/preview project or given a
 * rotated key without a code change. The committed constants are the fallback, so an unset (or
 * never-created) repo secret degrades to "checks production" instead of "silently never runs".
 *
 * `||` here, deliberately, NOT `??`: an unset `${{ secrets.X }}` in a workflow expands to the EMPTY
 * STRING, not undefined. `??` keeps `''` and would send an empty apikey header — reintroducing the
 * same never-runs failure in a harder-to-read form (a 401 instead of a clear SKIP-FAIL).
 */
export function resolvePublicSupabase(env: NodeJS.ProcessEnv = process.env): {
  url: string;
  key: string;
} {
  return {
    url: env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || PUBLIC_SUPABASE_URL,
    key:
      env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
      env.EXPO_PUBLIC_SUPABASE_KEY || // the name the app's deploy preflight uses
      env.SUPABASE_ANON_KEY ||
      PUBLIC_SUPABASE_ANON_KEY,
  };
}
