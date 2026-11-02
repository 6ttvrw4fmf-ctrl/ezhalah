// SECURITY PHASE 4.1 (2026-10-21): the scrape alarm decides correctly, runs hourly, and cannot fail silent.
//
// EXECUTES findSuspects() (scripts/lib/scrapeAlarm.ts) on synthetic hours shaped like the measured ones, and reads
// the workflow + script for the two properties that keep it honest: it runs on a schedule with the secrets it needs,
// and a failed log query exits non-zero instead of stamping the heartbeat. Mutations prove each check can fail.
//   node --experimental-strip-types scripts/verify-scrape-alarm.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catchUpStart, findSuspects, hourIso, ROWS_PER_HOUR, type CallerHour } from './lib/scrapeAlarm.ts';

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
// Owner decision 2026-10-21: a caught caller is BLOCKED for 24 h, not just reported. The block must be written for every
// suspect, inside the suspects loop, before the heartbeat says the run was fine.
const blocks = (s: string) => {
  const loop = s.slice(s.indexOf('for (const s of suspects)'), s.lastIndexOf('ops_scrape_alarm_heartbeat'));
  return /rest\/v1\/ops_blocked_ip/.test(loop) && /blocked_until: new Date\(Date\.now\(\) \+ 24 \* 3600 \* 1000\)/.test(loop)
    && /resolution=merge-duplicates/.test(loop);
};
check('every suspect is blocked for 24 h (ops_blocked_ip, enforced by robot_gate)', blocks(script));
const gateSql = readFileSync(join(root, 'supabase/migrations/20261021043158_auto_block_bulk_downloaders.sql'), 'utf8');
const gateFailsOpen = (sql: string) => /exception when others then\s+blocked := false;/.test(sql)
  && /raise sqlstate 'PT429'/.test(sql) && /cf-connecting-ip/.test(sql);
check('the gatekeeper refuses blocked callers with 429 and FAILS OPEN if the lookup breaks', gateFailsOpen(gateSql));
mustCatch('the block step removed (report only)', !blocks(script.replace('rest/v1/ops_blocked_ip', 'rest/v1/ops_scrape_suspect')));
mustCatch('a gatekeeper whose lookup error blocks everyone', !gateFailsOpen(gateSql.replace('blocked := false;\n  end;', 'blocked := true;\n  end;')));

mustCatch('the bar lowered under our own robots (alert fatigue)', !barOk(lib.replace(/ROWS_PER_HOUR = [\d_]+;/, 'ROWS_PER_HOUR = 20_000;')));
mustCatch('the bar raised past a catalogue copy (blind alarm)', !barOk(lib.replace(/ROWS_PER_HOUR = [\d_]+;/, 'ROWS_PER_HOUR = 500_000;')));
mustCatch('a failed query treated as an empty hour', !failsLoud(script.replace('if (!res.ok) die(', 'if (!res.ok) console.log(')));
mustCatch('a scraper hiding behind a known IP list that names everyone', ips(findSuspects(hour, ['9.9.9.9', '8.8.8.8'])) !== '9.9.9.9,8.8.8.8');

// CATCH-UP (2026-10-23): GitHub runs the "hourly" schedule every 3-5 hours, so each run must cover every hour since the
// last good run (per-hour bars, one row per caller per hour), never just the last hour.
const end = new Date('2026-10-23T05:07:00Z');
const H = 3600_000;
check('a run covers every hour since the last good run, 1 to 24 hours back',
  catchUpStart(new Date('2026-10-23T00:23:00Z'), end).toISOString() === '2026-10-23T00:00:00.000Z'      // 5 h gap → 5 h covered
  && catchUpStart(new Date('2026-10-23T04:59:00Z'), end).toISOString() === '2026-10-23T04:00:00.000Z'   // recent → from that hour (>= 1 h)
  && catchUpStart(new Date('2026-10-23T05:05:00Z'), end).getTime() === end.getTime() - H                 // just ran → still at least 1 h
  && catchUpStart(new Date('2026-10-20T00:00:00Z'), end).getTime() === end.getTime() - 24 * H + 60_000   // capped at the API limit
  && catchUpStart(null, end).getTime() === end.getTime() - 24 * H + 60_000);                             // unreadable → widest, never narrower
check('the log query is per caller per hour and the run uses the catch-up window',
  /toStartOfHour\(timestamp\) as hour/.test(lib) && /group by ip, hour/.test(lib) && /const start = catchUpStart\(lastOk, end\);/.test(script));
check('the hour reads back as an exact time', hourIso('2026-10-22T21:00:00', end) === '2026-10-22T21:00:00.000Z' && hourIso('2026-10-22 21:00:00', end) === '2026-10-22T21:00:00.000Z');
mustCatch('the window shrunk back to one hour', !/const start = catchUpStart\(lastOk, end\);/.test(script.replace('const start = catchUpStart(lastOk, end);', 'const start = new Date(end.getTime() - 3600000);')));

// PER-VISITOR (2026-10-27): front-door callers are judged by a scrambled visitor code, not Vercel's shared address.
// The door (api/sb.ts visitorCode), this alarm (visitorKey) and the database (guard.visitor_code) must agree byte for
// byte, or a block written by the alarm would never reach the visitor. Reference value computed by Postgres
// extensions.hmac('1.2.3.4','k','sha256') on production, 2026-10-27.
const { visitorKey, knownCallerKeys } = await import('./lib/scrapeAlarm.ts');
const { liftSymbols } = await import('./lib/liftSymbols.ts');
const door = await liftSymbols(join(root, 'api/sb.ts'), [{ header: 'export async function visitorCode(', endsWith: /^}$/ }], ['visitorCode']);
const doorCode = await (door.visitorCode as (ip: string, s: string) => Promise<string>)('1.2.3.4', 'k');
check('door, alarm and database scramble a visitor identically', visitorKey('1.2.3.4', 'k') === 'vid:f89b701661c175bf' && doorCode === 'f89b701661c175bf', `${visitorKey('1.2.3.4', 'k')} / ${doorCode}`);
check('the owner is known behind the front door too', knownCallerKeys([' 1.2.3.4 ', ''], 'k').join(',') === '1.2.3.4,vid:f89b701661c175bf');
const lastVid = /arrayElement\(extractAll\([^)]*'vid=\(\[0-9a-f\]\{16\}\)'\), -1\)/;
check('front-door callers are keyed by the LAST vid= (the door appends after the client), our robots are not judged',
  lastVid.test(lib) && /'robot=\(\[01\]\)'\), -1\) = '1'/.test(lib));
mustCatch('a key that trusts the FIRST vid= (a client could frame someone)', !lastVid.test(lib.replaceAll("'vid=([0-9a-f]{16})'), -1)", "'vid=([0-9a-f]{16})'), 1)")));
mustCatch('an alarm that forgets the owner behind the door', !knownCallerKeys(['1.2.3.4'], '').includes('vid:f89b701661c175bf'));

if (failed) { console.error(`\n❌ verify-scrape-alarm: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-scrape-alarm: the hourly scrape alarm flags bulk downloads and fails loud when blind.');
