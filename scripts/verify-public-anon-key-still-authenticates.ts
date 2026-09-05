// THE COMMITTED FALLBACK ANON KEY MUST STILL AUTHENTICATE AGAINST PRODUCTION.
// Auto-discovered barrier. Added 2026-09-05.
//
// WHY THIS EXISTS. scripts/lib/public-supabase.ts ships a committed anon key as the FALLBACK for
// every live barrier, precisely so an unset repo secret degrades to "checks production" instead of
// "silently never runs". That is the right design — but it means the fallback is load-bearing, and
// nothing verified it still works. If the key is ever rotated in Supabase and not here, every
// barrier that relies on the fallback starts getting 401s. Some of those barriers would go red and
// be fixed; the dangerous ones are any that treat a failed read as "nothing to report".
//
// HONEST PROVENANCE. This barrier was written after I claimed the committed key was stale. It was
// NOT. The key is byte-identical to production's live anon key and returns HTTP 200; my 401 came
// from destructuring `{ url, anonKey }` out of resolvePublicSupabase(), which returns `{ url, key }`
// — so I sent `undefined` as the apikey and blamed the key. The false alarm is the reason the check
// is worth having: nothing in the repo could have told either of us which of the two it was.
//
// So this file answers exactly that question, and pins the field NAME too, because that is the
// mistake a caller actually makes.
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL, resolvePublicSupabase } from './lib/public-supabase.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

console.log('\nThe committed fallback anon key still authenticates against production\n');

// ── 1. The resolver's CONTRACT. `key`, not `anonKey` — pinned because it is the real footgun. ──
const resolved = resolvePublicSupabase({});
check('resolvePublicSupabase() returns exactly { url, key }',
  JSON.stringify(Object.keys(resolved).sort()) === JSON.stringify(['key', 'url']),
  `got: ${Object.keys(resolved).join(', ')} — a caller destructuring {anonKey} sends undefined and gets a 401 that looks like a rotated key`);
check('with an empty env it falls back to the committed constants (barriers still run unattended)',
  resolved.url === PUBLIC_SUPABASE_URL && resolved.key === PUBLIC_SUPABASE_ANON_KEY);

// ── 2. Env still WINS — the fallback must never shadow a rotated key supplied by a secret. ─────
const overridden = resolvePublicSupabase({ EXPO_PUBLIC_SUPABASE_ANON_KEY: 'ROTATED' } as NodeJS.ProcessEnv);
check('an env-supplied key overrides the committed fallback', overridden.key === 'ROTATED');
// `||` not `??`: an unset ${{ secrets.X }} expands to '' and must NOT be honoured as a key.
const emptySecret = resolvePublicSupabase({ EXPO_PUBLIC_SUPABASE_ANON_KEY: '' } as NodeJS.ProcessEnv);
check('an EMPTY secret falls back rather than sending an empty apikey header',
  emptySecret.key === PUBLIC_SUPABASE_ANON_KEY,
  'an unset workflow secret expands to "" — honouring it reintroduces the never-runs failure as a 401');

// ── 3. THE LIVE FACT: the committed key actually authenticates, and RLS still applies. ─────────
const hdrs = (k: string) => ({ apikey: k, Authorization: `Bearer ${k}` });
const probe = await fetch(
  `${PUBLIC_SUPABASE_URL}/rest/v1/search_listings_ar?select=source_table&limit=1`,
  { headers: hdrs(PUBLIC_SUPABASE_ANON_KEY) },
);
check('the COMMITTED fallback key authenticates against production (HTTP 200)',
  probe.status === 200,
  `HTTP ${probe.status} — if this is 401 the key really has been rotated: read the current one from ` +
  `Supabase (anon / publishable key) and update PUBLIC_SUPABASE_ANON_KEY in scripts/lib/public-supabase.ts`);

// A key that authenticates but is PRIVILEGED would silently defeat every RLS regression these
// barriers exist to catch, so prove it is still the anon role.
const claims = (() => {
  try { return JSON.parse(Buffer.from(PUBLIC_SUPABASE_ANON_KEY.split('.')[1], 'base64url').toString()); }
  catch { return null; }
})();
check('the committed key is the ANON role, never service_role',
  claims?.role === 'anon', `role claim: ${claims?.role ?? '<unparseable>'}`);
check('the committed key is not expired', typeof claims?.exp === 'number' && claims.exp * 1000 > Date.now(),
  claims?.exp ? `exp ${new Date(claims.exp * 1000).toISOString()}` : 'no exp claim');

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — the same predicates, against broken keys and resolvers\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
const claimsOf = (jwt: string) => {
  try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()); } catch { return null; }
};
const roleIsAnon = (jwt: string) => claimsOf(jwt)?.role === 'anon';
const notExpired = (jwt: string) => { const c = claimsOf(jwt); return typeof c?.exp === 'number' && c.exp * 1000 > Date.now(); };
const shapeOk = (o: object) => JSON.stringify(Object.keys(o).sort()) === JSON.stringify(['key', 'url']);

// A service_role JWT with the same issuer — the dangerous swap, since it would authenticate fine
// and silently defeat every RLS regression these barriers exist to catch.
const mk = (payload: object) =>
  `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`;
mustCatch('a service_role key substituted for the anon key',
  !roleIsAnon(mk({ iss: 'supabase', role: 'service_role', exp: 4102444800 })));
mustCatch('an expired key', !notExpired(mk({ iss: 'supabase', role: 'anon', exp: 1000000000 })));
mustCatch('a key with no exp claim at all', !notExpired(mk({ iss: 'supabase', role: 'anon' })));
mustCatch('an unparseable key', !roleIsAnon('not-a-jwt'));
// THE ACTUAL MISTAKE THAT PROMPTED THIS FILE: a resolver returning {url, anonKey} instead of
// {url, key} — callers destructure the wrong field, send undefined, and read the 401 as a rotation.
mustCatch('a resolver renamed to return {url, anonKey} (the footgun that faked a rotation)',
  !shapeOk({ url: 'u', anonKey: 'k' }));
mustCatch('the correct {url, key} shape is NOT reported as broken', shapeOk({ url: 'u', key: 'k' }) === true);
// An HTTP 401 from the live probe must be a failure, never tolerated as "probably fine".
const authOk = (status: number) => status === 200;
mustCatch('a 401 from the live probe (a genuinely rotated key)', !authOk(401));

if (mutFail > 0) failed += mutFail;

console.log(
  failed === 0
    ? '\n✅ the committed fallback key is live, anon-scoped, and the resolver contract is intact.\n'
    : `\n❌ ${failed} check(s) failed — live barriers may be silently unauthenticated.\n`,
);
process.exit(failed === 0 ? 0 : 1);
