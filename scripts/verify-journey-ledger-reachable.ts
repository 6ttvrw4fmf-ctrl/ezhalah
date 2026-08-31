// THE JOURNEY LEDGER MAY NOT ASSERT COVERAGE NOTHING CAN REPRODUCE (routine #6, 2026-08-31).
//
// docs/ops/JOURNEY_PERSISTENCE_ENGINEER.md PART 3 item 7 gives `ops_qa_coverage_ledger` exactly one
// job: make "have we tried this exact sequence before" a QUERY rather than a memory, so coverage
// rotates toward whatever has gone longest untested. A row whose journey lives in no committed file
// defeats precisely that — it reads as coverage forever, can never be re-run, and quietly parks the
// rotation away from a surface nobody is testing.
//
// WHAT HAPPENED (the defect this barrier closes). On 2026-08-30 a #6 run drove three adversarial
// journeys from an ad-hoc script, wrote three ledger rows, and never committed the script; the
// container was then reclaimed. On 2026-08-31 `grep -rl` across the whole tree found NO file that
// could produce `adv-favorites-remove`, `adv-favorite-survives-navigation`, or
// `adv-modeswitch-back-push-vs-replace` — yet two of them were the ledger's only claim of coverage
// for PART 1 mandate clauses no committed journey tested at all:
//   · "Favorites: … the favorited state surviving NAVIGATION and refresh" — sidebar-row-actions
//     proves the refresh half only, and the two halves fail differently (a star written to disk but
//     dropped from context state survives a reload and vanishes on a screen change).
//   · the Filter/Agent toggle's push-vs-replace Back behaviour (index.tsx, owner defect fix
//     2026-08-23) at 375px — routine #4's `tab-switch-no-junk-history` watch is desktop-only.
// Both now exist as committed journeys, and this barrier keeps them — and every future one — real.
//
// This is the journey-side twin of `mon_detect_orphaned_detectors()` (AGENTS.md: "a detector
// outside the roster is decoration"), and of the nine dark detectors that once read as a clean bill
// of health. Same failure class, same answer: the thing that reports health must be reachable.
//
// THE GUARD IS AT THE WRITE POINT, NOT IN A REPORT. harness.mjs's ledgerRecord() refuses any key
// the committed runner cannot emit, and fails CLOSED — a writer that never called registerJourneys()
// owns nothing and records nothing. Exploration stays free (drive any journey you like); what it
// cannot do is mint PERMANENT COVERAGE for itself without landing the journey first, which is
// PART 5's rule already.
//
// Deliberately OFFLINE — it reads tracked repo files and exercises the pure guard, with no network
// and no database, so it is safe in `npm test` on every unrelated PR (the same reason
// verify-migration-drift-vs-production.ts is deliberately kept OUT of it). The LIVE half is the
// sweep itself: run.mjs registers its journeys and every row it writes goes through the guard.
//
// Run: node --experimental-strip-types scripts/verify-journey-ledger-reachable.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';
import { registerJourneys, isOwnedLedgerKey, ledgerKeysFor, ledgerRecord } from '../e2e/journeys/harness.mjs';

const ROOT = join(import.meta.dirname, '..');
const RUNNER = 'e2e/journeys/run.mjs';
const HARNESS = 'e2e/journeys/harness.mjs';

const fail = (msg: string): never => { console.error(`FAIL: ${msg}`); process.exit(1); };
const ok = (msg: string) => console.log(`  ok  ${msg}`);

const runner = readFileSync(join(ROOT, RUNNER), 'utf8');
const harness = readFileSync(join(ROOT, HARNESS), 'utf8');

