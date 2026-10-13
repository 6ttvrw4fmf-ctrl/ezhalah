/**
 * silent_partial_success must judge a SLICED crawler by its day, and must still catch a collapse
 * (backlog 449, 2026-10-13, migration 20261013052453).
 *
 * The detector used to compare every run of a label with one per-run median, so every small slice
 * of wasalt / aqar / gathern raised a standing P1 while their daily totals were normal, and liveness
 * and cleanup labels (rows_seen = probes, not a captured catalogue) were judged as crawls. 17 of the
 * Scraping Engineer's 34 open alerts on 10-13 were that noise, which buries a real collapse.
 *
 * The behaviour is proven by EXECUTION in the migration's own check block (it raises, and the apply
 * fails, unless the synthetic wasalt-enum collapse and a once-a-day shortfall fire while uneven slices
 * and a liveness label stay quiet), and it is re-run twice an hour by mon_run_all_detectors(). This
 * hermetic half fails the PR if a later migration redefines the candidate function without that
 * check block, or drops the detector's use of it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(new URL('..', import.meta.url).pathname, 'supabase/migrations');
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const latest = (needle: string) => {
  const hits = files.filter((f) => readFileSync(join(MIGRATIONS, f), 'utf8').includes(needle));
  return hits.length ? readFileSync(join(MIGRATIONS, hits[hits.length - 1]), 'utf8') : '';
};

let failures = 0;
const check = (ok: boolean, name: string) => {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}`); }
};

const cand = latest('function public.mon_silent_partial_success_candidates(');
const det = latest('function public.mon_detect_silent_partial_success(');
check(cand !== '', 'a committed migration defines mon_silent_partial_success_candidates()');
check(/b\.median_runs\s*>=\s*3/.test(cand) && /sliced_day_total/.test(cand), 'sliced labels are judged by their 24h total');
check(/not like '%liveness%'/.test(cand) && /not like 'cleanup:%'/.test(cand), 'probe/candidate labels are not judged as captures');
check(/'__chk_enum'/.test(cand) && /'__chk_single'/.test(cand)
  && /hits is distinct from array\['__chk_enum', '__chk_single'\]/.test(cand),
  'the latest definition carries the both-directions check block (collapse + single-run shortfall must fire)');
check(/mon_silent_partial_success_candidates\(\)/.test(det), 'the detector reads its candidates from that function');

if (failures) { console.error(`\n✗ ${failures} check(s) failed`); process.exit(1); }
console.log('\nPASS — silent_partial_success judges slices by day and still catches a collapse.');
