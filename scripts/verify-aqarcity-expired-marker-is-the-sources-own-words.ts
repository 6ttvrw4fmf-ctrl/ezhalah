// AQAR CITY'S EXPIRY RULE LIVES IN TWO TIERS, AND BOTH MUST READ THE SOURCE THE SAME WAY.
// Routine #11 (listing lifecycle), 2026-09-27. Completes ops_incident #730.
//
// WHAT HAPPENED
// -------------
// Aqar City reworded its expired page around 2026-09-20. The rule that reads that wording exists
// TWICE, in two different tiers, written independently:
//
//   * scrapers/common/cleanup.py::_aqarcity_expired   — the DELETE tier
//   * scrapers/aqarcity/run.py::_probe_id/_verify_gone — the DEACTIVATION tier
//
// ops_incident #730 (2026-09-25) found the reword and fixed the DELETE copy. It did not touch the
// DEACTIVATION copy, because nothing connected them. So for a further two days the deleter could see
// that an aqarcity ad was expired while the pruner could not, and §G.9.7 — "no equivalent hidden path
// remains" — was answered for one tier only.
//
// Measured 2026-09-27, DIRECT, cohorts INTERLEAVED so a mid-run block would show in both
// (LISTING_LIVENESS.md §4.2 lesson 1):
//
//   marker                             already-dead (n=26)   known-alive controls (n=26)
//   «هذا الإعلان منتهي» (run.py shipped)          0                        0
//   «الإعلان غير متاح»                           26                        0
//   «إعلان منتهي»                                23                        0
//   application/ld+json                           0                       25
//
// Six of those dead rows were `active = true`, at or past the 3-strike grace (missing_count 3 and 6)
// and PRESENT in search_listings_ar: users could find and click six listings Aqar City had already
// expired, and nothing would ever have retired them. That is the §1.1 leak this closes.
//
// §0 HELD THROUGHOUT, in the direction that matters: the blind rule made _verify_gone answer
// `unknown`, so the kill was WITHHELD. Not one listing was wrongly deactivated. The cost was a
// permanently silent oracle, which is ops_incident #778 (muktamel: 1,132/1,132 UNKNOWN) and #714
// (aqar's looks_closed reading markup aqar had stopped emitting) for a third time.
//
// WHAT THIS BARRIER DOES THAT THE SIBLING ONE CANNOT
// -------------------------------------------------
// scripts/verify-aqarcity-expiry-oracle-can-fire.ts already pins the DELETE copy, thoroughly, and is
// left alone. The gap it cannot see is DIVERGENCE: it executes only cleanup.py, so a second copy in
// another tier reading the source differently is invisible to it. This file executes BOTH real
// predicates over ONE corpus and fails if they ever disagree — which is the actual defect class, and
// the reason a third reword will not need to be found twice.
//
// Everything about the marker rule is EXECUTED against real page bytes and real module source
// (scripts/lib/pythonMutant.ts recompiles the REAL module with each defect in it). The wiring section
// is source TEXT and says so.
//
// Deliberately offline: real captured fixtures, no DB, no network.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pyCall } from './lib/pythonMutant.ts';

const ROOT = join(import.meta.dirname, '..');
const RUN_MOD = 'scrapers.aqarcity.run';
const CLEAN_MOD = 'scrapers.common.cleanup';
const RUNPY = join(ROOT, 'scrapers', 'aqarcity', 'run.py');
const FIXTURES = join(ROOT, 'scrapers', 'aqarcity', 'testdata');

let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + what + (ok || !detail ? '' : ' — ' + detail));
  if (!ok) failed++;
};

console.log('verify-aqarcity-expired-marker-is-the-sources-own-words: two tiers, one reading.');

const src = readFileSync(RUNPY, 'utf8');
const EXPIRED_FIXTURE = readFileSync(join(FIXTURES, 'aqarcity_expired_page.excerpt.html'), 'utf8');
const LIVE_FIXTURE = readFileSync(join(FIXTURES, 'aqarcity_live_page.excerpt.html'), 'utf8');

// The fixtures are REAL captures whose provenance line is ASCII-only by construction, so they cannot
// hand a marker to the predicate from their own header. The sibling barrier asserts that in full; we
// re-assert the one property we depend on rather than trusting it silently.
for (const [name, text] of [['expired', EXPIRED_FIXTURE], ['live', LIVE_FIXTURE]] as const) {
  const first = text.split('\n')[0];
  // eslint-disable-next-line no-control-regex
  check(/^[\x00-\x7F]*$/.test(first), `the ${name} fixture's provenance line is ASCII-only`,
    'a fixture that prints the Arabic phrases in its own header manufactures the property it tests');
}

