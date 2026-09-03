// Pure-module + source-wiring guard for CONTROLLED ROTATION, tier 4 of the MATCH -> DIVERSITY ->
// PHOTO PREFERENCE -> CONTROLLED ROTATION hierarchy (owner PERMANENT rule, 2026-08-29).
//
// src/lib/rotationSeed.ts is the ONLY thing the client controls about rotation - the ordering itself
// is entirely server-side (location_search_candidates_ar's hashtext()-based rot_key, proven live by
// verify-photo-preference-and-rotation-live.ts). This file proves the seed generator's OWN contract:
// deterministic per device, stable within one page load, differs across devices, degrades gracefully
// with no localStorage - by EXECUTING the real module, not by pattern-matching its source text.
//
// It also asserts the OLD mechanism it replaced (the localStorage `ezh_rot:*` per-filter revisit
// counter, and the client-side 25-window rotate-then-rediversify in search.ts) is actually GONE, not
// just superseded in intent - a helper nobody calls protects nothing, and a stale mechanism left
// running ALONGSIDE the new one would double-rotate. And it proves the new seed is actually wired
// into the one place that matters: remote.ts's RPC call.
//
//   node --experimental-strip-types scripts/verify-rotation-seed-contract.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { rotationSeed } from '../src/lib/rotationSeed.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
}

// ── A minimal fake localStorage so the module's persistence path is actually EXERCISED, not just
// its in-memory fallback. globalThis.localStorage doesn't exist under plain Node. ─────────────────
class FakeStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  clear() { this.m.clear(); }
}

function withFakeStorage<T>(fn: () => T): T {
  const g = globalThis as { localStorage?: unknown };
  const prev = g.localStorage;
  g.localStorage = new FakeStorage();
  try { return fn(); } finally { g.localStorage = prev; }
}

// ── 1. Deterministic within one "page load": same call, same moment → same seed ─────────────────────
withFakeStorage(() => {
  const now = new Date('2026-08-29T12:00:00Z');
  const a = rotationSeed(now);
  const b = rotationSeed(now);
  check('same device (persisted token) + same week → identical seed on repeat calls', a === b, `a=${a} b=${b}`);
});

// ── 2. Persists across "reloads": a fresh call after storage already holds a token reuses it ────────
withFakeStorage(() => {
  const now = new Date('2026-08-29T12:00:00Z');
  const first = rotationSeed(now);
  // Simulate a page reload by nothing more than calling again - the module must read the SAME
  // localStorage key it wrote, not mint a new token every call (that would be per-visit, not
  // per-device, reintroducing the exact "identical top 10 for every new user" bug this replaced -
  // except now for EVERY visit, which would be worse, not better).
  const second = rotationSeed(now);
  check('token persists across repeat calls within one storage instance', first === second);
});

// ── 3. Two different devices (two independent storages) get two different seeds ─────────────────────
{
  const now = new Date('2026-08-29T12:00:00Z');
  const deviceA = withFakeStorage(() => rotationSeed(now));
  const deviceB = withFakeStorage(() => rotationSeed(now));
  check('two independent devices get DIFFERENT seeds (fixes the cross-user first-visit problem)',
    deviceA !== deviceB, `A=${deviceA} B=${deviceB}`);
}

// ── 4. Time drift: the SAME device's seed changes across a week boundary, stays fixed within one ────
withFakeStorage(() => {
  const mondayWeek1 = new Date('2026-08-24T12:00:00Z'); // ISO week of 2026-08-24 is one week
  const fridayWeek1 = new Date('2026-08-28T12:00:00Z'); // same ISO week
  const mondayWeek2 = new Date('2026-08-31T12:00:00Z'); // next ISO week
  const s1 = rotationSeed(mondayWeek1);
  const s2 = rotationSeed(fridayWeek1);
  const s3 = rotationSeed(mondayWeek2);
  check('seed is stable within the same ISO week', s1 === s2, `mon=${s1} fri=${s2}`);
  check('seed drifts across a week boundary (exposure is not frozen forever)', s1 !== s3, `week1=${s1} week2=${s3}`);
});

// ── 5. No localStorage (SSR/native/private-mode) → never throws, still returns a usable string ──────
{
  const g = globalThis as { localStorage?: unknown };
  const prev = g.localStorage;
  // @ts-expect-error deliberately absent for this check
  delete g.localStorage;
  let threw = false;
  let seed = '';
  try { seed = rotationSeed(new Date('2026-08-29T12:00:00Z')); } catch { threw = true; }
  g.localStorage = prev;
  check('no localStorage → does not throw', !threw);
  check('no localStorage → still returns a non-empty seed string', typeof seed === 'string' && seed.length > 0);
}

// ── 6. NEVER Math.random()/crypto used as the ordering mechanism itself - only to MINT a seed once.
// The seed is opaque data to the RPC; this module contains no sort/order logic at all. ───────────────
{
  // Strip comments before scanning so prose describing the module (which legitimately uses words
  // like "shuffle" to explain what it does NOT do) can't false-positive the check.
  const rawSrc = readFileSync(new URL('../src/lib/rotationSeed.ts', import.meta.url), 'utf8');
  const codeOnly = rawSrc.replace(/\/\/.*$/gm, '');
  check('rotationSeed.ts contains no .sort()/shuffle call of its own (ordering is server-side only)',
    !/\.sort\(|shuffle\(/i.test(codeOnly), codeOnly.match(/\.sort\(|shuffle\(/i)?.[0]);
}

// ── 7. The OLD mechanism is actually GONE, not just superseded in intent ─────────────────────────────
{
  const storeSrc = readFileSync(new URL('../src/store.tsx', import.meta.url), 'utf8');
  check('store.tsx no longer reads/writes the old ezh_rot: localStorage key', !/ezh_rot:/.test(storeSrc));
  check('store.tsx no longer threads a visitOffset into runSearch', !/visitOffset/.test(storeSrc));

  const searchSrc = readFileSync(new URL('../src/data/search.ts', import.meta.url), 'utf8');
  check('search.ts no longer has the old 25-window rotate-then-rediversify block',
    !/rediversifyByPlatform/.test(searchSrc) && !/opts\?\.visitOffset/.test(searchSrc));

  const platDivSrc = readFileSync(new URL('../src/lib/platformDiversity.ts', import.meta.url), 'utf8');
  check('platformDiversity.ts no longer exports the now-unused rediversifyByPlatform',
    !/export function rediversifyByPlatform/.test(platDivSrc));
}

// ── 8. The NEW seed is actually wired into the one live call site that matters ───────────────────────
{
  const remoteSrc = readFileSync(new URL('../src/data/remote.ts', import.meta.url), 'utf8');
  check('remote.ts imports rotationSeed from @/lib/rotationSeed',
    /import\s*\{\s*rotationSeed\s*\}\s*from\s*'@\/lib\/rotationSeed'/.test(remoteSrc));
  const rpcCallIdx = remoteSrc.indexOf("supabase.rpc('location_search_candidates_ar'");
  check('location_search_candidates_ar RPC call site exists', rpcCallIdx >= 0);
  const rpcCallSlice = remoteSrc.slice(rpcCallIdx, rpcCallIdx + 800);
  check('the RPC call passes p_rotation_seed: rotationSeed()',
    /p_rotation_seed:\s*rotationSeed\(\)/.test(rpcCallSlice), rpcCallSlice.slice(0, 300));
}

console.log(failures === 0
  ? '\n✅ rotation-seed contract holds: deterministic, per-device, time-drifting, old mechanism fully removed, new one wired'
  : `\n❌ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
