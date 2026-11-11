// Gathern's unit-page details (bathrooms, kitchen, description, house rules) must be read right AFTER the daily crawl.
//
// The list crawl (gathern-sync.yml, «Gathern sync», gh-gathern-daily 04:08 UTC) brings the new units; only the detail
// backfill (gathern-backfill-details.yml) reads each unit's own page. Until 2026-11-11 the backfill ran at 02:00 UTC
// only, so every unit that arrived at 04:08 sat without its bathrooms / kitchen / description for ~22 hours (measured
// 11-11 07:20 UTC: 34 of 62 units scraped that morning had no bathroom count, while 98–100 % of each earlier day's
// units had one once backfilled). This check fails if the backfill stops following the crawl.
//   node --experimental-strip-types scripts/verify-gathern-details-follow-the-crawl.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const wf = (f: string) => readFileSync(join(import.meta.dirname, '..', '.github', 'workflows', f), 'utf8');
const BACKFILL = wf('gathern-backfill-details.yml');
const SYNC = wf('gathern-sync.yml');

export function problems(backfill: string, sync: string): string[] {
  const p: string[] = [];
  const syncName = /^name:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(sync)?.[1];
  if (!syncName) { p.push('gathern-sync.yml has no workflow name to follow'); return p; }
  const on = /^on:\n([\s\S]*?)^\S/m.exec(backfill)?.[1] ?? '';
  const wr = /^\s{2}workflow_run:\n([\s\S]*?)(?=^\s{2}\S|(?![\s\S]))/m.exec(on)?.[1] ?? '';
  if (!wr) p.push('gathern-backfill-details.yml no longer runs after the crawl (no workflow_run trigger): new units wait ~22 h for their bathrooms');
  else {
    const names = /workflows:\s*\[([^\]]*)\]/.exec(wr)?.[1] ?? '';
    if (!names.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).includes(syncName))
      p.push(`the backfill's workflow_run does not name the crawl «${syncName}»`);
    if (!/types:\s*\[\s*completed\s*\]/.test(wr)) p.push('the backfill must run when the crawl has COMPLETED');
  }
  if (!/^\s{2}schedule:/m.test(on)) p.push('the 02:00 backfill schedule is gone (units the crawl never revisits would stay unread)');
  if (/^\s{4}if:\s*github\.event_name\s*==\s*'schedule'/m.test(backfill)) p.push('the backfill job runs only on schedule — the after-crawl run would do nothing');
  return p;
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const real = problems(BACKFILL, SYNC);
check('the Gathern detail backfill runs right after the daily crawl (and still at 02:00)', real.length === 0, real.join('; '));

const swap = (from: string | RegExp, to: string) => { const s = BACKFILL.replace(from, to); if (s === BACKFILL) throw new Error(`mutation was a no-op: ${from}`); return s; };
mustCatch('the after-crawl trigger removed', problems(swap(/  workflow_run:\n    workflows: \["Gathern sync"\]\n    types: \[completed\]\n/, ''), SYNC).length > 0);
mustCatch('the trigger following another workflow', problems(swap('workflows: ["Gathern sync"]', 'workflows: ["Gathern liveness"]'), SYNC).length > 0);
mustCatch('the crawl renamed without the trigger', problems(BACKFILL, SYNC.replace(/^name:\s*Gathern sync\s*$/m, 'name: Gathern crawl')).length > 0);
mustCatch('the trigger firing on request instead of completion', problems(swap('types: [completed]', 'types: [requested]'), SYNC).length > 0);
mustCatch('the 02:00 schedule dropped', problems(swap('  schedule:\n    - cron: "0 2 * * *"\n', ''), SYNC).length > 0);

if (failed) { console.error(`\n❌ verify-gathern-details-follow-the-crawl: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-gathern-details-follow-the-crawl: new Gathern units get their unit-page details the morning they arrive.');
