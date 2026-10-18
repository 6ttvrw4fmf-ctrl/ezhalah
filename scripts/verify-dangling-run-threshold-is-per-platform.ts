// Guard (2026-10-18, backlog 645/584): the dangling-run detector judges each platform by ITS OWN run
// length, and the remediation loop's verifier judges it the same way.
//
// THE BUG THIS EXISTS TO PREVENT
// ------------------------------
// mon_detect_dangling_scrape_run raised at a flat 3 h (dwelleo 6 h). Jobs that legitimately run longer
// raised a P1 during every healthy run, and the remediation loop escalated it to a P0
// remediation_exhausted: fleet_liveness:muhaysini (ok runs of 5 h 22 min — P0 9786 on 2026-10-17) and
// wasalt_enum_shard (ok shards of 5 h 00 min — P1 9833/9836 on 2026-10-18). A proposed fix that closed
// such rows at 3 h would have marked LIVE runs orphaned. verify_dangling_scrape_run kept its own flat
// 3 h, so detector and verifier could also disagree.
//
// Offline: reads the LATEST migration defining each function (date-prefixed names sort
// chronologically) and checks that both judge with public.scrape_run_dangling_after(platform), that
// no flat per-platform special case is back, and that the helper keeps its floor and cap.
import { readFileSync, readdirSync } from 'node:fs';

const DIR = 'supabase/migrations';
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
let failed = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed++;
};

// The body of the last `create or replace function public.<name>` in the tree, up to its closing $function$.
function latestBody(name: string): string | null {
  const re = new RegExp(`^\\s*create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, 'im');
  for (const f of [...files].reverse()) {
    const sql = readFileSync(`${DIR}/${f}`, 'utf8');
    const m = re.exec(sql);
    if (!m) continue;
    const rest = sql.slice(m.index);
    const open = rest.indexOf('$function$');
    const close = rest.indexOf('$function$', open + 1);
    return open > -1 && close > -1 ? rest.slice(0, close) : rest;
  }
  return null;
}

const helper = latestBody('scrape_run_dangling_after');
const detector = latestBody('mon_detect_dangling_scrape_run');
const verifier = latestBody('verify_dangling_scrape_run');

check('a migration defines scrape_run_dangling_after()', helper !== null);
check('mon_detect_dangling_scrape_run() is defined', detector !== null);
check('verify_dangling_scrape_run() is defined', verifier !== null);

if (helper && detector && verifier) {
  const calls = (s: string) => (s.match(/scrape_run_dangling_after\s*\(\s*s\.platform\s*\)/gi) || []).length;
  check('the detector raises with the per-platform threshold', calls(detector) >= 1);
  check('the detector self-heals with the same per-platform threshold', calls(detector) >= 2);
  check('the remediation verifier uses the same per-platform threshold', calls(verifier) >= 1);
  check('no flat per-platform special case is back in the detector',
    !/case\s+when\s+s\.platform\s*=/i.test(detector));
  check('the helper measures the platform\'s own ok runs', /max\s*\(\s*s\.finished_at\s*-\s*s\.started_at\s*\)/i.test(helper));
  check('the helper keeps the 3 h floor', /greatest\s*\(\s*interval\s*'3 hours'/i.test(helper));
  check('the helper caps at 6 h 30 min (a hosted GitHub job dies at 6 h)', /least\s*\(\s*interval\s*'6 hours 30 minutes'/i.test(helper));
  check('enum-rollup rows (never open) do not stretch the threshold', /not\s+like\s+'enum-rollup%'/i.test(helper));
}

if (failed) {
  console.error(`\n✗ verify-dangling-run-threshold-is-per-platform: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\n✅ verify-dangling-run-threshold-is-per-platform');
