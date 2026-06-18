import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;

// Null when env isn't configured — the data layer falls back to bundled mock data so the app
// (and preview) never hard-fails on a missing backend.
// Real sign-in sessions must survive reloads/redirects (OAuth bounces back to /auth),
// so we persist + auto-refresh when a backend is configured. `detectSessionInUrl` lets
// the web OAuth redirect hand its token back to the client automatically.
export const supabase =
  url && key
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;
