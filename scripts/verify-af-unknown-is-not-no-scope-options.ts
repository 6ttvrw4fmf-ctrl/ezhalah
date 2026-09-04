// UNKNOWN IS NOT NO — for Advanced Filter SCOPE options (owner rule 2026-09-04).
//
// THE DEFECT. Every group/type option on the scope cards is priced by its own count RPC (4s cap),
// all fired concurrently. A timed-out or errored count used to leave the option's key ABSENT, and
// scopeQuestionOptions() then dropped it from the card as if the taxonomy branch did not exist.
// Reproduced live 2026-09-04 on Riyadh / Buy / «الشقق والسكن المشترك» (21,892): the two largest
// types — شقة ~10.6k and دور ~9.7k — are the two SLOWEST counts, so they were the ones that vanished
// while غرفة=1 and عمارة سكنية=1,554 stayed. The user's real answer was not on the card; they
// continued; the type stayed unresolved; the cohort intersection was empty; the interview dumped
// the whole group as "done". The user's words: "It just asked me what are you looking for, I chose,
// it just gave me fourteen thousand listings."
//
// THE RULE. A timeout/error must NEVER make a real option disappear. Retry once; if the count is
// still UNKNOWN keep the option visible WITHOUT a number. UNKNOWN is not zero and is not No.
//
// This barrier EXECUTES the real pure builder (src/lib/afScopeOptions.ts) — never a copy — and pins
// the executable shape of the two callers that feed and render it, with comments stripped first
// (A COMMENT IS NOT A CODE PATH). Each check was mutation-proven: the "old" behaviour is rebuilt
// inline below as a mutant and the same assertions are shown to REJECT it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scopeOptionsFromCounts, SCOPE_TOTAL_KEY } from '../src/lib/afScopeOptions.ts';
import { meaningful, offersMeaningfulNarrowing, type AdvancedOption } from '../src/lib/afRanking.ts';
import { stripComments } from './lib/stripComments.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};
const root = join(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const label = (k: string) => `L:${k}`;

console.log('\nUNKNOWN IS NOT NO — scope options survive a slow count (owner 2026-09-04)\n');

// ── 1. The real builder, EXECUTED ────────────────────────────────────────────────────────────────
const keys = ['Apartment', 'Floor', 'Room', 'Studio', 'Residential Building'];
// The live 2026-09-04 shape: the two biggest counts timed out (absent), one errored (null), one is 1.
const live = scopeOptionsFromCounts(keys, { [SCOPE_TOTAL_KEY]: 21892, Room: 1, 'Residential Building': 1554, Studio: null }, label);
const offered = live.options.map((o) => o.key);
check('a count that is ABSENT (timed out) keeps its option on the card: Apartment + Floor still offered',
  offered.includes('Apartment') && offered.includes('Floor'),
  'the exact 2026-09-04 failure — the two largest branches vanished because their counts were slow');
check('a count that is null (errored, still unknown after the retry) keeps its option: Studio still offered',
  offered.includes('Studio'));
check('an UNKNOWN option carries count: null — never 0',
  live.options.filter((o) => ['Apartment', 'Floor', 'Studio'].includes(o.key)).every((o) => o.count === null));
check('measured counts are untouched: Room=1, Residential Building=1554',
  live.options.find((o) => o.key === 'Room')?.count === 1
  && live.options.find((o) => o.key === 'Residential Building')?.count === 1554);
check('unknownCount is null when any offered count is unknown (no fabricated remainder)', live.unknownCount === null);
check('total is the MEASURED scope total when known', live.total === 21892);

const measured = scopeOptionsFromCounts(keys, { [SCOPE_TOTAL_KEY]: 100, Apartment: 60, Floor: 30, Room: 0, Studio: 5, 'Residential Building': 0 }, label);
check('a MEASURED zero is still a dead end and is dropped: Room + Residential Building gone',
  !measured.options.some((o) => o.key === 'Room' || o.key === 'Residential Building'));
check('when every offered count is measured, unknownCount is the honest remainder (100 − 95 = 5)',
  measured.unknownCount === 5 && measured.total === 100);
const noTotal = scopeOptionsFromCounts(['A', 'B'], { A: 7, B: null }, label);
check('with no measured scope total, total falls back to the sum of MEASURED options (a floor, never an invention)',
  noTotal.total === 7 && noTotal.unknownCount === null);
const nothing = scopeOptionsFromCounts(['A', 'B'], null, label);
check('a null counts row (nothing measurable) offers every candidate, all unknown — never an empty card',
  nothing.options.length === 2 && nothing.options.every((o) => o.count === null));

// ── 2. MUTATION PROOF — the pre-fix builder, rebuilt inline, must FAIL these same assertions ─────
const mutantOld = (ks: readonly string[], counts: Record<string, number | null> | null) => ks
  .filter((k) => (counts?.[k] ?? 0) > 0)                       // the 2026-09-04 defect, verbatim
  .map((k) => ({ key: k, label: label(k), count: counts![k] as number }));
const mutantOffered = mutantOld(keys, { [SCOPE_TOTAL_KEY]: 21892, Room: 1, 'Residential Building': 1554, Studio: null }).map((o) => o.key);
check('MUTATION PROOF: the old `(count ?? 0) > 0` filter DROPS Apartment/Floor/Studio — these checks would catch it',
  !mutantOffered.includes('Apartment') && !mutantOffered.includes('Floor') && !mutantOffered.includes('Studio'));
const mutantZero = (ks: readonly string[], counts: Record<string, number | null> | null) => ks
  .filter((k) => counts?.[k] !== 0).map((k) => ({ key: k, label: label(k), count: counts?.[k] ?? 0 }));
check('MUTATION PROOF: an unknown rendered as 0 (`?? 0`) is rejected — UNKNOWN is not zero',
  mutantZero(keys, { Room: 1 }).some((o) => o.count === 0));

// ── 3. The advanced pool never SCORES an unknown as a fact (type-level guard, executed) ───────────
const unknownOpt: AdvancedOption[] = [{ key: 'x', label: 'x', count: null }, { key: 'y', label: 'y', count: 40 }];
check('meaningful() never admits an unknown count (only a measured count can clear the ≥5 floor)',
  meaningful(unknownOpt).map((o) => o.key).join() === 'y');
check('offersMeaningfulNarrowing() skips an unknown option instead of scoring it (and does not throw)',
  offersMeaningfulNarrowing(100, [{ key: 'x', label: 'x', count: null }]) === false
  && offersMeaningfulNarrowing(100, unknownOpt) === true);

// ── 4. The feeder: fetchScopeOptionCounts retries once and returns null, never omits ─────────────
const remote = stripComments(read('src/data/remote.ts'));
const fnFrom = remote.indexOf('export async function fetchScopeOptionCounts(');
const fnTo = remote.indexOf('export async function fetchDistrictEligibleCounts(');
const feeder = fnFrom >= 0 && fnTo > fnFrom ? remote.slice(fnFrom, fnTo) : '';
check('fetchScopeOptionCounts exists and is typed Record<string, number | null> (UNKNOWN is representable)',
  feeder.includes('Promise<Record<string, number | null> | null>'),
  'src/data/remote.ts — a number-only map cannot say "unknown", so it must drop or lie');
check('a timeout is the repo\'s PROBE_FAILED sentinel inside the feeder — the bare `return;` drop is gone, and it is never `null` (null = "the source answered" everywhere else)',
  /if \('timedOut' in result\) return PROBE_FAILED;/.test(feeder) && !/if \('timedOut' in result\) return;/.test(feeder) && !/if \('timedOut' in result\) return null;/.test(feeder));
check('an RPC error is PROBE_FAILED too, never a silent omission',
  /if \(error\) return PROBE_FAILED;/.test(feeder) && !/if \(error\) return;/.test(feeder));
check('every candidate is written to the raw map (raw[c.key] = await probe(c)) — no key can be absent',
  /raw\[c\.key\] = await probe\(c\)/.test(feeder));
check('failed candidates are retried exactly ONCE (bounded — never a poll)',
  /const failed = candidates\.filter\(\(c\) => isProbeFailure\(raw\[c\.key\]\)\);/.test(feeder)
  && (feeder.match(/await Promise\.all\(/g) ?? []).length === 2);
check('at the boundary a still-failed probe becomes null for the pure builder (UNKNOWN), a measured count passes through',
  /out\[c\.key\] = isProbeFailure\(raw\[c\.key\]\) \? null : \(raw\[c\.key\] as number\);/.test(feeder));

// ── 5. The consumer: scopeQuestionOptions uses the REAL pure builder, not a private copy ─────────
const adv = stripComments(read('src/data/advancedFilters.ts'));
check('scopeQuestionOptions() returns scopeOptionsFromCounts(keys, counts, …) — the executed function above',
  /return scopeOptionsFromCounts\(keys, counts, \(key\) => t\(key\)\);/.test(adv));
check('advancedFilters.ts carries NO second implementation of the drop rule (no `(counts?.[key] ?? 0) > 0`)',
  !/\(counts\?\.\[key\] \?\? 0\) > 0/.test(adv));

// ── 6. The renderer: an unknown count shows NO number (and the row stays) ────────────────────────
const card = stripComments(read('src/components/AdvancedQuestionCard.tsx'));
check('AdvancedQuestionCard renders the count pill only when option.count != null — an unknown shows nothing, not 0',
  /\{option\.count != null \? \(\s*<View style=\{s\.countPill\}>/.test(card));
check('…and the option row itself is not gated on the count (the label renders unconditionally)',
  /<Text style=\{\[s\.label, selected && s\.labelOn\]\} numberOfLines=\{1\}>\{option\.label\}<\/Text>/.test(card));

// ── 7. Wired into npm test ───────────────────────────────────────────────────────────────────────
check('this barrier is discovered and run by npm test (scripts/verify-*.ts auto-discovery; not excluded)',
  !read('scripts/test-exclusions.txt').includes('verify-af-unknown-is-not-no-scope-options'));

console.log(failed
  ? `\n✗ ${failed} check(s) FAILED — a slow count can again make a real Advanced Filter option disappear`
  : '\n✓ UNKNOWN IS NOT NO for scope options: absent/errored counts keep the option (no number), a measured 0 still drops it, the feeder retries once and never omits, the card never prints 0 for unknown');
process.exit(failed ? 1 : 0);
