// The §42 FULL-FILTER TRENDING PARITY contract (owner permanent rule, 2026-08-22) must stay in
// docs/ops/SEARCH_MATCH_QA_ENGINEER.md exactly the way the routine relies on it, and its report
// block must stay wired into §28 (daily heartbeat) and §40.9 (major certification).
//
// THE FAILURE CLASS THIS EXISTS FOR:
//   §42 codifies which filters Trending must reflect (deal, period, region, city, district,
//   bedrooms, area, price, AF answers, plus every future filter). If the routine's spec drops
//   any dimension — silently or by accident — the routine will stop testing it, and the class
//   of bug the owner just watched fixed (#919: narrowing dropping Trending refresh) can return
//   without alarm. The report block is the second half of the same rule — a run that silently
//   omits any of TRENDING FULL-STATE VERIFIED / CITY PARITY / DISTRICT PARITY / BEDROOMS /
//   AREA / PRICE / AF / NO-CITY / STALE / COUNT→CLICK / DIVERSITY / RENT-ONLY / BUY+RENT
//   masks the same class.
//
// Deliberately OFFLINE, like the other verifiers in `npm test`.
//
// Run: node --experimental-strip-types scripts/verify-trending-parity-contract.ts
import { readFileSync } from 'node:fs';

const SPEC_PATH = 'docs/ops/SEARCH_MATCH_QA_ENGINEER.md';
const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

const body = readFileSync(SPEC_PATH, 'utf8');

// ── §42 anchor + subsection presence ─────────────────────────────────────────
check(/^## 42\. FULL-FILTER TRENDING PARITY \(owner permanent rule, 2026-08-22\)/m.test(body),
  '§42 header present with owner-permanent-rule marker (2026-08-22)',
  '§42 header missing, renumbered, or its owner-rule stamp dropped — the routine is not bound by this contract');

for (const [num, label] of [
  ['42.1', 'The full state Trending must honour'],
  ['42.2', 'The three quantities that must agree — every run'],
  ['42.3', 'The minimum recurring case matrix'],
  ['42.4', 'The no-city-selected case'],
  ['42.5', 'Stale-state invalidation'],
  ['42.6', 'Architectural rule'],
  ['42.7', 'Permanent barriers'],
  ['42.8', 'The separate UX rule from this work'],
  ['42.9', 'The priority order this rule lives under'],
  ['42.10', 'Required report block'],
] as const) {
  check(new RegExp(`^### ${num.replace('.', '\\.')}\\b`, 'm').test(body),
    `§${num} subsection present (${label})`,
    `§${num} subsection missing — the ${label} rule is gone`);
}

// ── §42.1 must enumerate the full filter set (any silent drop reintroduces the class) ────────
for (const field of [
  'category',
  'group',
  'property type',
  'شراء',
  'إيجار',
  'سنوي',
  'شهري',
  'region',
  'city',
  'district',
  'bedrooms',
  'area min',
  'area max',
  'price min',
  'price max',
  'Advanced Filter',
]) {
  check(body.includes(field),
    `§42.1 enumerates '${field}'`,
    `§42.1 no longer mentions '${field}' — Trending could silently drop it without the routine noticing`);
}

// ── §42.2 four-way agreement chain ──────────────────────────────────────────
check(body.includes('shown count = Trending RPC count = click-through landed count = independent backend/DB truth'),
  '§42.2 states the four-way agreement chain verbatim',
  '§42.2 no longer states the four-way (shown = RPC = click-through = DB truth) chain — the routine loses its adjudication rule');

// ── §42.3 minimum recurring case matrix — must include every listed case ─────
for (const c of [
  'no extra narrowing filters',
  'bedroom only',
  'area only',
  'price only',
  'bedroom + area',
  'bedroom + price',
  'area + price',
  'bedroom + area + price',
  'AF answer',
]) {
  check(body.includes(c),
    `§42.3 minimum recurring case '${c}'`,
    `§42.3 dropped case '${c}' — the routine is no longer required to test it`);
}