type Case = [name: string, body: string, expectExpired: boolean];
const CASES: Case[] = [
  // ── REAL BYTES ────────────────────────────────────────────────────────────────────────────────
  ['the real captured EXPIRED page is expired', EXPIRED_FIXTURE, true],
  ['the real captured LIVE page is NOT expired', LIVE_FIXTURE, false],
  // ── THE CURRENT WORDING, both signals ─────────────────────────────────────────────────────────
  ['the current banner alone', '<h2 class="text-lg font-bold">الإعلان غير متاح</h2>', true],
  ['the title suffix alone', '<title>فيلا - الخبر - إعلان منتهي | عقار ستي</title>', true],
  ['the same suffix in og:title (quote terminator)',
    '<meta property="og:title" content="ارض للبيع - إعلان منتهي">', true],
  // ── THE LEGACY WORDING still convicts: a cached or older page carrying it is still expired ────
  ['the legacy banner is still honoured', 'قبل التغيير: الإعلان منتهي', true],
  // ── THE FALSE-DEATH TRAPS. On this platform a wrong dead marker eventually DELETES a live
  // listing, so the anchoring is load-bearing, not tidiness.
  ['a seller writing the phrase in free text is NOT a death',
    '<script type="application/ld+json">{}</script><p>البائع يقول إعلان منتهي قريبا</p>', false],
  ['a live listing with an enclosed majlis is NOT a death',
    '<script type="application/ld+json">{}</script><p>فيلا بمجلس مغلق ومطبخ مغلق</p>', false],
  ['an unparseable shell with no marker is NOT a death', 'x'.repeat(4000), false],
  ['an empty body is NOT a death', '', false],
];

const call = (mod: string, fn: string, mutatedSource?: string): boolean[] =>
  pyCall(ROOT, mod, fn, CASES.map((c) => [c[1]]), mutatedSource) as boolean[];

// ── EXECUTED: the DEACTIVATION tier's real predicate, on real bytes ────────────────────────────
let runVerdicts: boolean[];
let cleanVerdicts: boolean[];
try {
  runVerdicts = call(RUN_MOD, '_is_expired_body');
  cleanVerdicts = call(CLEAN_MOD, '_aqarcity_expired');
} catch (e) {
  check(false, 'could not execute both predicates', (e as Error).message);
  console.log('\n❌ verify-aqarcity-expired-marker-is-the-sources-own-words: the barrier could not run.');
  process.exit(1);
}
CASES.forEach(([name, , want], i) => {
  check(runVerdicts[i] === want, '(executed, run.py) ' + name,
    `expected expired=${want}, got ${runVerdicts[i]}`);
});

// ── EXECUTED: THE TWO TIERS AGREE. This is the rule the 2026-09-25 fix had no way to state. ────
const divergent = CASES.filter((_c, i) => runVerdicts[i] !== cleanVerdicts[i]).map((c) => c[0]);
check(divergent.length === 0,
  '(executed) the DELETE tier and the DEACTIVATION tier return the SAME verdict on every case',
  'they disagree on: ' + divergent.join(' | ') +
  ' — two copies of a source\'s wording drifting apart IS ops_incident #730');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// MUTATION PROOF — each mutant recompiles scrapers/aqarcity/run.py with a real defect in it. A
// mutation whose anchor has moved is a FAILURE, not a pass: a silently-unapplied mutant is a
// barrier reporting that it caught something it never broke.
// ─────────────────────────────────────────────────────────────────────────────────────────────
let mutants = 0;
const mustCatch = (what: string, mutate: (s: string) => string) => {
  mutants++;
  const mutated = mutate(src);
  if (mutated === src) {
    check(false, '(mutation) ' + what, 'MUTATION TARGET VANISHED — the anchor moved, so this ' +
      'mutant proved nothing. Re-point it at the current source.');
    return;
  }
  let out: boolean[];
  try {
    out = call(RUN_MOD, '_is_expired_body', mutated);
  } catch {
    check(true, '(mutation) catches ' + what + ' [mutant refused to run]');
    return;
  }
  // Caught either by a wrong verdict, or by diverging from the delete tier.
  const wrong = CASES.some((c, i) => out[i] !== c[2]);
  const drifted = CASES.some((_c, i) => out[i] !== cleanVerdicts[i]);
  check(wrong || drifted, '(mutation) catches ' + what,
    'MUTANT SURVIVED — every case still held with the defect present, so this barrier is asserting ' +
    'the bug rather than the rule');
};

// THE SHIPPED DEFECT: the single legacy literal that matched 0 of 26 real dead pages.
mustCatch('reverting to the legacy-only literal (0/26 real dead pages detected)',
  (s) => s.replace(/^EXPIRED_BANNERS = \([\s\S]*?^\)/m,
    'EXPIRED_BANNERS = (\n    "هذا الإعلان منتهي",\n)'));
// Each signal removed in turn. TWO are kept precisely because this incident IS one signal drifting.
mustCatch('dropping the current banner «الإعلان غير متاح»',
  (s) => s.replace('    "الإعلان غير متاح",   # current banner: <h2 …>الإعلان غير متاح</h2>\n', ''));
mustCatch('dropping the legacy banner',
  (s) => s.replace('    "الإعلان منتهي",      # the wording this platform used until 2026-09-20\n', ''));
