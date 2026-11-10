// THE POSTING-DATE ALARM JUDGES LIVE ADS, KEEPS AN UNJUDGEABLE SITE'S ALERT, AND CAN FIRE ON A LOW BASELINE.
//
// public.mon_detect_source_posting_date_fill_regressed() raises when a site that publishes a posting date stops
// getting it stored on its NEW ads (docs/ARCHITECTURE.md §20). Three ways it went wrong on 2026-11-10, each caught
// in review (PR #11606) and fixed in migration 20261110090000:
//   1. it counted switched-off rows, which are never crawled again and can never gain a date — dwelleo (61 of 61
//      live ads dated) would have alarmed for weeks;
//   2. a site with too few live ads to judge was skipped AND its open alert closed — «unknown» read as «recovered»;
//   3. «fill below baseline − 20» can never fire on a low baseline (aljassim measured 9 % → threshold −11 %).
// The decision now lives in public.source_posting_date_fill_verdict(), executed against a truth table when its
// migration is applied. This check runs on every PR: it reads the LATEST committed definition of both functions
// and fails if a later change counts switched-off rows again, lets an unknown site's alert close, drops the
// low-baseline floor, or hides the kind from the stale-alert watcher. Every predicate is proven by a mutation.
//
// Hermetic: committed migration text only. Run: node --experimental-strip-types scripts/verify-posting-date-alarm-judges-live-ads.ts

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { windowBetween } from './lib/sourceWindow.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const MIG = join(ROOT, 'supabase/migrations');
const DETECTOR = 'create or replace function public.mon_detect_source_posting_date_fill_regressed()';
const VERDICT = 'create or replace function public.source_posting_date_fill_verdict(';
const PATCH = "pg_get_functiondef('public.mon_detect_source_posting_date_fill_regressed()";

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};
// A mutation proof: the predicate, applied to a deliberately broken definition, must report a problem.
const mutation = (label: string, problems: string[]) =>
  check(`MUTATION: catches ${label}`, problems.length > 0, 'the broken definition passed');

const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const text = (f: string) => readFileSync(join(MIG, f), 'utf8');
const lastDefining = (marker: string) => [...files].reverse().find((f) => text(f).includes(marker));

