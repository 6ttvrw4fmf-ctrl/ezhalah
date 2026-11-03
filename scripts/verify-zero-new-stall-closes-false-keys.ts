// zero_new_stall must close every key whose condition the run found false — not only on two arms.
//
// THE DEFECT (zero_new_stall:aqaralsaudia, open with last_affirmed_at 2026-09-27). The detector resolved a
// platform's key only when (a) it had >= 10 new listings in the prior fortnight, none recently, and a full
// re-list, or (b) it had new listings recently. A platform with fewer than 10 in the prior fortnight runs
// NEITHER arm — aqaralsaudia went dormant on 09-27 (its prior window emptied) and its key stayed open for
// five weeks with nothing able to re-check or close it. An open row nobody re-affirms is a claim about the
// day it was raised.
//
// THE RULE. The detector collects the keys it raises in this run and hands them to
// mon_resolve_stale_keys('zero_new_stall', live), which closes every other open key of the kind.
//
// HOW (hermetic): the LAST committed migration touching mon_detect_zero_new_stall is read; its live text
// (for a patch, the replacement) must collect `live` before the raise and sweep with it. The pre-fix
// definition must FAIL (mutation), and the sweep is EXECUTED on a model of the arms to prove the
// aqaralsaudia shape closes while a genuinely stalled platform stays open.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIG = join(ROOT, 'supabase', 'migrations');

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

type Shape = { collectsLive: boolean; sweeps: boolean };
function shapeOf(files: string[]): Shape | null {
  let s: Shape | null = null;
  for (const f of files) {
    const sql = readFileSync(join(MIG, f), 'utf8');
    if (!/mon_detect_zero_new_stall/.test(sql)) continue;
    const isDef = /create\s+or\s+replace\s+function\s+public\.mon_detect_zero_new_stall\s*\(/i.test(sql);
    const isPatch = sql.includes("pg_get_functiondef('public.mon_detect_zero_new_stall()'");
    if (!isDef && !isPatch) continue;
    s = {
      collectsLive: /live := live \|\| \('zero_new_stall:' \|\| rec\.platform\);\s*\n\s*n := n \+ public\.mon_raise\('P1','zero_new_stall'/.test(sql),
      sweeps: /perform public\.mon_resolve_stale_keys\('zero_new_stall', live\);/.test(sql),
    };
  }
  return s;
}

// The detector's arms, executed. Returns the set of keys left open after one run.
function run(shape: Shape, open: Set<string>, platforms: { p: string; prior: number; recent: number; cov: number }[]) {
  const after = new Set(open);
  const live: string[] = [];
  for (const x of platforms) {
    const key = `zero_new_stall:${x.p}`;
    if (x.prior >= 10 && x.recent === 0) {
      if (x.cov < 0.8) { after.add(key); if (shape.collectsLive) live.push(key); }
      else after.delete(key);
    } else if (x.recent > 0) after.delete(key);
  }
  if (shape.sweeps && shape.collectsLive) for (const k of [...after]) if (!live.includes(k)) after.delete(k);
  return after;
}

console.log('verify-zero-new-stall-closes-false-keys: a key the run did not raise is closed.');
const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const now = shapeOf(files);
check('mon_detect_zero_new_stall is committed', now !== null);
const scenario = [
  { p: 'aqaralsaudia', prior: 0, recent: 0, cov: 0 },   // the stuck shape: under the floor, neither arm
  { p: 'stalled', prior: 40, recent: 0, cov: 0.3 },     // a real stall
];
const open0 = new Set(['zero_new_stall:aqaralsaudia']);
if (now) {
  const left = run(now, open0, scenario);
  check('the aqaralsaudia shape (prior < 10, nothing recent) is closed', !left.has('zero_new_stall:aqaralsaudia'));
  check('a platform that really stalled stays open', left.has('zero_new_stall:stalled'));
}
const patchIdx = files.findLastIndex((f) => readFileSync(join(MIG, f), 'utf8').includes("pg_get_functiondef('public.mon_detect_zero_new_stall()'"));
check('the fixing patch is committed', patchIdx >= 0);
if (patchIdx >= 0) {
  const before = shapeOf(files.slice(0, patchIdx));
  check('mutation: the pre-fix detector leaves the aqaralsaudia key open', Boolean(before) && run(before!, open0, scenario).has('zero_new_stall:aqaralsaudia'));
}

if (failures) {
  console.log(`\n❌ verify-zero-new-stall-closes-false-keys: ${failures} failure(s).`);
  process.exit(1);
}
console.log('\n✅ verify-zero-new-stall-closes-false-keys: passed.');