// ── 1. the committed runner's journeys ──────────────────────────────────────────────────────────
const journeys = [...runner.matchAll(/JOURNEYS\['([^']+)'\]\s*=/g)].map((m) => m[1]);
if (journeys.length < 10) {
  fail(`${RUNNER} declares only ${journeys.length} journeys — the sweep has shrunk, or the parser `
    + `no longer matches how journeys are declared. Either way the ledger guard is now blind.`);
}
if (new Set(journeys).size !== journeys.length) {
  fail(`${RUNNER} declares a duplicate journey name — a later JOURNEYS['x'] silently replaces an `
    + `earlier one, so a journey would stop running while its ledger row kept reporting.`);
}
ok(`${RUNNER} declares ${journeys.length} distinct journeys`);

// ── 2. the mandate clauses that were ledger-only, and must never be again ────────────────────────
// These two are pinned BY NAME because their absence was invisible: the ledger showed them green
// while no committed file could run them. A rename is fine — update this list deliberately — but it
// may not happen as a silent side effect of a refactor, which is exactly how they were lost.
for (const required of ['adv-favorite-survives-navigation', 'adv-modeswitch-back-push-vs-replace']) {
  if (!journeys.includes(required)) {
    fail(`${RUNNER} no longer declares «${required}». It covers a PART 1 mandate clause that was `
      + `ledger-only on 2026-08-30 — asserted as covered while nothing could reproduce it. If this `
      + `journey was deliberately renamed, update this list in the same change.`);
  }
}
ok('both previously ledger-only mandate clauses have committed journeys');

// ── 3. the runner registers BEFORE it records ───────────────────────────────────────────────────
const iRegister = runner.indexOf('registerJourneys(Object.keys(JOURNEYS))');
// The awaited CALL, not the identifier: `ledgerRecord()` also appears in prose above the register
// line, and matching that reported an ordering bug that did not exist (caught by this barrier on
// its own first run — a naive substring is not a call site).
const iRecord = runner.search(/await\s+ledgerRecord\(/);
if (iRegister < 0) {
  fail(`${RUNNER} never calls registerJourneys(Object.keys(JOURNEYS)) — the guard fails closed, so `
    + `every ledger write would be refused and the sweep would record nothing at all.`);
}
if (iRecord >= 0 && iRegister > iRecord) {
  fail(`${RUNNER} calls ledgerRecord() before registerJourneys() — the first rows would be refused.`);
}
ok('the runner registers its journeys before recording any row');

// ── 4. the guard is real, proven in both directions ─────────────────────────────────────────────
// Unregistered ⇒ owns nothing. This is the fail-closed direction, and it is the one that stops an
// ad-hoc script from writing a row at all.
if (isOwnedLedgerKey('cold-open:desktop')) {
  fail('isOwnedLedgerKey() returned true before registerJourneys() was ever called — the guard does '
    + 'not fail closed, so an unregistered probe script could still mint permanent coverage rows.');
}
const refusedUnregistered = await ledgerRecord('cold-open:desktop', 'pass', 'barrier probe');
if (refusedUnregistered !== false) {
  fail('ledgerRecord() did not refuse a write from an unregistered writer.');
}
ok('unregistered writer owns nothing and is refused (fail-closed)');

const owned = registerJourneys(journeys);
if (owned !== journeys.length * 2) {
  fail(`registerJourneys() owns ${owned} keys for ${journeys.length} journeys — expected two per `
    + `journey (:desktop and :mobile), the exact shape run.mjs emits.`);
}
for (const j of journeys) {
  for (const suffix of [':desktop', ':mobile']) {
    if (!isOwnedLedgerKey(j + suffix)) fail(`«${j}${suffix}» is emitted by the runner but not owned.`);
  }
}
ok(`all ${owned} runner-emitted keys are owned after registration`);

// The mutation direction: a key no journey produces must be refused even by a registered writer.
// These are the three real orphans from 2026-08-30 plus their suffixed forms.
const mustBeRefused = [
  'adv-favorites-remove',                          // bare, no viewport suffix — the ad-hoc shape
  'adv-favorite-survives-navigation',              // bare form of a journey that DOES exist suffixed
  'adv-modeswitch-back-push-vs-replace',
  'journey-that-does-not-exist:desktop',
  'cold-open:tablet',                              // a viewport the runner never emits
  'cold-open',
];
for (const key of mustBeRefused) {
  if (isOwnedLedgerKey(key)) {
    fail(`«${key}» is owned, but no committed journey emits it — an unreproducible row could be `
      + `written under this key and would read as coverage forever.`);
  }
  if ((await ledgerRecord(key, 'pass', 'barrier probe')) !== false) {
    fail(`ledgerRecord() accepted «${key}», which no committed journey can produce.`);
  }
}
ok(`${mustBeRefused.length} unreproducible keys refused, including the three real 2026-08-30 orphans`);

// A bad result verb must still be refused for an OWNED key — the pre-existing guard, kept proven.
if ((await ledgerRecord('cold-open:desktop', 'defect', 'barrier probe')) !== false) {
  fail('ledgerRecord() accepted the result verb «defect»; only pass|skip|fail are valid server-side.');
}
ok('an invalid result verb is still refused for an owned key');

// ── 5. key shape has ONE definition ─────────────────────────────────────────────────────────────
// The runner builds its rows as `${key}:${mobile ? 'mobile' : 'desktop'}` and the guard builds its
// owned set from ledgerKeysFor(). Two independent spellings of the same shape is how this drifts:
// the guard would refuse exactly the rows the runner writes, and the sweep would record nothing.
const shape = ledgerKeysFor(['x']);
if (shape.join('|') !== 'x:desktop|x:mobile') {
  fail(`ledgerKeysFor() produced [${shape.join(', ')}] — the runner emits «x:desktop» / «x:mobile».`);
}
if (!/\$\{mobile \? 'mobile' : 'desktop'\}/.test(runner)) {
  fail(`${RUNNER} no longer builds its ledger key as \`\${key}:\${mobile ? 'mobile' : 'desktop'}\`. `
    + `If the key shape changed, ledgerKeysFor() in ${HARNESS} must change with it in the same edit.`);
}
ok('the runner and the guard agree on one ledger-key shape');

// ── 6. the guard cannot be quietly unwired ──────────────────────────────────────────────────────
if (!/isOwnedLedgerKey\(key\)/.test(harness)) {
  fail(`${HARNESS}'s ledgerRecord() no longer consults isOwnedLedgerKey() — the write-point guard `
    + `has been removed, and unreproducible rows can be written again.`);
}
if (!npmTestRuns(ROOT, 'verify-journey-ledger-reachable')) {
  fail('this barrier is not discovered by `npm test` — see scripts/lib/testRegistry.ts.');
}
ok('the write-point guard is wired and this barrier runs in `npm test`');

console.log('PASS: the journey ledger can only record coverage a committed journey can reproduce.');
