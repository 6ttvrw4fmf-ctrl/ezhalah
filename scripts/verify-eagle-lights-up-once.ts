// The sidebar eagle lights up ONCE per log-in / sign-up, never on every menu open (owner 2026-10-24). Executes the real
// mark/take pair against an in-memory store, and pins the three wiring points: the store marks a fresh sign-in, the
// OAuth button marks before its redirect, the sidebar eagle takes the mark and plays the light-up.
import { readFileSync } from 'node:fs';
import { markEagleLightUp, takeEagleLightUp } from '../src/lib/eagleLightUp.ts';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`); if (!ok) failed++; };
const mutation = (name: string, brokenStillPasses: boolean) => check(`(mutation) catches ${name}`, !brokenStillPasses);
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };

const t0 = 1_000_000_000_000;
{ const s = mem(); markEagleLightUp(t0, s);
  check('after a sign-in the first open plays the light-up', takeEagleLightUp(t0 + 5_000, s));
  check('…and the next open does not (once per sign-in)', !takeEagleLightUp(t0 + 9_000, s)); }
{ const s = mem(); check('no sign-in → no light-up', !takeEagleLightUp(t0, s)); }
{ const s = mem(); markEagleLightUp(t0, s); check('a mark nobody saw for a day is stale', !takeEagleLightUp(t0 + 25 * 3600_000, s)); }
{ const s = mem(); markEagleLightUp(t0, s); takeEagleLightUp(t0 + 1, s); markEagleLightUp(t0 + 10, s);
  check('the next sign-in plays it again', takeEagleLightUp(t0 + 20, s)); }

const store = readFileSync('src/store.tsx', 'utf8'), auth = readFileSync('src/lib/auth.ts', 'utf8'), sky = readFileSync('src/components/SidebarSky.tsx', 'utf8');
const wired = (st: string, au: string, sk: string) =>
  /event === 'SIGNED_IN' && !signedInNowRef\.current\) markEagleLightUp\(\)/.test(st)
  && /markEagleLightUp\(\);\s*\n\s*const \{ error \} = await supabase\.auth\.signInWithOAuth/.test(au)
  && /useState\(\(\) => lit && takeEagleLightUp\(\)\)/.test(sk) && /lightUp \? EAGLE_LIGHTUP : EAGLE_LIT/.test(sk);
check('wired: store marks a fresh sign-in, OAuth marks before redirect, sidebar eagle takes it', wired(store, auth, sky));
mutation('a sidebar that plays on every open (never takes the mark)', wired(store, auth, sky.replace('useState(() => lit && takeEagleLightUp())', 'useState(() => lit)')));
mutation('an OAuth sign-in that forgets the mark', wired(store, auth.replace(/markEagleLightUp\(\);\s*\n(\s*const \{ error \} = await supabase\.auth\.signInWithOAuth)/, '\n$1'), sky));

if (failed) { console.error(`\n✗ eagle light-up: ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ the sidebar eagle lights up once per sign-in');
