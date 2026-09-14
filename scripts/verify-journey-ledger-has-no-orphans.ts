// THE JOURNEY LEDGER MAY NOT CARRY A ROW NOTHING CAN EVER REFRESH (routine #6, 2026-09-14).
//
// `verify-journey-ledger-reachable.ts` (2026-08-31) closed the WRITE door — `ledgerRecord()` refuses
// a key no committed journey can emit. That guard is correct, still in force, and untouched here.
//
// It cannot see rows ALREADY in the table, and three were. See scripts/lib/ledgerOrphans.ts for the
// full account; in one line: three pre-suffix rows from 2026-08-30 sat unwritable and 15 days stale
// while their own descendants ran green that morning, so the three best-covered adversarial surfaces
// permanently impersonated the three most neglected ones at the top of every oldest-first query —
// and this routine followed that signal on 2026-09-14 before catching it.
//
// THE HALVES. Reachability is pure set math, so it is proven HERE, offline, by execution. Whether
// production's table actually satisfies it needs a live read, which must never sit in `npm test`:
// the required suite is HERMETIC (AGENTS.md), and a check whose verdict is decided by production's
// state fails unrelated diffs. Both halves import the SAME predicate from scripts/lib/ledgerOrphans.ts,
// so this offline proof is a statement about the code that really decides production's verdict.
//
// Run: node --experimental-strip-types scripts/verify-journey-ledger-has-no-orphans.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry, npmTestRuns } from './lib/testRegistry.ts';
import { liveHalfProblems } from './lib/liveHalf.ts';
import { orphanLedgerKeys, producibleLedgerKeys, LEDGER_ENGINES } from './lib/ledgerOrphans.ts';

const ROOT = join(import.meta.dirname, '..');
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// ── 1. the predicate, EXECUTED ──────────────────────────────────────────────────────────────────
const NAMES = ['cold-open', 'voice-control'];

check('1a a key the suite can write is not an orphan',
  orphanLedgerKeys(NAMES, ['cold-open:desktop', 'cold-open:mobile']).length === 0);

check('1b every engine the sweep runs is producible, not just chromium',
  orphanLedgerKeys(NAMES, ['cold-open:webkit:desktop', 'cold-open:firefox:mobile']).length === 0,
  `engines=${LEDGER_ENGINES.join(',')}`);

// THE LOAD-BEARING CASE — the exact shape of the three real rows.
check('1c a PRE-SUFFIX bare key is an orphan (the 2026-08-30 rows)',
  orphanLedgerKeys(NAMES, ['cold-open']).join() === 'cold-open');

// THE OTHER WAY THIS RECURS, and the likelier one: journeys get renamed. PART 9.5 is an entire
// section about a rename four e2e suites were never updated for.
check('1d a RENAMED journey orphans its old keys',
  orphanLedgerKeys(['voice-input'], ['voice-control:desktop', 'voice-input:desktop']).join() === 'voice-control:desktop');

check('1e a viewport the suite never writes is an orphan',
  orphanLedgerKeys(NAMES, ['cold-open:tablet']).join() === 'cold-open:tablet');

check('1f orphans come back sorted and de-duplicated (a stable, diffable message)',
  orphanLedgerKeys(NAMES, ['z-gone:desktop', 'a-gone:desktop', 'z-gone:desktop']).join() === 'a-gone:desktop,z-gone:desktop');

check('1g an empty ledger has no orphans, and an empty registry orphans everything it is shown',
  orphanLedgerKeys(NAMES, []).length === 0 && orphanLedgerKeys([], ['cold-open:desktop']).length === 1);

// The producible set must come from ledgerKeysFor() itself — a second copy of the key spelling is
// how the two sides drift apart silently.
const producible = producibleLedgerKeys(['cold-open']);
check('1h producible = 2 viewports x 3 engines per journey, from the harness\'s own key builder',
  producible.size === 6 && producible.has('cold-open:desktop') && producible.has('cold-open:webkit:mobile'),
  [...producible].sort().join(','));