// ── the predicates ─────────────────────────────────────────────────────────────────────────────
export function detectorProblems(body: string): string[] {
  const p: string[] = [];
  if (!/where\s+active\s+and\s+scraped_at\s*>=/.test(body)) p.push('the count query does not filter to live ads (`where active and scraped_at`)');
  if (!/from\s+public\.source_posting_date_fill_verdict\s*\(/.test(body)) p.push('the decision is not taken by source_posting_date_fill_verdict()');
  if (!/if\s+v\.verdict\s*=\s*'unknown'\s+then\s+(?:--[^\n]*\n\s*)*live\s*:=\s*live\s*\|\|\s*\(k\s*\|\|\s*':'\s*\|\|\s*r\.platform\)\s*;\s*continue\s*;/.test(body))
    p.push('an unknown (too small to judge) site does not keep its key live, so its open alert would close');
  if (!/mon_resolve_stale_keys\s*\(\s*'source_posting_date_fill_regressed'/.test(body))
    p.push('the resolver does not name the kind as a literal, so mon_detect_unresolvable_alert_kinds() cannot see it');
  return p;
}

export function verdictProblems(body: string): string[] {
  const p: string[] = [];
  if (!/threshold_pct\s*:=\s*greatest\(\s*p_baseline\s*-\s*drop_pts\s*,\s*p_baseline\s*\/\s*2(?:\.0)?\s*\)/.test(body))
    p.push('the threshold is not greatest(baseline − 20, baseline ÷ 2): a low baseline could never fire');
  if (!/verdict\s*:=\s*'unknown'/.test(body)) p.push('no «unknown» verdict: a small sample would be judged');
  return p;
}

// ── 1. the latest committed definitions, and nothing patching them afterwards ─────────────────────
const detFile = lastDefining(DETECTOR);
const verFile = lastDefining(VERDICT);
check('a committed migration defines the alarm whole', !!detFile);
check('a committed migration defines source_posting_date_fill_verdict()', !!verFile);
if (!detFile || !verFile) process.exit(1);

const laterPatch = files.filter((f) => f > detFile && text(f).includes(PATCH));
check(`no migration after ${detFile} text-patches the alarm (this check reads whole definitions only)`,
  laterPatch.length === 0, `re-create it whole instead: ${laterPatch.join(', ')}`);

const det = windowBetween(text(detFile), DETECTOR, 'end $function$;', detFile);
const ver = windowBetween(text(verFile), VERDICT, 'end $function$;', verFile);

// ── 2. the properties ──────────────────────────────────────────────────────────────────────────
const dp = detectorProblems(det);
check('the alarm counts live ads, keeps an unknown site\'s alert, uses the verdict, names its kind', dp.length === 0, dp.join('; '));
const vp = verdictProblems(ver);
check('the verdict has a low-baseline floor and an unknown answer', vp.length === 0, vp.join('; '));
check(`the verdict's migration executes a truth table at apply (${verFile})`, /PROOF: verdict\(/.test(text(verFile)));

// ── 3. mutation proofs: each predicate catches the break it exists for ──────────────────────────
mutation('switched-off rows counted again', detectorProblems(det.replace(/where\s+active\s+and\s+scraped_at/, 'where scraped_at')));
mutation('an unknown site\'s alert closing',
  detectorProblems(det.replace(/(if\s+v\.verdict\s*=\s*'unknown'\s+then\s+(?:--[^\n]*\n\s*)*)live\s*:=\s*live\s*\|\|[^;]*;/, '$1')));
mutation('the decision taken outside the verdict function', detectorProblems(det.replace(/source_posting_date_fill_verdict/g, 'some_other_rule')));
mutation('the kind hidden in a variable again', detectorProblems(det.replace(/mon_resolve_stale_keys\(\s*'source_posting_date_fill_regressed'/, 'mon_resolve_stale_keys(k')));
mutation('the old «baseline − 20» rule', verdictProblems(ver.replace(/greatest\(\s*p_baseline\s*-\s*drop_pts\s*,\s*p_baseline\s*\/\s*2(?:\.0)?\s*\)/, 'p_baseline - drop_pts')));
mutation('no unknown verdict', verdictProblems(ver.replace(/verdict\s*:=\s*'unknown'/g, "verdict := 'ok'")));

// ── 4. the behavioural self-test exists, exercises switched-off rows, and runs from the roster ──────
// public.ops_posting_date_alarm_selftest() runs the REAL detector over controlled live and switched-off rows (always
// rolled back); mon_detect_posting_date_alarm_selftest() runs it daily and raises when a state comes out wrong.
const SELFTEST = 'create or replace function public.ops_posting_date_alarm_selftest()';
export function selftestProblems(body: string, rosterText: string): string[] {
  const p: string[] = [];
  if (!/select\s+false\s*,\s*now\(\)/.test(body)) p.push('no switched-off rows are planted, so counting them again would pass');
  if (!/select\s+true\s*,\s*now\(\)/.test(body)) p.push('no live rows are planted');
  if (!/perform\s+public\.mon_detect_source_posting_date_fill_regressed\(\)/.test(body)) p.push('the real detector is not run');
  for (const s of ['A', 'B', 'C', 'D']) if (!body.includes(`SELFTEST ${s}:`)) p.push(`state ${s} is not asserted`);
  if (!/'__pd_alarm_selftest_rollback__'/.test(body)) p.push('the test does not roll itself back');
  if (!/is\s+distinct\s+from\s+5/.test(body)) p.push('state C compares with <> (a missing value is NULL and passes unchecked)');
  if (!/''mon_detect_posting_date_alarm_selftest'',/.test(rosterText)) p.push('the daily wrapper is not put on the detector roster');
  return p;
}
const selFile = lastDefining(SELFTEST);
check('a committed migration defines the behavioural self-test', !!selFile);
if (selFile) {
  const sel = windowBetween(text(selFile), SELFTEST, 'end $function$;', selFile);
  // The roster entry is needle-inserted once, by whichever migration added the wrapper.
  const selText = files.map(text).filter((t) => /''mon_detect_posting_date_alarm_selftest'',/.test(t)).join('\n');
  const sp = selftestProblems(sel, selText);
  check('the self-test plants live and switched-off rows, runs the real detector, asserts A–D, rolls back, runs daily',
    sp.length === 0, sp.join('; '));
  mutation('a self-test without switched-off rows', selftestProblems(sel.replace(/select\s+false\s*,\s*now\(\)/, 'select true, now()'), selText));
  mutation('a self-test that skips state B', selftestProblems(sel.replace(/SELFTEST B:/g, 'SELFTEST b:'), selText));
  mutation('state C compared with <> again', selftestProblems(sel.replace(/is\s+distinct\s+from\s+5/, '<> 5'), selText));
  mutation('a self-test off the roster', selftestProblems(sel, selText.replace(/''mon_detect_posting_date_alarm_selftest'',/g, '')));
}

// The daily wrapper proves the self-test restored the policy table EXACTLY (a fingerprint before and after), never by
// a fixed count such as «at least 100 'yes' sites».
const WRAPPER = 'create or replace function public.mon_detect_posting_date_alarm_selftest()';
export function wrapperProblems(body: string): string[] {
  const p: string[] = [];
  const fp = (body.match(/into\s+v_(before|after)\s+from\s+public\.ops_source_posting_date_policy/g) ?? []).length;
  if (fp < 2) p.push('the policy table is not fingerprinted both before and after the self-test');
  if (!/if\s+v_after\s+is\s+distinct\s+from\s+v_before\s+then/.test(body)) p.push('the before/after fingerprints are not compared');
  if (!/mon_resolve_key\(\s*'posting_date_alarm_selftest'/.test(body)) p.push('a passing run does not clear the alert by its literal kind');
  return p;
}
const wrapFile = lastDefining(WRAPPER);
check('a committed migration defines the daily self-test wrapper', !!wrapFile);
if (wrapFile) {
  const wrap = windowBetween(text(wrapFile), WRAPPER, 'end $function$;', wrapFile);
  const wp = wrapperProblems(wrap);
  check('the wrapper compares the policy table before and after, and clears by its literal kind', wp.length === 0, wp.join('; '));
  mutation('a wrapper that does not compare before and after', wrapperProblems(wrap.replace(/if\s+v_after\s+is\s+distinct\s+from\s+v_before\s+then/, 'if false then')));
  mutation('a wrapper with no fingerprint after the run', wrapperProblems(wrap.replace(/into\s+v_after\s+from/, 'into v_ignored from')));
}

// ── 5. this file runs in `npm test` ─────────────────────────────────────────────────────────────
check('npm test runs this check', npmTestRuns(ROOT, 'verify-posting-date-alarm-judges-live-ads'));

console.log(failed === 0
  ? '\n✅ posting-date alarm: judges live ads, keeps an unjudgeable site\'s alert, and can fire on a low baseline.\n'
  : `\n❌ posting-date alarm: ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
