// A KILL THE SWEEP HELD BACK IS THE SWEEP'S OWN "UNKNOWN", NOT A CONFIRMED DEATH.
//
// THE DEFECT THIS PINS (2026-11-09, alert_event 13977/13978). `mon_detect_served_despite_direct_404()`
// read dealapp_liveness_detail.verdict = 'kill' as "a TRUSTED direct probe confirmed it gone", and
// scrape_runs.ok = true as the trust anchor. dealapp's sweep writes its ledger AFTER its trust gate
// on purpose (scrapers/dealapp/liveness_run.py): on a QUARANTINED run — verified-rate or canary
// failed, «no deactivation written» — every kill lands with applied=false, meaning "the verdict
// was reached and deliberately not applied", and the run still ends ok=true because it ran to
// completion. So 26 rows the sweep had itself refused to kill (shard 3/4, 05:43 UTC: alive=54,
// unknown=514) were reported as confirmed-dead-but-served. LISTING_LIVENESS.md: UNKNOWN never
// deactivates — and a detector must not promote the same UNKNOWN to a verdict either.
//
// THE RULE. In the dealapp arms, ledger_dead is `(d.verdict = 'kill' and d.applied is true)`. An
// applied kill that is active again with no later re-sighting still raises exactly as before: that
// is the real chain failure this detector exists for. Judged on the LATEST committed definition,
// code only (a header quoting the old predicate must not read as the defect), and the check is
// proven by mutation: strip the gate from either limb and it goes RED; a later migration that
// redefines the function without the gate goes RED.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const FN = 'mon_detect_served_despite_direct_404';

/** SQL with `--` comments removed, so prose can never be read as code. */
const codeOnly = (sql: string) => sql.replace(/^\s*--.*$/gm, '').replace(/\s--.*$/gm, '');

function definitions(files: Record<string, string>): string[] {
  return Object.keys(files)
    .filter((f) => new RegExp(`function\\s+public\\.${FN}\\s*\\(`).test(files[f]))
    .sort();
}

/** One problem per broken guarantee, judged on the LAST committed definition. */
export function unappliedKillProblems(files: Record<string, string>): string[] {
  const defs = definitions(files);
  if (defs.length === 0) return [`no committed migration defines public.${FN}()`];
  const latest = defs[defs.length - 1];
  const sql = codeOnly(files[latest]);
  const bad: string[] = [];

  // Each dealapp limb is the SELECT that reads dealapp_liveness_detail for one source table. Take
  // the text from the table name up to the next `from`, and require the gate inside it.
  const limbs = [...sql.matchAll(/'dealapp_(residential|commercial)_listings'::text[\s\S]*?from public\.dealapp_liveness_detail/g)];
  if (limbs.length !== 2) {
    bad.push(`${latest}: expected 2 dealapp limbs reading dealapp_liveness_detail, found ${limbs.length}`);
  }
  for (const m of limbs) {
    const gated = /\(\s*d\.verdict\s*=\s*'kill'\s+and\s+d\.applied\s+is\s+true\s*\)/.test(m[0]);
    if (!gated) {
      bad.push(`${latest}: the dealapp_${m[1]} limb counts verdict='kill' without requiring `
        + `d.applied is true — an unapplied (quarantined / held-alive / dry-run) kill would read as `
        + 'a confirmed death');
    }
  }
  // The gate must not have leaked into the aqar limbs' vocabulary (aqar's ledger has no `applied`
  // column; a copy-paste there would make the aqar arms fail at runtime and read as dark).
  const aqarLimbs = [...sql.matchAll(/'aqar_(residential|commercial)_listings'::text[\s\S]*?from public\.aqar_liveness_detail/g)];
  for (const m of aqarLimbs) {
    if (/d\.applied/.test(m[0])) bad.push(`${latest}: the aqar_${m[1]} limb references d.applied, a column aqar_liveness_detail does not have`);
  }
  return bad;
}

function load(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(MIGRATIONS)) {
    if (!f.endsWith('.sql')) continue;
    out[f] = readFileSync(join(MIGRATIONS, f), 'utf8');
  }
  return out;
}

const files = load();
const real = unappliedKillProblems(files);
let failures = 0;
const fail = (m: string) => { failures++; console.log(`  ❌ ${m}`); };
const ok = (m: string) => console.log(`  ✓ ${m}`);

console.log('verify-served-despite-404-unapplied-kill-is-not-a-confirmation');
if (real.length) for (const p of real) fail(p);
else ok('the latest committed definition gates both dealapp limbs on d.applied is true');

// ── Mutation proofs: the check must go RED on the defect it exists for ────────────────────────
const latest = definitions(files).slice(-1)[0];
const mustCatch = (what: string, mutate: (s: string) => string) => {
  const mutated = mutate(files[latest]);
  if (mutated === files[latest]) { fail(`MUTATION ${what}: the mutation did not change the file (stale test)`); return; }
  const caught = unappliedKillProblems({ ...files, [latest]: mutated }).length > real.length;
  if (caught) ok(`MUTATION ${what} — caught`); else fail(`MUTATION ${what} — NOT caught`);
};
mustCatch('strip the gate from the residential limb',
  (s) => s.replace(/('dealapp_residential_listings'::text[\s\S]*?)\(d\.verdict = 'kill' and d\.applied is true\)/,
    "$1(d.verdict = 'kill')"));
mustCatch('strip the gate from the commercial limb',
  (s) => s.replace(/('dealapp_commercial_listings'::text[\s\S]*?)\(d\.verdict = 'kill' and d\.applied is true\)/,
    "$1(d.verdict = 'kill')"));
mustCatch('drop the whole commercial limb',
  (s) => s.replace(/\), dc as \([\s\S]*?from public\.dealapp_liveness_detail d[\s\S]*?where d\.source_table = 'dealapp_commercial_listings'\s*\)/, ')'));
{
  const later = '29991231000000_a_later_migration_redefines_the_detector.sql';
  const blind = `create or replace function public.${FN}() returns integer language plpgsql as $$\n`
    + "select 'dealapp_residential_listings'::text src, (d.verdict = 'kill') from public.dealapp_liveness_detail d; "
    + "select 'dealapp_commercial_listings'::text src, (d.verdict = 'kill') from public.dealapp_liveness_detail d; $$;";
  const caught = unappliedKillProblems({ ...files, [later]: blind }).length > real.length;
  if (caught) ok('MUTATION a later migration redefines the detector without the gate — caught');
  else fail('MUTATION a later migration redefines the detector without the gate — NOT caught');
}
{
  const caught = unappliedKillProblems({}).length > 0;
  if (caught) ok('no committed definition at all fails CLOSED'); else fail('no committed definition read as fine');
}
{
  // Comments are not code: a header that quotes the ungated predicate must not flip the verdict.
  const withProse = files[latest] + "\n-- old: (d.verdict = 'kill') in the dealapp_residential_listings limb\n";
  const still = unappliedKillProblems({ ...files, [latest]: withProse }).length;
  if (still === real.length) ok('prose quoting the old predicate is ignored'); else fail('prose quoting the old predicate changed the verdict');
}

if (failures) {
  console.log(`\n❌ verify-served-despite-404-unapplied-kill-is-not-a-confirmation: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\n✓ verify-served-despite-404-unapplied-kill-is-not-a-confirmation: an unapplied kill is never a confirmation.');
