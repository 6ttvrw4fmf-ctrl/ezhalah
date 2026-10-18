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
// no flat per-platform special case is back, and that the helper keeps its floor and cap. Each
// predicate is also run against the pre-fix bodies and must catch them.
import { readFileSync, readdirSync } from 'node:fs';

const DIR = 'supabase/migrations';
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
let failed = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed++;
};

// The body of the last `create or replace function public.<name>` in the tree, between its opening dollar
// tag (whatever it is: $$, $function$, $body$) and the matching close. No close → '' (fails closed).
function latestBody(name: string): string | null {
  const re = new RegExp(`^\\s*create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, 'im');
  for (const f of [...files].reverse()) {
    const sql = readFileSync(`${DIR}/${f}`, 'utf8');
    const m = re.exec(sql);
    if (!m) continue;
    const rest = sql.slice(m.index);
    const tag = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
    if (!tag) return '';
    const close = rest.indexOf(tag[0], tag.index + tag[0].length);
    return close > -1 ? rest.slice(tag.index + tag[0].length, close) : '';
  }
  return null;
}

// Every way the three bodies can fall back to a flat threshold, as a list of problems (empty = healthy).
function problems(helper: string, detector: string, verifier: string): string[] {
  const out: string[] = [];
  const calls = (s: string) => (s.match(/scrape_run_dangling_after\s*\(\s*s\.platform\s*\)/gi) || []).length;
  if (calls(detector) < 1) out.push('the detector does not raise with the per-platform threshold');
  if (calls(detector) < 2) out.push('the detector does not self-heal with the same per-platform threshold');
  if (calls(verifier) < 1) out.push('the remediation verifier does not use the per-platform threshold');
  if (/case\s+when\s+s\.platform\s*=/i.test(detector)) out.push('a flat per-platform special case is back in the detector');
  if (!/max\s*\(\s*s\.finished_at\s*-\s*s\.started_at\s*\)/i.test(helper)) out.push("the helper does not measure the platform's own ok runs");
  if (!/greatest\s*\(\s*interval\s*'3 hours'/i.test(helper)) out.push('the helper lost the 3 h floor');
  if (!/least\s*\(\s*interval\s*'6 hours 30 minutes'/i.test(helper)) out.push('the helper lost the 6 h 30 min cap');
  if (!/not\s+like\s+'enum-rollup%'/i.test(helper)) out.push('enum-rollup rows can stretch the threshold');
  return out;
}

const mustCatch = (name: string, broken: string[]) => check(`(mutation) ${name} is caught`, broken.length > 0);

const helper = latestBody('scrape_run_dangling_after');
const detector = latestBody('mon_detect_dangling_scrape_run');
const verifier = latestBody('verify_dangling_scrape_run');

check('a migration defines scrape_run_dangling_after()', !!helper);
check('mon_detect_dangling_scrape_run() is defined', !!detector);
check('verify_dangling_scrape_run() is defined', !!verifier);

if (helper && detector && verifier) {
  const found = problems(helper, detector, verifier);
  for (const p of found) console.log(`  · ${p}`);
  check('detector, verifier and helper judge each platform by its own run length', found.length === 0);

  // The pre-2026-10-18 bodies (flat 3 h, dwelleo 6 h) and three single-clause breakages must each be caught.
  const OLD_FLAT = "and s.started_at between now() - interval '48 hours' and now() - (case when s.platform = 'dwelleo' then interval '6 hours' else interval '3 hours' end)";
  mustCatch('the old flat-threshold detector', problems(helper, OLD_FLAT + '\n' + OLD_FLAT, verifier));
  mustCatch("the old verifier's flat 3 h", problems(helper, detector, "and s.started_at between now() - interval '48 hours' and now() - interval '3 hours'"));
  mustCatch('a helper without its cap', problems(helper.replace(/least\s*\(\s*interval\s*'6 hours 30 minutes',/i, '('), detector, verifier));
  mustCatch('a self-heal that went back to flat', problems(helper, detector.replace(/scrape_run_dangling_after\s*\(\s*s\.platform\s*\)(?![\s\S]*scrape_run_dangling_after)/i, "interval '3 hours'"), verifier));
}

if (failed) {
  console.error(`\n✗ verify-dangling-run-threshold-is-per-platform: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\n✅ verify-dangling-run-threshold-is-per-platform');
