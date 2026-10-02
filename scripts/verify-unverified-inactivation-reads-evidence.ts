// THE STRIKE COUNTER IS NOT EVIDENCE — pinned on the function that grades every hide.
//
// THE DEFECT THIS PINS. `mon_unverified_inactivation_counts()` (read by the view
// `mon_unverified_inactivations_24h`, which the Lifecycle Engineer's rulebook says must read 0)
// called a deactivation UNVERIFIED only when `coalesce(missing_count,0) < 3`. So a statement that
// set `active = false` together with `missing_count = 3` was invisible to it, with or without a
// page reading behind it, and a hide that DID carry a page reading but left the counter under 3
// was raised as a P1. Measured on production 2026-10-02, read-only:
//   * 66 aqar_residential rows hidden at 01:07-01:10 UTC with missing_count = 3 and no kill row in
//     aqar_liveness_detail (a sweep shard died with its evidence buffer unflushed): counted 0;
//   * 653 gathern rows hidden 2026-09-28 with missing_count 1-2, each with a GONE row and an
//     applied kill row stamped at the hide: counted 653.
//
// THE RULE. A hide is verified by a ledger row for THAT listing, stamped inside a stated window
// around its deactivated_at — never by the counter. The one place the counter may still be read is
// a platform whose registered strategy is absence-based (SOURCE_LIST_PRESENCE, CRAWL_PRESENCE_ONLY):
// there three complete-crawl misses are the removal rule (docs/ops/LISTING_LIVENESS.md §4) and
// mon_detect_unknown_treated_as_dead() already grades those hides per table.
//
// OFFLINE and deterministic: it reads the newest committed migration that defines the function, so
// it runs on every PR. Production agreeing with that file is the migration-drift guards' job.
//
//   node --experimental-strip-types scripts/verify-unverified-inactivation-reads-evidence.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const FN = 'mon_unverified_inactivation_counts';
// The definition this barrier exists to retire. Kept as a file reference, not a pasted copy, so the
// first mutation proof below runs against the real pre-fix text.
const PRE_FIX = '20260906073746';

// A ledger NAMED in a comment is documentation; only executed text counts.
const codeOnly = (s: string) => s.replace(/--[^\n]*/g, '');

/** The text of the LAST definition of FN in one migration ('' when it defines none). */
function definitionOf(sql: string): string {
  const code = codeOnly(sql);
  let at = -1;
  for (const m of code.matchAll(new RegExp(`create or replace function public\\.${FN}\\b`, 'gi'))) at = m.index!;
  if (at < 0) return '';
  const rest = code.slice(at);
  const next = rest.slice(1).search(/\n(create (or replace )?(function|view)|do \$)/i);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

/** Every `exists (select 1 from public.<ledger> …)` clause, to its balanced closing parenthesis. */
function clausesOn(def: string, ledger: string): string[] {
  const out: string[] = [];
  for (const m of def.matchAll(new RegExp(`(not )?exists \\(select 1 from public\\.${ledger}\\b`, 'g'))) {
    let depth = 0;
    for (let i = def.indexOf('(', m.index!); i < def.length; i++) {
      if (def[i] === '(') depth++;
      else if (def[i] === ')' && --depth === 0) { out.push(def.slice(m.index!, i + 1)); break; }
    }
  }
  return out;
}

const LEDGERS: Array<[ledger: string, key: RegExp, verdict: RegExp, why: string]> = [
  ['ops_stale_inactivation_probe', /p\.listing_id = x\.id/, /p\.verdict = 'GONE'/,
    'fleet_liveness, wasalt and the bulk ledgers key their GONE row on listing_id'],
  ['ops_stale_inactivation_probe', /p\.ad_number = x\.ad_number/, /p\.verdict = 'GONE'/,
    'prune_unseen(verify_gone) and the sold pins write ad_number only'],
  ['aqar_liveness_detail', /a\.listing_id = x\.id/, /a\.verdict = 'kill' and a\.applied/,
    'aqar kills are recorded nowhere else'],
  ['gathern_liveness_detail', /g\.listing_id = x\.id/, /g\.verdict in \('kill', 'dead_confirmed'\) and g\.applied/,
    'gathern kills are recorded nowhere else'],
  ['dealapp_liveness_detail', /a\.listing_id = x\.id/, /a\.verdict = 'kill' and a\.applied/,
    'dealapp liveness kills are recorded nowhere else'],
];
const ABSENCE_GATE = /case when s\.absence_tier then '[^']*' else '' end/g;

