// AN ADJUDICATED RETRACTION IS NOT A PRUNE KILL — AND AN ABSENCE KILL MUST STILL RAISE.
//
// THE DEFECT THIS PINS (2026-11-10, alert_event 13864 + 13865). `mon_detect_prune_kill_without_
// source_verdict()` raised two P1s on four aqarcity rows prune_unseen never touched: a lifecycle
// retraction had read each ad's own page GONE and written an ops_adjudicated_retraction row in the
// same transaction. The detector reads only ops_stale_inactivation_probe, so a recorded decision
// looked like an absence kill, and its remedy told the reader to restore rows another detector
// exists to keep hidden.
//
// THE RULE (migration 20261110034335). A deactivation is set aside only by an AFFIRMATIVE record:
// ops_adjudicated_retraction naming this table and this id within one hour of the deactivation.
// This file pins the dangerous direction — the exclusion may not widen into "any adjudication,
// ever", may not lose its table or id key, the GONE requirement may not go, and the set-aside
// count must stay visible. Judged on the LATEST committed definition, code only, by mutation.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const DETECTOR = 'mon_detect_prune_kill_without_source_verdict';
const MAX_WINDOW_HOURS = 1;

const codeOnly = (sql: string) => sql.replace(/^\s*--.*$/gm, '').replace(/\s--.*$/gm, '');

