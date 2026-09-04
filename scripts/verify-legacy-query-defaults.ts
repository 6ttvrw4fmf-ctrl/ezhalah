// REGRESSION BARRIER — a legacy persisted SearchQuery must never crash the app on read (2026-08-23).
//
// THE BUG: opening a saved sidebar chat whose stored query predates a field crashed the agent
// screen — openStatic → filterToChat did `q.priceInput.match(/\d/g)` on a query with no priceInput
// key ("Cannot read properties of undefined (reading 'match')"). `q.location.trim()` has the same
// shape. Those are the ONLY two required string fields read with a method call (9 `.match` sites in
// src/data/search.ts alone), so guarding every reader would be whack-a-mole; instead migrateGroups —
// the existing on-read migration at every boundary where old data enters (history hydration in
// store.tsx, the `?filter=` parse in agent.tsx, sanitizeForFilterRestore) — fills exactly those two
// fields with '', which is precisely what "absent" means for both (countrywide / no typed price).
//
// EXECUTED, NOT GREPPED, against the real shipped function. Mutation-proven:
//   M1 remove `out.priceInput ??= ''`  → the exact production crash expression throws here
//   M2 remove `out.location ??= ''`    → same for `.trim()`
//   M3 "improve" the fill to `{ ...emptyQuery(), ...raw }` → the no-invented-semantics checks fail
//      (defaulting rentPeriod/category/deal would silently CHANGE what a replayed legacy search does)
//   M4 drop the store.tsx hydration map or the agent.tsx boundary → the wiring checks fail
//
//   node --experimental-strip-types scripts/verify-legacy-query-defaults.ts     (wired into `npm test`)
import { readFileSync } from 'node:fs';
import type { SearchQuery } from '../src/data/search.ts';
import { migrateGroups, sanitizeForFilterRestore } from '../src/lib/searchDefaults.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};

// ── 1. THE CRASH SHAPE — a real pre-priceInput history entry, verbatim minimal ──────────────────
const legacy = migrateGroups({ deal: 'Rent', typeGroup: 'Villas & Houses' } as unknown as SearchQuery);
check('missing priceInput → filled with ""', legacy.priceInput === '');
check('missing location → filled with ""', legacy.location === '');
check('legacy typeGroup still migrates alongside the fill', (legacy.typeGroups ?? []).join() === 'Villas & Houses');

// The EXACT expressions that crashed in production (filterToChat / priceCalcNote) — must not throw
// and must read as "no typed price" / "countrywide".
check('the crashing expression `q.priceInput.match(/\\d/g)` now executes',
  (() => { try { return (legacy.priceInput.match(/\d/g) ?? []).join('') === ''; } catch { return false; } })());
check('the sibling `q.location.trim()` now executes',
  (() => { try { return legacy.location.trim() === ''; } catch { return false; } })());

// A malformed entry with NO query at all: store.tsx hydrates it as `migrateGroups({ ...h.query })`,
// which for undefined spreads to {} — must come out readable, not throw downstream.
const bare = migrateGroups({ ...(undefined as unknown as SearchQuery) });
check('entry with no query object at all → still readable', bare.priceInput === '' && bare.location === '');
check('sanitizeForFilterRestore accepts the legacy shape without crashing',
  (() => { try { return sanitizeForFilterRestore({ deal: 'Buy' } as SearchQuery).location === ''; } catch { return false; } })());

// ── 2. NO INVENTED SEMANTICS — fill ONLY the two crash-prone strings ────────────────────────────
// A "helpful" future refactor to `{ ...emptyQuery(), ...raw }` would default rentPeriod='annual'
// (an agent-path replay's bubble would flip "to rent" → "to rent yearly") and category='Residential'
// (a category-less replay would start FILTERING by category). Absent must stay absent.
for (const k of ['rentPeriod', 'category', 'deal', 'type', 'detail', 'priceBand'] as const) {
  check(`no invented ${k} on a payload that lacks it`, !(k in bare));
}

// ── 3. PRESENT VALUES ARE NEVER OVERWRITTEN ─────────────────────────────────────────────────────
const kept = migrateGroups({ deal: 'Buy', location: 'جدة', priceInput: '5000' } as SearchQuery);
check('present location survives untouched', kept.location === 'جدة');
check('present priceInput survives untouched', kept.priceInput === '5000');

// ── 4. THE BOUNDARIES STAY WIRED (the fix is useless if raw payloads bypass migrateGroups) ──────
const store = readFileSync(new URL('../src/store.tsx', import.meta.url), 'utf8');
check('store.tsx history hydration maps every entry through migrateGroups',
  /Array\.isArray\(saved\)[\s\S]{0,400}migrateGroups\(\{ \.\.\.h\.query \}\)/.test(store));
const agent = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
check('agent.tsx ?filter= parse still routes through migrateGroups',
  agent.includes('migrateGroups(JSON.parse(filter)'));

console.log(failed === 0 ? '\n✅ legacy saved-query defaults hold — no crash-on-read shape survives.' : `\n❌ ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
