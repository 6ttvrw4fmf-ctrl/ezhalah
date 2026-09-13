// THE GUARD AGAINST UNDOING A RETIREMENT MUST SEE BOTH SIDES OF THE LEDGER IT READS.
//
// `ops_adjudicated_listing` is what two things consult before putting a retired listing back:
//
//   auto_recover_false_inactive()              "an adjudicated row … must never be auto-reactivated"
//   mon_detect_lifecycle_duplicate_stale_copy() "pairs whose inactive copy is recorded in
//                                               ops_adjudicated_listing are NOT counted here:
//                                               those are decisions, not disagreements"
//
// WHAT WENT WRONG (2026-09-13). Its res/com-collision limb read the RESIDENTIAL side only —
// `a.res_id … where a.res_active_after is false` — which was complete when it was written, because
// the 2026-08-30 repair retired residential every time. The ledger has since gained `retired_side`
// and `com_active_*`, and a repair that morning retired the COMMERCIAL side for six of seven rows.
// Measured: for all six (`amaall_commercial_listings` 10729213-10729218) the guard returned FALSE.
// The decision was recorded and the guard could not see it.
//
// That is the SAME half-migration migration 20260913074036 had repaired hours earlier in
// `mon_detect_res_com_collision_repair_regression()`, whose own header says it "only ever looked at
// the RESIDENTIAL side … because the 2026-08-30 repair retired residential every time." The ledger
// was widened; its readers were updated one at a time. This barrier exists so the NEXT reader — and
// any future rewrite of this one — cannot quietly go back to half.
//
// WHY IT MATTERED, IN BOTH TENSES:
//   · live: the duplicate-stale-copy detector could never clear a commercial-side repair, so a P2
//     described a recorded decision as an unresolved disagreement, permanently.
//   · latent: auto_recover_false_inactive()'s OTHER guard (the 2026-09-02 sibling-supersession
//     clause) happened to cover the same six rows, but it is deliberately self-healing — "when the
//     sibling goes inactive the clause stops binding on its own". At that moment the adjudication
//     guard is the only one left, and mon_detect_adjudicated_reactivation(), which exists to prove
//     that clause holds, is blind in exactly the same way. The failure would have been silent.
//
// PROVEN IN PRODUCTION, BOTH DIRECTIONS (2026-09-13):
//   before  ops_adjudicated_listing 14 rows, 0 commercial; the six amaall rows unguarded
//   after   20 rows, 6 commercial, all six guarded — and mon_detect_lifecycle_duplicate_stale_copy()
//           RESOLVED alert_event 2721 (amaall, 6 pairs) at 15:02:30 while the seven genuine
//           disagreements (aqaratikom, arkaan, dealapp, eaqartabuk, mustqr, sadin, sanadak) stayed
//           OPEN. Quieter only where a decision exists.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const VIEW = 'ops_adjudicated_listing';

function definitions(files: Record<string, string>): string[] {
  return Object.keys(files)
    .filter((f) => new RegExp(`create\\s+(or\\s+replace\\s+)?view\\s+public\\.${VIEW}\\b`, 'i').test(files[f]))
    .sort();
}

/** One problem per broken guarantee, judged on the LAST committed definition — what production runs. */
export function bothSidesProblems(files: Record<string, string>): string[] {
  const defs = definitions(files);
  // Fails CLOSED: "the view is not in the repo" must never read as "the view is fine".
  if (defs.length === 0) return [`no committed migration defines public.${VIEW}`];

  const latest = defs[defs.length - 1];
  // Judge only the definition, not the header that necessarily quotes the broken version.
  const sql = files[latest].replace(/^\s*--.*$/gm, '');
  const bad: string[] = [];
  const need = (label: string, re: RegExp) => { if (!re.test(sql)) bad.push(`${latest}: ${label}`); };

  need('the human/adjudicated-retraction ledger is no longer read', /ops_adjudicated_retraction/);
  need('the res/com collision ledger is no longer read', /ops_res_com_collision_adjudication/);

  // Each side must be keyed to ITS OWN table name, ITS OWN id, and ITS OWN retired-after flag.
  need('the RESIDENTIAL side is missing or mis-keyed (needs res_id + res_active_after + _residential_listings)',
    /'_residential_listings'[\s\S]{0,200}?a\.res_id[\s\S]{0,400}?a\.res_active_after\s+is\s+false/);
  need('the COMMERCIAL side is missing or mis-keyed (needs com_id + com_active_after + _commercial_listings) '
     + '— a commercial-side retirement is then invisible to every guard that reads this view',
    /'_commercial_listings'[\s\S]{0,200}?a\.com_id[\s\S]{0,400}?a\.com_active_after\s+is\s+false/);

  // A side keyed on the OTHER side's id guards the wrong row — worse than not guarding, because it
  // reads as covered.
  if (/'_commercial_listings'[\s\S]{0,200}?a\.res_id/.test(sql))
    bad.push(`${latest}: the commercial limb is keyed on res_id — it guards the wrong row`);
  if (/'_residential_listings'[\s\S]{0,200}?a\.com_id/.test(sql))
    bad.push(`${latest}: the residential limb is keyed on com_id — it guards the wrong row`);

  return bad;
}