// ── 2. the rule is reachable from the committed runner's REAL journey list ───────────────────────
// Not a fixture: if the runner's registry and the key builder ever disagree, every live row becomes
// an orphan and this says so here rather than in production.
const runner = readFileSync(join(ROOT, 'e2e/journeys/run.mjs'), 'utf8');
const registered = [...runner.matchAll(/JOURNEYS\['([^']+)'\]\s*=/g)].map((m) => m[1]);
check('2a the committed runner still registers a real journey set', registered.length >= 10,
  `found ${registered.length}`);
check('2b every key the real runner can write is producible under the real predicate',
  orphanLedgerKeys(registered, [...producibleLedgerKeys(registered)]).length === 0);

// ── 3. the live half must still run somewhere ───────────────────────────────────────────────────
// A split must not be able to decay into a deletion: "moved to a workflow" and "quietly removed"
// look identical from inside the suite unless something asserts otherwise.
const LIVE = 'verify-journey-ledger-has-no-orphans-live.ts';
const homing = liveHalfProblems(
  LIVE,
  loadRegistry(ROOT),
  (name) => existsSync(join(ROOT, 'scripts', name)),
  (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null),
);
check(`3a the LIVE half is homed in a workflow that actually invokes it (${LIVE})`,
  homing.length === 0, homing.join('\n      '));

// ── 4. this check's own wiring ──────────────────────────────────────────────────────────────────
// Never prove wiring by string-matching package.json (AGENTS.md): that predicate is false for every
// check now, and matching `run-tests` instead would pass for a file nothing runs.
check('4a this offline half runs in npm test',
  npmTestRuns(ROOT, 'verify-journey-ledger-has-no-orphans'));

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
// Each mutant is a weakening the predicate actually invites. All three were also watched RED against
// scripts/lib/ledgerOrphans.ts on 2026-09-14 and restored; these run the same defects through the
// real predicate on every CI run, so the proof outlives the session that made it.
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught,
    'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

// M1 — reachability weakened to a prefix match on the journey NAME. It looks equivalent and is not:
// it ignores the suffix entirely, so any key whose journey still exists passes however it is
// spelled. That is precisely the three real rows — bare `adv-favorites-remove` while the suite
// writes `adv-favorites-remove:desktop` — so this mutant would have shipped the defect intact.
const prefixMatch = (reg: string[], keys: string[]) => {
  const producibleSet = producibleLedgerKeys(reg);
  return keys.filter((k) => ![...producibleSet].some((p) => p.startsWith(k.split(':')[0])));
};
mustCatch('a name-prefix match letting a BARE pre-suffix key pass as reachable (the real rows)',
  prefixMatch(NAMES, ['cold-open']).length !== orphanLedgerKeys(NAMES, ['cold-open']).length);
mustCatch('…and letting a viewport the suite never writes pass too',
  prefixMatch(NAMES, ['cold-open:tablet']).length !== orphanLedgerKeys(NAMES, ['cold-open:tablet']).length);

// M2 — only chromium counted as producible: every webkit/firefox row becomes a false orphan, and a
// barrier that cries wolf is deleted by the next author (PART 9's first error, in barrier form).
const chromiumOnly = (reg: string[], keys: string[]) => {
  const producibleSet = new Set(reg.flatMap((n) => [`${n}:desktop`, `${n}:mobile`]));
  return keys.filter((k) => !producibleSet.has(k));
};
mustCatch('counting only chromium as producible (every cross-engine row a false orphan)',
  chromiumOnly(NAMES, ['cold-open:webkit:desktop']).length
    !== orphanLedgerKeys(NAMES, ['cold-open:webkit:desktop']).length);

// M3 — the vacuous predicate: a check nothing can ever turn red is decoration, not a barrier.
const neverFinds = (_r: string[], _k: string[]) => [] as string[];
mustCatch('a predicate that can never report an orphan',
  neverFinds(NAMES, ['cold-open']).length !== orphanLedgerKeys(NAMES, ['cold-open']).length);

// THE REAL ROWS. The three keys that were live in production until 2026-09-14 must be caught by the
// shipped predicate against the shipped journey set — the defect itself, not a stand-in for it.
mustCatch('the three pre-suffix rows that were live in production until 2026-09-14',
  orphanLedgerKeys(registered, [
    'adv-favorite-survives-navigation', 'adv-favorites-remove', 'adv-modeswitch-back-push-vs-replace',
  ]).length === 3);

console.log(failures ? `\n${failures} FAILED` : '\njourney ledger: no orphan keys are reachable — predicate proven offline');
process.exit(failures ? 1 : 0);