mustCatch('the title-suffix signal never matching',
  (s) => s.replace(/^EXPIRED_TITLE_SUFFIX = re\.compile\(.*\)$/m,
    'EXPIRED_TITLE_SUFFIX = re.compile(r"\\bTHIS_WILL_NEVER_APPEAR\\b")'));
// THE DANGEROUS DIRECTION: un-anchoring the title phrase. Every seller who writes «إعلان منتهي» in a
// description becomes a death — and on this platform a death eventually becomes a DELETE.
mustCatch('un-anchoring the title phrase into a bare substring match',
  (s) => s.replace(/^EXPIRED_TITLE_SUFFIX = re\.compile\(.*\)$/m,
    'EXPIRED_TITLE_SUFFIX = re.compile(r"إعلان منتهي")'));
// Both absolute collapses.
mustCatch('the predicate always answering expired (every live listing a false death)',
  (s) => s.replace(/    return \(any\(m in b for m in EXPIRED_BANNERS\)\n            or bool\(EXPIRED_TITLE_SUFFIX\.search\(b\)\)\)/,
    '    return True'));
mustCatch('the predicate never answering expired (the oracle goes silent again)',
  (s) => s.replace(/    return \(any\(m in b for m in EXPIRED_BANNERS\)\n            or bool\(EXPIRED_TITLE_SUFFIX\.search\(b\)\)\)/,
    '    return False'));
// The rejected marker, added back: «مغلق» separated 26/0 on the day and is still wrong, because a
// live listing uses it about a room.
mustCatch('«مغلق» being added as a banner (a live room description becomes a death)',
  (s) => s.replace('EXPIRED_BANNERS = (', 'EXPIRED_BANNERS = (\n    "مغلق",'));

// ── WIRING (source TEXT, and this section says so) ─────────────────────────────────────────────
// The defect's shape is a STALE COPY, so what matters is that every consumer in this file asks the
// one predicate, and that the restored kill path is gated by the in-run positive control.
const between = (from: string, to: string): string => {
  const a = src.indexOf(from);
  if (a < 0) return '';
  const b = src.indexOf(to, a);
  return src.slice(a, b < 0 ? undefined : b);
};
const probeId = between('def _probe_id(', 'def sequential_id_urls(');
const verifyGone = between('def _verify_gone(', 'pruned = 0');

check(/_is_expired_body\(r\.text\)/.test(probeId), '(wiring) _probe_id asks the one predicate');
check(/if _is_expired_body\(body\) or "Page Not Found" in body:/.test(src),
  '(wiring) map_listing asks the one predicate too',
  'a second private literal here is how the next reword survives this fix');
// LISTING_LIVENESS.md §5.4 / §4.2 lesson 3: this platform's "gone" IS an HTTP 200, so the kill needs
// an in-run positive control. BOTH kill shapes go through it — including 'notfound', which shipped
// with no control at all, so this is strictly more conservative than what it replaces.
check(/if status in \("notfound", "expired"\):/.test(verifyGone) && /_canary_ok\(/.test(verifyGone),
  '(wiring) both kill shapes go through the in-run positive control');
check(/return "unknown", f"withheld, source not proven to be answering/.test(verifyGone),
  '(wiring) a failed control yields UNKNOWN, never a removal');
check(/ok, reason = False, "no canary was supplied, so no removal can be believed"/.test(src),
  '(wiring) the control FAILS CLOSED when no canary was supplied');
check(/set_liveness_canaries\(\[r\.get\("listing_url"\) for r in \(res \+ com\)\[:3\]\]\)/.test(src),
  '(wiring) the canary is armed from listings this run actually parsed');
check(!/set_liveness_canaries[\s\S]{0,400}last_verified_alive_at/.test(src),
  '(wiring) the canary is NOT armed from last_verified_alive_at',
  'a control set that certifies itself cannot detect its own rot (ops_incident #168)');

// ── NO THIRD COPY inside this file. Any hardcoded end-of-ad literal outside the two constants is
// RED, so the next reword is a one-line change in one place rather than a hunt.
const constantsBlock = (src.match(/^EXPIRED_BANNERS = \([\s\S]*?^EXPIRED_TITLE_SUFFIX = re\.compile\(.*\)$/m) ?? [''])[0];
const strays: string[] = [];
src.split('\n').forEach((line, i) => {
  if (/^\s*#/.test(line)) return;                                  // prose may quote the wording
  if (line.trim() && constantsBlock.includes(line)) return;        // the constants themselves
  if (/منتهي|غير متاح/.test(line)) strays.push(`run.py:${i + 1} ${line.trim().slice(0, 64)}`);
});
check(strays.length === 0, '(wiring) no hardcoded end-of-ad literal outside the two constants',
  strays.join(' | '));

console.log(
  failed === 0
    ? `\n✅ verify-aqarcity-expired-marker-is-the-sources-own-words: ${CASES.length} executed cases ` +
      `× 2 tiers agreeing, ${mutants} mutants caught, wiring held.`
    : `\n❌ verify-aqarcity-expired-marker-is-the-sources-own-words: ${failed} failure(s).`,
);
process.exit(failed === 0 ? 0 : 1);
