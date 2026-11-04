// THE AI READER NEVER SKIPS A SITE SILENTLY, AND EVERY NEW AD IS READ (owner 2026-10-30: «make sure we never [skip]
// and we read everything»).
//
// On 2026-10-29 every backlog lane timed out picking aqar, printed «sampling failed», and still exited 0, so ~42k unread
// Aqar ads were skipped round after round with every run green. Two nets, each proven by mutations it must catch:
//   1. scrapers/facts/extract.py: a table it could not fetch turns the run red (exit 4) after the rest is read;
//   2. the database: ops_ai_facts_unread_new() counts new ads with text the AI never read, reports a table it cannot
//      count as FAILED (never zero), and mon_detect_text_facts raises ai_facts_new_ads_unread on it.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
let failed = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

export const runTurnsRedOnSkip = (py: string): boolean =>
  /print\(f"  ! \{table\}: sampling failed: \{str\(e\)\[:200\]\}"\)\n\s+skipped_tables\.append\(table\)/.test(py) &&
  /if skipped_tables and rc == 0:\n[^\n]*\n\s+rc = 4/.test(py);

// MEANING, NOT ONE FILE'S WORDING (2026-10-31): the counter is judged on its LATEST definition, the alarm's threshold
// and its wiring into mon_detect_text_facts on the WHOLE migration history — they were written once
// (20261030061800) and a later migration that only redefines the counter (20261031080211) must not fail for not
// repeating them. That failure blocked the mirror PR and, through the drift gate, every frontend deploy.
export const counterFailsClosed = (sql: string): boolean =>
  /create or replace function public\.ops_ai_facts_unread_new\(\)/.test(sql) &&
  /exception when others then\n\s+source_table := t; window_ads := null; unread := null; failed := left\(sqlerrm, 160\);/.test(sql);
/** The ONE migration that raises ai_facts_new_ads_unread also carries its threshold and wires it into the detector. */
export const alarmWired = (files: { sql: string }[]): boolean =>
  files.some((f) =>
    /public\.mon_raise\('P2', 'ai_facts_new_ads_unread'/.test(f.sql) &&
    /where g\.failed is not null or \(g\.unread >= 25 and g\.unread >= 0\.05 \* g\.window_ads\);/.test(f.sql) &&
    /execute replace\(d, anchor, addition \|\| anchor\);/.test(f.sql));
export const alarmCountsAndFailsClosed = (latest: string, files: { sql: string }[]): boolean => counterFailsClosed(latest) && alarmWired(files);

// THE ALARM WATCHES WHAT THE NIGHT READS (2026-11-04). facts-extract.yml reads one --category by default (owner
// 2026-10-26: «residential only, later commercial»); the counter counted commercial too, so the first clean night left
// only commercial ads «unread» and the alert could never clear — and a residential table falling behind hides under a
// standing alert. The workflow default and the counter's table filter must name the same category.
export const nightCategory = (yml: string): string | null =>
  yml.match(/CATEGORY: \$\{\{ inputs\.category \|\| '([a-z]+)' \}\}/)?.[1] ?? null;
const FILTER: Record<string, string> = {
  residential: "s.source_table ~ '_residential_listings$'",
  commercial: "s.source_table ~ '_commercial_listings$'",
  all: "s.source_table ~ '_(residential|commercial)_listings$'",
};
export const counterWatchesTheNight = (latest: string, yml: string): boolean => {
  const cat = nightCategory(yml);
  return cat !== null && FILTER[cat] !== undefined && latest.includes(FILTER[cat]) &&
    Object.entries(FILTER).every(([k, f]) => k === cat || !latest.includes(f));
};

const migDir = join(root, 'supabase', 'migrations');
const FILES = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort().map((name) => ({ name, sql: readFileSync(join(migDir, name), 'utf8') }));
const file = FILES.filter((f) => /create or replace function public\.ops_ai_facts_unread_new\(/.test(f.sql)).pop()?.name ?? '';
const SQL = file ? readFileSync(join(migDir, file), 'utf8') : '';
const edited = (from: string, to: string) => FILES.map((f) => ({ sql: f.sql.replace(from, to) }));
const PY = readFileSync(join(root, 'scrapers', 'facts', 'extract.py'), 'utf8');
const YML = readFileSync(join(root, '.github', 'workflows', 'facts-extract.yml'), 'utf8');

console.log('The AI reader never skips a site silently, and every new ad is read');
check('extract.py turns a run red when a table could not be fetched', runTurnsRedOnSkip(PY));
check(`the unread-new-ads alarm (${file || 'none'}) counts, fails closed, and is wired into mon_detect_text_facts`, alarmCountsAndFailsClosed(SQL, FILES));
mustCatch('a skipped table no longer recorded', !runTurnsRedOnSkip(PY.replace(/\n\s+skipped_tables\.append\(table\)/, '')));
mustCatch('a skipped table no longer failing the run', !runTurnsRedOnSkip(PY.replace(/rc = 4\b/, 'rc = 0')));
mustCatch('a table the alarm cannot count read as zero', !alarmCountsAndFailsClosed(SQL.replace('unread := null; failed := left(sqlerrm, 160);', 'unread := 0; failed := null;'), FILES));
mustCatch('the alarm threshold raised', !alarmCountsAndFailsClosed(SQL, edited('g.unread >= 25 and', 'g.unread >= 5000 and')));
mustCatch('the alarm never wired into the detector', !alarmCountsAndFailsClosed(SQL, edited('execute replace(d, anchor, addition || anchor);', 'null;')));
check(`the counter watches the category the nightly reads (${nightCategory(YML) ?? 'unreadable'})`, counterWatchesTheNight(SQL, YML));
mustCatch('the nightly turned to «all» while the counter stays residential',
  !counterWatchesTheNight(SQL, YML.replace(/(CATEGORY: \$\{\{ inputs\.category \|\| ')[a-z]+(' \}\})/, '$1all$2')));
mustCatch('the counter widened back to commercial while the nightly reads residential',
  !counterWatchesTheNight(SQL.replace(FILTER[nightCategory(YML) ?? 'residential'] ?? '', () => FILTER.all), YML));
mustCatch('an unreadable workflow default', !counterWatchesTheNight(SQL, YML.replace('CATEGORY:', 'KATEGORY:')));
mustCatch('the alarm removed from the history', !alarmCountsAndFailsClosed(SQL, edited("public.mon_raise('P2', 'ai_facts_new_ads_unread'", "null")));
if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ the AI reader never skips a site silently');
