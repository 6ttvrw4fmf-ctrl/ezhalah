// REGRESSION BARRIER: نوع=غرفة must never turn its auto-selected «1 غرفة نوم» into a bedrooms
// predicate — and every OTHER bedroom selection must stay strict.
//
// THE BUG THIS PINS (Search & Matching QA, found by hand 2026-08-14 and again 2026-08-17)
// Picking غرفة auto-sets contextBedsList=['1'] and collapses the chip row to a single un-choosable
// "1" (owner rule 2026-07-06). That label was translated into a strict predicate — p_beds_exact=[1]
// on the RPC and l.beds === 1 client-side — and bedrooms deliberately excludes unknown counts. So
// every غرفة listing whose SOURCE never published a bedroom number was deleted from the results by a
// filter the user never chose:
//
//   nationwide production_ready غرفة: 2,406 rows — only 475 reachable, 1,888 lost to unrecorded
//   counts, 43 to a differing published count. الرياض/إيجار/سنوي: the app's own trending panel
//   promised 1,172 while the search delivered 1, ON THE SAME SCREEN.
//
// THE TWO FAILURE DIRECTIONS THIS TEST MUST CATCH
//   1. Regression: someone restores the Room lock as a predicate → غرفة searches collapse again.
//   2. Over-correction: someone drops the bedrooms predicate more broadly → a 3-bedroom request
//      starts returning unknown-bedroom apartments. That would be a WORSE bug than the original.
//
// bedroomTokens() is the single source that feeds BOTH the server param (rpcFilterParams →
// p_beds_exact / p_beds_min in src/data/remote.ts) and the client predicate (bedroomFilter in
// src/data/search.ts), so asserting on it covers both surfaces at once. It is imported and EXECUTED
// here — via the zero-dependency rule in src/lib/roomBedrooms.ts, which is what makes that possible
// without dragging in search.ts's runtime graph (same design as src/lib/searchDefaults.ts).
//
//   node --experimental-strip-types scripts/verify-room-bedrooms-not-a-predicate.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isRoomOnlySelection, bedroomTokensPure, ROOM_CLEAN_TYPE } from '../src/lib/roomBedrooms.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  if (!ok) { failed++; if (detail) console.error(`    ${detail}`); }
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

console.log('room-bedrooms-not-a-predicate: غرفة’s auto "1" is a label, never a filter\n');

// ── 1. The pure rule itself, executed ───────────────────────────────────────────────────────────
check('غرفة alone is a Room-only selection', isRoomOnlySelection([ROOM_CLEAN_TYPE]));
check('غرفة + شقة is NOT Room-only (bedroom chips are fully available again → stay strict)',
  !isRoomOnlySelection([ROOM_CLEAN_TYPE, 'Apartment']));
check('شقة alone is not Room-only', !isRoomOnlySelection(['Apartment']));
check('no selection is not Room-only', !isRoomOnlySelection(null) && !isRoomOnlySelection([]));

// ── 2. bedroomTokensPure(), the ONE rule feeding p_beds_exact AND bedroomFilter ─────────────────
// src/data/search.ts's bedroomTokens(q) is a thin adapter over this (asserted in §3), so these
// assertions cover the server param and the client predicate at once — executed, not grepped.
const toks = (i: Parameters<typeof bedroomTokensPure>[0]) => JSON.stringify(bedroomTokensPure(i));
const ROOM = ROOM_CLEAN_TYPE;

// THE FIX: the auto-applied Room lock produces NO tokens → p_beds_exact null → the 1,888 rooms whose
// source never published a bedroom count are reachable again. Fails on the pre-fix code (returned ["1"]).
check('غرفة + auto-selected "1" → NO bedroom tokens (the whole bug)',
  toks({ types: [ROOM], beds: ['1'] }) === '[]',
  `got ${toks({ types: [ROOM], beds: ['1'] })} — the Room lock is filtering again; every غرفة row with ` +
  `an unpublished bedroom count is being deleted from results while the trending panel still promises them`);

// NOT over-corrected — a real user bedroom choice must stay STRICT everywhere else. An
// unknown-bedroom apartment must never answer a 3-bedroom request.
check('شقة + "3" → still filters on 3', toks({ types: ['Apartment'], beds: ['3'] }) === '["3"]');
check('فيلا + "5+" → still filters on 5+', toks({ types: ['Villa'], beds: ['5+'] }) === '["5+"]');
check('multi-select "2","4" → both kept', toks({ types: ['Apartment'], beds: ['2', '4'] }) === '["2","4"]');
check('group level (no type) + "3" → still filters', toks({ beds: ['3'] }) === '["3"]');
check('غرفة + شقة + "1" → still filters (chips are choosable again, so "1" IS a choice)',
  toks({ types: [ROOM, 'Apartment'], beds: ['1'] }) === '["1"]');

// The AI-agent surface (routine #2) is untouched: an explicitly parsed `detail` still wins.
check('غرفة + explicit detail "2" (agent) → still filters on 2',
  toks({ types: [ROOM], beds: ['1'], detail: '2' }) === '["2"]');
check('single-select type + non-bedroom detail (e.g. مكتب "3" = size) → no bedroom tokens',
  toks({ type: 'Office', detail: '3', typeDetailIsBedrooms: false }) === '[]');
check('single-select bedroom type + detail "3" → filters on 3',
  toks({ type: 'Apartment', detail: '3', typeDetailIsBedrooms: true }) === '["3"]');
check('garbage bedroom token is ignored', toks({ beds: ['abc'] }) === '[]');

// ── 3. The call site still routes through the shared rule (no re-inlined divergent copy) ────────
const searchSrc = readFileSync(join(import.meta.dirname, '..', 'src/data/search.ts'), 'utf8');
check('src/data/search.ts imports the shared rule from src/lib/roomBedrooms.ts',
  /import\s*\{[^}]*bedroomTokensPure[^}]*\}\s*from\s*'@\/lib\/roomBedrooms'/.test(searchSrc),
  'the Room rule has been re-inlined or removed — two copies of this rule is exactly the drift this repo keeps getting bitten by');
check('bedroomTokens() is a thin adapter over the shared rule (no second copy of the logic)',
  /return\s+bedroomTokensPure\(\{/.test(searchSrc)
  && /types:\s*effectiveTypes\(q\)/.test(searchSrc)
  && /beds:\s*effectiveBeds\(q\)/.test(searchSrc),
  'bedroomTokens() no longer delegates to bedroomTokensPure() with the real selections — the rule has been ' +
  'forked, so the barrier above would be asserting logic the app no longer runs');

// ── 4. The UI still shows the chip: the owner rule is intact, only the PREDICATE is gone ────────
const uiSrc = readFileSync(join(import.meta.dirname, '..', 'src/app/index.tsx'), 'utf8');
check('src/app/index.tsx still locks the displayed chip to «1» for غرفة (owner rule 2026-07-06 unchanged)',
  /nowRoomOnly\s*\?\s*\[\s*'1'\s*\]/.test(uiSrc),
  'the displayed lock was removed too — that is a separate product change and NOT what this fix authorised');

console.log(failed === 0
  ? '\n✅ room-bedrooms-not-a-predicate: passed.'
  : `\n❌ ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
