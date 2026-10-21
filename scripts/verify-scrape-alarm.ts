// SECURITY PHASE 4.1 (2026-10-21): the scrape alarm decides correctly, runs hourly, and cannot fail silent.
//
// EXECUTES findSuspects() (scripts/lib/scrapeAlarm.ts) on synthetic hours shaped like the measured ones, and reads
// the workflow + script for the two properties that keep it honest: it runs on a schedule with the secrets it needs,
// and a failed log query exits non-zero instead of stamping the heartbeat. Mutations prove each check can fail.
//   node --experimental-strip-types scripts/verify-scrape-alarm.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findSuspects, ROWS_PER_HOUR, type CallerHour } from './lib/scrapeAlarm.ts';

const root = join(import.meta.dirname, '..');
const wf = readFileSync(join(root, '.github/workflows/scrape-alarm.yml'), 'utf8');
const script = readFileSync(join(root, 'scripts/scrape-alarm.ts'), 'utf8');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const row = (o: Partial<CallerHour>): CallerHour => ({ ip: '1.2.3.4', country: 'DE', city: 'Falkenstein', network: 'Hetzner Online GmbH',
  user_agent: 'python-requests', listing_rows: 0, requests: 0, top_paths: [], ...o });
const hour = [
  row({ ip: '9.9.9.9', listing_rows: 400_000, requests: 400 }),                       // a full-catalogue copy
  row({ ip: '8.8.8.8', listing_rows: 900, requests: 7_000 }),                         // a request flood
  row({ ip: '7.7.7.7', listing_rows: 27_000, requests: 20, network: 'Google LLC' }),  // our cloud sessions' measured peak
  row({ ip: '6.6.6.6', listing_rows: 600, requests: 210, network: 'STC' }),           // a real visitor
  row({ ip: '5.5.5.5', listing_rows: 6_000_000, requests: 6_000, network: 'Microsoft Corporation' }), // our CI
  row({ ip: '4.4.4.4', listing_rows: 385_000, requests: 4_600, network: 'Cox Communications' }),     // owner's home
];
const ips = (rs: CallerHour[]) => rs.map((r) => r.ip).join(',');
check('a catalogue copy and a request flood are flagged; visitors, our cloud sessions, CI and known owner IPs are not',
  ips(findSuspects(hour, ['4.4.4.4'])) === '9.9.9.9,8.8.8.8', ips(findSuspects(hour, ['4.4.4.4'])));
const lib = readFileSync(join(root, 'scripts/lib/scrapeAlarm.ts'), 'utf8');
const barOf = (src: string) => Number((/export const ROWS_PER_HOUR = ([\d_]+);/.exec(src)?.[1] ?? '0').replace(/_/g, ''));
const barOk = (src: string) => barOf(src) > 27_000 && barOf(src) <= 100_000;
check('the bar sits above our own measured cloud peak (27,000) and well below a catalogue copy', barOk(lib) && barOf(lib) === ROWS_PER_HOUR, String(barOf(lib)));
check('the workflow runs hourly with the log token, the service key and the known-IP list',
  /cron: '\d+ \* \* \* \*'/.test(wf) && /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/.test(wf)
  && /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/.test(wf) && /scripts\/scrape-alarm\.ts/.test(wf));
const failsLoud = (s: string) => /if \(!res\.ok\) die\(/.test(s) && /!Array\.isArray\(body\.result\)\) die\(/.test(s)
  && s.lastIndexOf('ops_scrape_alarm_heartbeat') > s.indexOf('!Array.isArray(body.result)');
check('a failed log query exits 1 before the heartbeat is stamped (silence is never "no scraping")', failsLoud(script));
check('the alert carries no address (only the private table does)', !/p_detail: \{[^}]*\bip\b/.test(script));

mustCatch('the bar lowered under our own robots (alert fatigue)', !barOk(lib.replace(/ROWS_PER_HOUR = [\d_]+;/, 'ROWS_PER_HOUR = 20_000;')));
mustCatch('the bar raised past a catalogue copy (blind alarm)', !barOk(lib.replace(/ROWS_PER_HOUR = [\d_]+;/, 'ROWS_PER_HOUR = 500_000;')));
mustCatch('a failed query treated as an empty hour', !failsLoud(script.replace('if (!res.ok) die(', 'if (!res.ok) console.log(')));
mustCatch('a scraper hiding behind a known IP list that names everyone', ips(findSuspects(hour, ['9.9.9.9', '8.8.8.8'])) !== '9.9.9.9,8.8.8.8');

if (failed) { console.error(`\n❌ verify-scrape-alarm: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-scrape-alarm: the hourly scrape alarm flags bulk downloads and fails loud when blind.');