// ── §42.5 stale-state must invalidate on every listed field change ───────────
for (const field of ['bedrooms change', 'area min', 'price min', 'property type change', 'deal change', 'period change', 'AF answer change']) {
  check(body.includes(field),
    `§42.5 covers stale-state invalidation on '${field}'`,
    `§42.5 dropped invalidation on '${field}' — a stale count could survive under the changed filter`);
}

// ── §42.6 architectural: ONE full-narrowing parameter builder ────────────────
check(/ONE full-narrowing parameter builder/i.test(body),
  '§42.6 preserves the ONE-builder architectural rule',
  '§42.6 lost the ONE-builder architectural rule — separate partial builders can silently drop filters again');

// ── §42.7 permanent barriers list ────────────────────────────────────────────
for (const b of [
  'bedrooms dropped from Trending',
  'area min/max dropped from Trending',
  'price min/max dropped from Trending',
  'AF state dropped from Trending',
  'city Trending request missing current filter state',
  'district Trending request missing current filter state',
  'district render showing a wider/stale count',
  'stale cache / signature after a filter change',
  'count → click → result mismatch',
]) {
  check(body.includes(b),
    `§42.7 barrier: ${b}`,
    `§42.7 dropped barrier '${b}' — recurrence protection removed`);
}
check(/[Mm]utation-prove/.test(body),
  '§42.7 keeps the mutation-prove requirement',
  '§42.7 no longer requires mutation-proving important barriers — a barrier no one broke is not a barrier');

// ── §42.8 UX rule ────────────────────────────────────────────────────────────
for (const rule of [
  '«إيجار» only',
  '«شراء» only',
  '«شراء» + «إيجار» combined',
]) {
  check(body.includes(rule),
    `§42.8 UX rule branch '${rule}'`,
    `§42.8 dropped UX branch '${rule}' — one state's helper contract can regress silently`);
}

// ── §42.9 priority order ─────────────────────────────────────────────────────
check(body.includes('MATCH FIRST → DIVERSIFY SECOND'),
  '§42.9 keeps MATCH FIRST → DIVERSIFY SECOND priority',
  '§42.9 lost the priority statement — diversity could smuggle an ineligible row into a Trending count');

// ── Report block: every line the owner asked for MUST be in the file ─────────
for (const line of [
  'TRENDING FULL-STATE VERIFIED:',
  'CITY TRENDING PARITY:',
  'DISTRICT TRENDING PARITY:',
  'BEDROOMS INCLUDED:',
  'AREA INCLUDED:',
  'PRICE INCLUDED:',
  'AF STATE INCLUDED:',
  'NO-CITY-SELECTED CASE:',
  'STALE TRENDING COUNTS:',
  'COUNT→CLICK→RESULT MISMATCHES:',
  'DIVERSITY INTRODUCED WRONG RESULTS:',
  'RENT-ONLY MESSAGE CLEAN:',
  'BUY+RENT HELPER ONLY WHEN BOTH:',
]) {
  check(body.includes(line),
    `report block field '${line}'`,
    `report block dropped field '${line}' — recurring runs would silently omit it`);
}

// ── §28 must reference §42 as a required part of the daily heartbeat ─────────
const s28 = body.slice(body.indexOf('## 28.'), body.indexOf('\n## 29.'));
check(/§42|Trending Parity/.test(s28),
  '§28 (daily heartbeat) requires the §42 Trending Parity block verbatim',
  '§28 no longer cross-references §42 — heartbeat reports can silently omit the whole Trending contract');

// ── Package.json must run this guard ─────────────────────────────────────────
const pkg = readFileSync('package.json', 'utf8');
check(pkg.includes('verify-trending-parity-contract'),
  'npm test runs this guard',
  'package.json no longer runs verify-trending-parity-contract.ts — the guard is inert');

console.log('trending-parity-contract: §42 (owner rule 2026-08-22) stays intact\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const p of problems) console.error(`  ✗ ${p}`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} check(s) failed — the §42 Trending Parity contract is degraded.`);
  process.exit(1);
}
console.log('\n✅ trending-parity-contract: passed.');
