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

export const alarmCountsAndFailsClosed = (sql: string): boolean =>
  /create or replace function public\.ops_ai_facts_unread_new\(\)/.test(sql) &&
  /exception when others then\n\s+source_table := t; window_ads := null; unread := null; failed := left\(sqlerrm, 160\);/.test(sql) &&
  /where g\.failed is not null or \(g\.unread >= 25 and g\.unread >= 0\.05 \* g\.window_ads\);/.test(sql) &&
  /public\.mon_raise\('P2', 'ai_facts_new_ads_unread'/.test(sql) &&
  /execute replace\(d, anchor, addition \|\| anchor\);/.test(sql);

const migDir = join(root, 'supabase', 'migrations');
const file = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
  .filter((f) => /create or replace function public\.ops_ai_facts_unread_new\(/.test(readFileSync(join(migDir, f), 'utf8'))).pop() ?? '';
const SQL = file ? readFileSync(join(migDir, file), 'utf8') : '';
const PY = readFileSync(join(root, 'scrapers', 'facts', 'extract.py'), 'utf8');

console.log('The AI reader never skips a site silently, and every new ad is read');
check('extract.py turns a run red when a table could not be fetched', runTurnsRedOnSkip(PY));
check(`the unread-new-ads alarm (${file || 'none'}) counts, fails closed, and is wired into mon_detect_text_facts`, alarmCountsAndFailsClosed(SQL));
mustCatch('a skipped table no longer recorded', !runTurnsRedOnSkip(PY.replace(/\n\s+skipped_tables\.append\(table\)/, '')));
mustCatch('a skipped table no longer failing the run', !runTurnsRedOnSkip(PY.replace(/rc = 4\b/, 'rc = 0')));
mustCatch('a table the alarm cannot count read as zero', !alarmCountsAndFailsClosed(SQL.replace('unread := null; failed := left(sqlerrm, 160);', 'unread := 0; failed := null;')));
mustCatch('the alarm threshold raised', !alarmCountsAndFailsClosed(SQL.replace('g.unread >= 25 and', 'g.unread >= 5000 and')));
mustCatch('the alarm never wired into the detector', !alarmCountsAndFailsClosed(SQL.replace('execute replace(d, anchor, addition || anchor);', 'null;')));
if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ the AI reader never skips a site silently');