function load(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(MIGRATIONS)) {
    if (!f.endsWith('.sql')) continue;
    const body = readFileSync(join(MIGRATIONS, f), 'utf8');
    if (body.includes(VIEW)) out[f] = body;
  }
  return out;
}

const files = load();
const real = bothSidesProblems(files);

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  ❌ ${m}`); };

console.log(`verify-adjudication-guard-sees-both-sides: ${Object.keys(files).length} migration(s) mention ${VIEW}`);
if (real.length) { for (const p of real) fail(p); }
else console.log('  ✓ the adjudication guard reads both ledgers and both sides of the collision ledger');

const latest = definitions(files).slice(-1)[0];
const mustCatch = (what: string, mutate: (s: string) => string) => {
  const mutated = mutate(files[latest]);
  if (mutated === files[latest]) { fail(`MUTATION NOT APPLIED (${what})`); return; }
  const caught = bothSidesProblems({ ...files, [latest]: mutated }).length > real.length;
  if (caught) console.log(`  ✓ mutation caught: ${what}`);
  else fail(`MUTATION SURVIVED: ${what}`);
};

mustCatch('the commercial limb removed entirely (the pre-fix view)',
  (s) => s.replace(/union\n select a\.platform \|\| '_commercial_listings'[\s\S]*?com_active_after is false;/, ';'));
mustCatch('the commercial limb keyed on res_id, guarding the wrong row',
  (s) => s.replace(/a\.com_id as listing_id/, 'a.res_id as listing_id'));
mustCatch('the commercial limb filtered on the residential flag',
  (s) => s.replace(/a\.com_active_after is false/, 'a.res_active_after is false'));
mustCatch('the residential limb removed',
  (s) => s.replace(/union\n select a\.platform \|\| '_residential_listings'[\s\S]*?res_active_after is false\n/, '\n'));
mustCatch('the residential limb keyed on com_id',
  (s) => s.replace(/a\.res_id as listing_id/, 'a.com_id as listing_id'));
mustCatch('the collision ledger dropped altogether',
  (s) => s.replace(/ops_res_com_collision_adjudication/g, 'ops_some_other_ledger'));
mustCatch('the human retraction ledger dropped',
  (s) => s.replace(/ops_adjudicated_retraction/g, 'ops_nothing'));

// The bypass: a LATER migration redefining the view back to half. Judging any definition but the
// last one would read that as clean.
{
  const later = '29991231000000_a_later_migration_redefines_the_view.sql';
  const half = `create or replace view public.${VIEW} as select r.source_table as tbl, r.listing_id,`
    + ` 'adjudicated_retraction'::text as ledger, r.retracted_at as adjudicated_at`
    + ` from public.ops_adjudicated_retraction r;`;
  const caught = bothSidesProblems({ ...files, [later]: half }).length > real.length;
  if (caught) console.log('  ✓ mutation caught: a later create-or-replace dropping a side');
  else fail('MUTATION SURVIVED: a later create-or-replace dropping a side');
}
{
  const caught = bothSidesProblems({}).length > 0;
  if (caught) console.log('  ✓ mutation caught: an empty corpus fails closed');
  else fail('MUTATION SURVIVED: an empty corpus read as clean');
}

// NEGATIVE CONTROL — the header necessarily QUOTES the broken half-view it describes. A check that
// read prose would take the explanation for the defect (AGENTS.md's recurring lesson), and a check
// that flips on a comment edit is not a check.
{
  const still = bothSidesProblems({ ...files, [latest]: files[latest].replace(/^-- /gm, '--   ') }).length;
  if (still === real.length) console.log('  ✓ negative control: a comment-only edit stays green');
  else fail(`NEGATIVE CONTROL FAILED: reformatting comments changed the verdict (${real.length} → ${still})`);
}

if (failures) {
  console.log(`\n❌ verify-adjudication-guard-sees-both-sides: ${failures} failure(s).`);
  process.exit(1);
}
console.log('\n✅ verify-adjudication-guard-sees-both-sides: all checks passed.');