function latestBody(files: Record<string, string>): { file: string; body: string } | null {
  const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${DETECTOR}\\s*\\(`);
  const defs = Object.keys(files).filter((f) => re.test(codeOnly(files[f]))).sort();
  if (defs.length === 0) return null;
  const file = defs[defs.length - 1];
  const sql = codeOnly(files[file]);
  const start = sql.search(re);
  // the dollar tag is READ, never assumed: no tag or no matching close means no body (fail closed)
  const tag = sql.slice(start).match(/\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
  if (!tag || tag.index === undefined) return null;
  const open = start + tag.index + tag[0].length;
  const close = sql.indexOf(tag[0], open);
  if (close < 0) return null;
  return { file, body: sql.slice(open, close).replace(/\s+/g, ' ') };
}

const hoursOf = (n: string, unit: string) => Number(n) * (/^day/.test(unit) ? 24 : /^min/.test(unit) ? 1 / 60 : 1);

export function problems(files: Record<string, string>): string[] {
  const bad: string[] = [];
  const det = latestBody(files);
  if (!det) return [`no committed migration defines public.${DETECTOR}()`];
  const d = det.body;
  const f = det.file;

  // the source verdict is still required, with its own time anchor
  if (!/p\.verdict = 'GONE' and p\.probed_at >= t\.deactivated_at - interval '1 hour'\) as has_gone/.test(d)) {
    bad.push(`${f}: a deactivation must still need a GONE verdict recorded at/after it (has_gone)`);
  }
  if (!/count\(\*\) filter \(where not x\.has_gone and not x\.is_adjudicated\)/.test(d)) {
    bad.push(`${f}: the raising count must be "no GONE verdict AND not adjudicated" — nothing else may subtract from it`);
  }
  if (!/if bad > 0 then/.test(d)) bad.push(`${f}: one unverified deactivation must be enough to raise`);

  // the exclusion: affirmative, keyed, and bounded on both sides
  const adj = d.match(/exists \( select 1 from public\.ops_adjudicated_retraction a where (.*?)\) as is_adjudicated/);
  if (!adj) {
    if (/is_adjudicated/.test(d)) bad.push(`${f}: is_adjudicated is not read from ops_adjudicated_retraction`);
    // no exclusion at all is the stricter v1 shape: not a defect
  } else {
    const w = adj[1];
    if (!/a\.source_table = %1\$L/.test(w)) bad.push(`${f}: the adjudication must name THIS table`);
    if (!/a\.listing_id = t\.id/.test(w)) bad.push(`${f}: the adjudication must name THIS listing id`);
    const lo = w.match(/a\.retracted_at >= t\.deactivated_at - interval '(\d+(?:\.\d+)?) (hours?|days?|minutes?)'/);
    const hi = w.match(/a\.retracted_at <= t\.deactivated_at \+ interval '(\d+(?:\.\d+)?) (hours?|days?|minutes?)'/);
    if (!lo || hoursOf(lo[1], lo[2]) > MAX_WINDOW_HOURS) {
      bad.push(`${f}: the adjudication must be recorded no more than ${MAX_WINDOW_HOURS}h BEFORE the deactivation (an old record must not excuse a new kill)`);
    }
    if (!hi || hoursOf(hi[1], hi[2]) > MAX_WINDOW_HOURS) {
      bad.push(`${f}: the adjudication must be recorded no more than ${MAX_WINDOW_HOURS}h AFTER the deactivation (a late record must not excuse an old kill)`);
    }
    if (/\bor\b/.test(w)) bad.push(`${f}: the adjudication test carries an OR — every key must hold together`);
    if (!/'adjudicated_retraction', adj/.test(d)) {
      bad.push(`${f}: the rows set aside must be reported in the alert detail (adjudicated_retraction)`);
    }
    if (!/'deactivated_48h', tot/.test(d) || !/count\(\*\) from \( select/.test(d)) {
      bad.push(`${f}: deactivated_48h must still count every deactivation`);
    }
  }
  return bad;
}

const files: Record<string, string> = {};
for (const name of readdirSync(MIGRATIONS)) {
  if (name.endsWith('.sql')) files[name] = readFileSync(join(MIGRATIONS, name), 'utf8');
}

const real = problems(files);
let failures = 0;
const fail = (m: string) => { failures++; console.log(`  ❌ ${m}`); };
const ok = (m: string) => console.log(`  ✓ ${m}`);

console.log('verify-prune-kill-detector-tells-adjudicated-from-absence');
if (real.length) for (const p of real) fail(p);
else ok('the latest committed detector sets aside only a keyed, time-bound adjudication');

const file = latestBody(files)?.file ?? '';
const mustCatch = (what: string, mutate: (s: string) => string) => {
  if (!file) { fail(`MUTATION ${what}: nothing to mutate`); return; }
  const mutated = mutate(files[file]);
  if (mutated === files[file]) { fail(`MUTATION ${what}: the mutation did not change the file (stale test)`); return; }
  if (problems({ ...files, [file]: mutated }).length > real.length) ok(`MUTATION ${what} — caught`);
  else fail(`MUTATION ${what} — NOT caught`);
};
mustCatch('any adjudication ever excuses a new kill (drop the lower bound)',
  (s) => s.replace("               and a.retracted_at >= t.deactivated_at - interval '1 hour'\n", ''));
mustCatch('a late adjudication excuses an old kill (drop the upper bound)',
  (s) => s.replace("               and a.retracted_at <= t.deactivated_at + interval '1 hour') as is_adjudicated", ') as is_adjudicated'));
mustCatch('widen the window to 30 days',
  (s) => s.replace("a.retracted_at >= t.deactivated_at - interval '1 hour'", "a.retracted_at >= t.deactivated_at - interval '30 days'"));
mustCatch('an adjudication of another listing excuses this one',
  (s) => s.replace(' and a.listing_id = t.id', ''));
mustCatch('an adjudication in another table excuses this one',
  (s) => s.replace('where a.source_table = %1$L and a.listing_id', 'where a.listing_id'));
mustCatch('the GONE verdict stops being required',
  (s) => s.replace("and p.verdict = 'GONE' and p.probed_at", 'and p.probed_at'));
mustCatch('the set-aside count is hidden',
  (s) => s.replace("          'adjudicated_retraction', adj,\n", ''));
mustCatch('the raising count subtracts something else',
  (s) => s.replace('count(*) filter (where not x.has_gone and not x.is_adjudicated)', 'count(*) filter (where not x.has_gone and not x.is_adjudicated and false)'));
mustCatch('one unverified kill is no longer enough',
  (s) => s.replace('if bad > 0 then', 'if bad > 5 then'));
{
  if (problems({}).length > 0) ok('no committed definition at all fails CLOSED');
  else fail('no committed definition read as fine');
}

if (failures) {
  console.log(`\n❌ verify-prune-kill-detector-tells-adjudicated-from-absence: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\n✓ verify-prune-kill-detector-tells-adjudicated-from-absence: adjudicated rows are set aside; absence kills still raise.');
