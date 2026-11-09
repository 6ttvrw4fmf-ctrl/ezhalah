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
 * check block, or drops the detector's use of it. The mutations at the bottom prove each check fails
 * on the broken shape it guards.
 *
 * ⚡ 2026-11-03 (alert 12814, migration 20261103051511): a once-a-day sliced batch (gathern, 12 city slices
 * 04:43-05:10 UTC) was split by the rolling now()-24h bucket when the sweep fired mid-batch (4,888 of ~16,000
 * → P1, 8 raises, each self-resolving). The sliced path now counts a label's day back from its OWN latest
 * run, and the check block carries gathern's exact shape (case __chk_batch), which must stay quiet.
 * Same night (alert 12600, migration 20261103052107): wasalt_enrich_ar_* labels count their PENDING queue,
 * not a capture, so they are left out like liveness/cleanup labels (case wasalt_enrich_ar___chk).
 * ⚡ 2026-11-09 (repeat_bug:silent_partial_success:wasalt_enum_shard, migration 20261109053644): the wasalt enum
 * batch's three ~30,000-row shards end 00:30-01:16 UTC, so the 22:59/23:59 sweeps judged half a day (68,604 of
 * ~166,700) four nights in seven. A label with a slice in flight (ok null, < 6 h) waits; case __chk_inflight.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(new URL('..', import.meta.url).pathname, 'supabase/migrations');
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const latest = (needle: string) => {
  const hits = files.filter((f) => readFileSync(join(MIGRATIONS, f), 'utf8').includes(needle));
  return hits.length ? readFileSync(join(MIGRATIONS, hits[hits.length - 1]), 'utf8') : '';
};

/** The failed checks for a (candidate function SQL, detector SQL) pair; [] = sound. */
function problems(cand: string, det: string): string[] {
  const out: string[] = [];
  if (cand === '') out.push('a committed migration defines mon_silent_partial_success_candidates()');
  if (!(/b\.median_runs\s*>=\s*3/.test(cand) && /sliced_day_total/.test(cand))) out.push('sliced labels are judged by their 24h total');
  if (!(/not like '%liveness%'/.test(cand) && /not like 'cleanup:%'/.test(cand))) out.push('probe/candidate labels are not judged as captures');
  if (!(/'__chk_enum'/.test(cand) && /'__chk_single'/.test(cand)
    && /hits is distinct from array\['__chk_enum', '__chk_single'\]/.test(cand))) {
    out.push('the latest definition carries the both-directions check block (collapse + single-run shortfall must fire)');
  }
  if (!(/max\(r\.started_at\) over \(partition by r\.platform\)/.test(cand) && /d\.bday = 0/.test(cand)
    && /'__chk_batch'/.test(cand))) {
    out.push('the sliced day is anchored at the label\'s own latest run, and the mid-batch case (__chk_batch) is checked');
  }
  if (!(/not like '%\\_enrich\\_%'/.test(cand) && /'wasalt_enrich_ar___chk'/.test(cand))) {
    out.push('an enrichment queue label (rows_seen = pending work) is not judged as a capture (alert 12600)');
  }
  if (!(/f\.ok is null\s+and f\.started_at > now\(\) - interval '6 hours'/.test(cand) && /'__chk_inflight'/.test(cand))) {
    out.push('a sliced batch with a slice still in flight is not judged on its day yet, and case (g) checks it (⚡ 2026-11-09)');
  }
  if (!/mon_silent_partial_success_candidates\(\)/.test(det)) out.push('the detector reads its candidates from that function');
  return out;
}

const cand = latest('function public.mon_silent_partial_success_candidates(');
const det = latest('function public.mon_detect_silent_partial_success(');
let failures = 0;
const real = problems(cand, det);
for (const p of real) { failures++; console.error(`  ✗ ${p}`); }
if (!real.length) console.log('  ✓ the committed detector judges slices by day and keeps its both-directions check block');

function mutation(name: string, brokenCand: string, brokenDet: string = det): void {
  if (problems(brokenCand, brokenDet).length) { console.log(`  ✓ (mutation) catches ${name}`); return; }
  failures++;
  console.error(`  ✗ (mutation) NOT caught: ${name}`);
}
mutation('the per-day path removed', cand.replace(/b\.median_runs\s*>=\s*3/g, 'false'));
mutation('liveness labels judged again', cand.replace(/not like '%liveness%'/g, "not like '%__none__%'"));
mutation('the check block assertion dropped', cand.replace(/hits is distinct from array\['__chk_enum', '__chk_single'\]/g, 'hits is null'));
mutation('the sliced day back on the rolling now() window', cand.replace(/d\.bday = 0/g, 'd.day_ago = 0'));
mutation('the mid-batch case dropped from the check block', cand.replace(/'__chk_batch'/g, "'__chk_other'"));
mutation('enrichment queues judged as captures again', cand.replace(/not like '%\\_enrich\\_%'/g, "not like '%__none__%'"));
mutation('an in-flight batch judged on half a day again', cand.replace(/f\.ok is null/g, 'f.ok is false'));
mutation('the in-flight case dropped from the check block', cand.replace(/'__chk_inflight'/g, "'__chk_other2'"));
mutation('the detector bypassing the candidate function', cand, det.replace(/mon_silent_partial_success_candidates\(\)/g, 'scrape_runs'));

if (failures) { console.error(`\n✗ ${failures} check(s) failed`); process.exit(1); }
console.log('\nPASS — silent_partial_success judges slices by day and still catches a collapse.');
