// The early-warning robot (scraper_early_warning) judges the NIGHTLY small-sources crawl, so its cron must
// fire after that crawl has had time to reach every site. 2026-10-12: it fired at 04:55 UTC, 33 min after
// the 04:22 dispatch of a ~143-job / 18-parallel run, and flagged 37 healthy sites as «no run in 20 h»
// (backlog 409-446) plus a 37-site duplicate re-crawl. This reads the LAST schedule each committed
// migration gives both crons and requires the gap the nightly run measurably needs (site starts ran until
// 05:31-06:42 UTC on the six nights before the fix).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIN_GAP_MIN = 180;
const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');

function minuteOfDay(expr: string): number {
  const [m, h] = expr.trim().split(/\s+/);
  if (!/^\d+$/.test(m) || !/^\d+$/.test(h)) throw new Error(`not a daily cron: ${expr}`);
  return Number(h) * 60 + Number(m);
}

export function lastSchedules(files: { name: string; sql: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    for (const m of f.sql.matchAll(/cron\.schedule\(\s*'([\w-]+)'\s*,\s*'([^']+)'/g)) out[m[1]] = m[2];
    for (const m of f.sql.matchAll(/\(\s*'([\w-]+)'\s*,\s*'(\d+ \d+ \* \* \*)'\s*,/g)) out[m[1]] ??= m[2];
    // cron.alter_job on the early-warning job (looked up by name in the same file)
    if (/jobname = 'scraper-early-warning'/.test(f.sql)) {
      const a = f.sql.match(/cron\.alter_job\([^)]*schedule\s*:=\s*'([^']+)'/);
      if (a) out['scraper-early-warning'] = a[1];
    }
  }
  return out;
}

export function problems(s: Record<string, string>): string[] {
  const ew = s['scraper-early-warning'];
  const ss = s['gh-small-sources'];
  if (!ew || !ss) return [`schedule not found (early-warning=${ew}, small-sources=${ss})`];
  const gap = (minuteOfDay(ew) - minuteOfDay(ss) + 1440) % 1440;
  return gap >= MIN_GAP_MIN ? [] : [`scraper-early-warning '${ew}' fires ${gap} min after the nightly small-sources dispatch '${ss}' (< ${MIN_GAP_MIN})`];
}

const files = readdirSync(dir).filter((n) => n.endsWith('.sql')).map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
const errs = problems(lastSchedules(files));

// Mutation proof: the pre-fix tree (without the 2026-10-12 reschedule) must fail.
const mustCatch = (label: string, caught: boolean) => {
  if (!caught) errs.push(`mutation not caught: ${label}`);
};
const pre = files.filter((f) => !f.name.startsWith('20261012051131'));
const mutErrs = problems(lastSchedules(pre));
mustCatch('the pre-fix tree (early warning at 04:55, 33 min into the 04:22 crawl)', mutErrs.length > 0);
mustCatch('an early warning 10 min after the nightly dispatch',
  problems({ 'scraper-early-warning': '32 4 * * *', 'gh-small-sources': '22 4 * * *' }).length > 0);

if (errs.length) {
  console.error('❌ verify-scraper-early-warning-runs-after-nightly-crawl\n  ' + errs.join('\n  '));
  process.exit(1);
}
console.log(`✅ scraper-early-warning runs ≥${MIN_GAP_MIN} min after the nightly small-sources dispatch (mutation caught: ${mutErrs[0]})`);