// The window a ledger row must fall in, measured 2026-10-02 over 7 days of production hides: the
// latest writer after a hide was 2 min 02 s (gathern's kill flush); the oldest reading behind one
// was 3 d 08 h 57 min (dealapp's CI-crawl readings applied in bulk). It may TIGHTEN freely. Widening
// it is a reviewed edit here, with the measurement that forced it.
const WINDOW = /between x\.deactivated_at - interval '([^']+)'\s+and x\.deactivated_at \+ interval '([^']+)'/;
const MAX_BEFORE_MIN = 96 * 60;
const MAX_AFTER_MIN = 15;
const minutes = (lit: string): number => {
  const m = /^(\d+) (hours?|minutes?)$/.exec(lit.trim());
  return m ? Number(m[1]) * (m[2].startsWith('hour') ? 60 : 1) : Infinity;
};

/** Every way this definition lets something other than a ledger row verify a hide. */
function violations(def: string): string[] {
  const out: string[] = [];
  if (!def) return ['no definition found'];
  for (const [ledger, key, verdict, why] of LEDGERS) {
    const hit = clausesOn(def, ledger).some((c) => c.startsWith('not ') && key.test(c) && verdict.test(c));
    if (!hit) out.push(`no "not exists" on ${ledger} joined by ${key.source} — ${why}`);
  }
  for (const ledger of new Set(LEDGERS.map((l) => l[0]))) {
    for (const c of clausesOn(def, ledger)) {
      const w = WINDOW.exec(c);
      if (!w || minutes(w[1]) > MAX_BEFORE_MIN || minutes(w[2]) > MAX_AFTER_MIN) {
        out.push(`a ${ledger} lookup is not bounded to ${MAX_BEFORE_MIN / 60} h before and ` +
          `${MAX_AFTER_MIN} min after deactivated_at — an old row, or one written long after, would ` +
          'verify a hide it never described');
      }
    }
  }
  if (/missing_count/.test(def.replace(ABSENCE_GATE, ''))) {
    out.push('missing_count is read outside the absence-tier gate — the strike counter is proof again');
  }
  const tier = clausesOn(def, 'ops_liveness_registry').find((c) => def.includes(`${c} as absence_tier`)) ?? '';
  if (!/SOURCE_LIST_PRESENCE/.test(tier) || !/CRAWL_PRESENCE_ONLY/.test(tier)
      || /DIRECT_REVISIT|CANDIDATE_PLUS_DIRECT/.test(tier)) {
    out.push('absence_tier is not exactly the two absence strategies of ops_liveness_registry — a ' +
      'platform that owes a direct reading would be excused by its counter');
  }
  if (clausesOn(def, 'ops_adjudicated_listing').length === 0) {
    out.push('adjudicated rows are no longer excluded');
  }
  if (!/y\.listing_url = x\.listing_url and y\.active/.test(def)) {
    out.push('the active-twin split is gone — deduplicated_copy_flood loses its input');
  }
  if (!/returns table\(unverified bigint, deduplicated bigint\)/i.test(def)) {
    out.push('the (unverified, deduplicated) shape the view reads has changed');
  }
  return out;
}

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log('verify-unverified-inactivation-reads-evidence: a hide is verified by a ledger row, never by the strike counter.');

const defining = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  .filter((f) => definitionOf(readFileSync(join(MIGRATIONS, f), 'utf8')) !== '');
check(`a migration defines ${FN}`, defining.length > 0);
const newest = defining[defining.length - 1] ?? '';
const live = newest ? definitionOf(readFileSync(join(MIGRATIONS, newest), 'utf8')) : '';
const found = violations(live);
check(`the newest definition (${newest}) verifies a hide by its evidence`, found.length === 0, found.join(' | '));

// ── MUTATION PROOFS ────────────────────────────────────────────────────────────────────────────
// 1. The real pre-fix text, read from its own migration, must be rejected FOR THE SHORTCUT.
const preFixFile = readdirSync(MIGRATIONS).find((f) => f.startsWith(PRE_FIX));
const preFix = preFixFile ? definitionOf(readFileSync(join(MIGRATIONS, preFixFile), 'utf8')) : '';
const mustCatch = (what: string, caught: boolean) => check(`mutant caught: ${what}`, caught);
mustCatch('the 2026-09-06 definition, where missing_count >= 3 alone verifies a hide',
  preFix !== '' && violations(preFix).some((v) => v.includes('strike counter')));

// 2. A compliant definition, broken one way at a time. FIXTURE spells each clause the way the
// migration does, so the same mutations are replayed on the real definition whenever it is clean:
// a proof that only ever ran on a fixture proves the predicate, not its coverage of the real text.
const window = (a: string, col: string) =>
  `and ${a}.${col} between x.deactivated_at - interval '96 hours' and x.deactivated_at + interval '15 minutes')`;
const FIXTURE = `create or replace function public.${FN}(p_since interval)
 returns table(unverified bigint, deduplicated bigint) as $function$
  select exists (select 1 from public.ops_liveness_registry g where g.platform = t.platform
                   and g.strategy in ('SOURCE_LIST_PRESENCE', 'CRAWL_PRESENCE_ONLY')) as absence_tier
  select exists (select 1 from public.%I y where y.listing_url = x.listing_url and y.active) as twin
   where x.active = false
     and not exists (select 1 from public.ops_adjudicated_listing j where j.tbl = %1$L and j.listing_id = x.id)
     and not exists (select 1 from public.ops_stale_inactivation_probe p
                      where p.source_table = %1$L and p.listing_id = x.id and p.verdict = 'GONE' ${window('p', 'probed_at')}
     and not exists (select 1 from public.ops_stale_inactivation_probe p
                      where p.source_table = %1$L and p.ad_number = x.ad_number and p.verdict = 'GONE' ${window('p', 'probed_at')}
     and not exists (select 1 from public.aqar_liveness_detail a
                      where a.source_table = %1$L and a.listing_id = x.id
                        and a.verdict = 'kill' and a.applied ${window('a', 'run_at')}
     and not exists (select 1 from public.dealapp_liveness_detail a
                      where a.source_table = %1$L and a.listing_id = x.id
                        and a.verdict = 'kill' and a.applied ${window('a', 'run_at')}
     and not exists (select 1 from public.gathern_liveness_detail g
                      where g.listing_id = x.id and g.verdict in ('kill', 'dead_confirmed') and g.applied ${window('g', 'run_at')}
  case when s.absence_tier then 'and coalesce(x.missing_count,0) < 3' else '' end
$function$;`;
check('the fixture itself is compliant (the predicate is satisfiable)', violations(FIXTURE).length === 0,
  violations(FIXTURE).join(' | '));

const mutants: Array<[what: string, mutate: (s: string) => string]> = [
  ['the absence-tier gate removed, so the counter excuses every platform again',
    (s) => s.replace(ABSENCE_GATE, "'and coalesce(x.missing_count,0) < 3'")],
  ['a DIRECT strategy added to the absence tier',
    (s) => s.replace("('SOURCE_LIST_PRESENCE', 'CRAWL_PRESENCE_ONLY')",
      "('SOURCE_LIST_PRESENCE', 'CRAWL_PRESENCE_ONLY', 'DIRECT_REVISIT')")],
  ['the aqar kill ledger dropped',
    (s) => s.replace(/and not exists \(select 1 from public\.aqar_liveness_detail a/, 'and (select true')],
  ['the gathern kill ledger dropped',
    (s) => s.replace(/and not exists \(select 1 from public\.gathern_liveness_detail g/, 'and (select true')],
  ['the probe ledger joined on listing_id only, losing every prune_unseen and sold-pin verdict',
    (s) => s.replace("p.ad_number = x.ad_number and p.verdict = 'GONE'", "p.listing_id = x.id and p.verdict = 'GONE'")],
  ['an UNKNOWN verdict accepted as evidence',
    (s) => s.replaceAll("p.verdict = 'GONE'", "p.verdict <> 'LIVE'")],
  ['an unapplied (dry-run or quarantined) kill accepted as evidence',
    (s) => s.replaceAll("a.verdict = 'kill' and a.applied", "a.verdict = 'kill'")],
  ['the upper bound removed, so a row written days after the hide verifies it',
    (s) => s.replaceAll(new RegExp(WINDOW, 'g'), ">= x.deactivated_at - interval '$1'")],
  ['the lower bound removed, so a months-old row verifies a fresh hide',
    (s) => s.replaceAll(new RegExp(WINDOW, 'g'), "<= x.deactivated_at + interval '$2'")],
  ['the window widened to a year, which bounds nothing',
    (s) => s.replaceAll(new RegExp(WINDOW, 'g'),
      "between x.deactivated_at - interval '365 days' and x.deactivated_at + interval '$2'")],
  ['the after-the-hide tolerance widened to a day, so a later probe launders an unverified hide',
    (s) => s.replaceAll(new RegExp(WINDOW, 'g'),
      "between x.deactivated_at - interval '$1' and x.deactivated_at + interval '24 hours'")],
  ['the adjudication exclusion dropped',
    (s) => s.replace(/not exists \(select 1 from public\.ops_adjudicated_listing j/, 'not (select false')],
  ['the active-twin split dropped',
    (s) => s.replace('y.listing_url = x.listing_url and y.active', 'false')],
];
const liveIsClean = found.length === 0;
for (const [what, mutate] of mutants) {
  const onFixture = mutate(FIXTURE);
  let caught = onFixture !== FIXTURE && violations(onFixture).length > 0;
  if (liveIsClean) {
    const onLive = mutate(live);
    caught = caught && onLive !== live && violations(onLive).length > 0;
  }
  mustCatch(what + (liveIsClean ? ' (fixture and real definition)' : ' (fixture)'), caught);
}

check('this barrier is discovered and run by npm test',
  npmTestRuns(ROOT, 'verify-unverified-inactivation-reads-evidence'));

console.log(
  failures === 0
    ? '\n✅ verify-unverified-inactivation-reads-evidence: all checks passed.'
    : `\n❌ verify-unverified-inactivation-reads-evidence: ${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
