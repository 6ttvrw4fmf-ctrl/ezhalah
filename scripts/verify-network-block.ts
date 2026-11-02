// SECURITY PHASE 4.4 (owner 2026-10-21: no VPN, like Aqar): the network guard judges only visitors the front door
// vouches for, never blocks on its own failure, keeps our robots working, and its lists cannot be emptied by a bad
// download. EXECUTES robotPass (api/sb.ts) and reads the migration + workflow. Mutations prove each check bites.
//   node --experimental-strip-types scripts/verify-network-block.ts   (discovered by `npm test`)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const root = join(import.meta.dirname, '..');
const sql = readFileSync(join(root, 'supabase/migrations/20261021224031_network_block_tor_vpn_datacenter.sql'), 'utf8');
const wf = readFileSync(join(root, '.github/workflows/network-block-lists.yml'), 'utf8');
const proxy = readFileSync(join(root, 'api/sb.ts'), 'utf8');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

// 1. Only a VOUCHED visitor is judged: for front-door traffic Cloudflare's address is our own server, which the
//    datacenter list contains. Judging it would block everyone.
const vouchedOnly = (s: string) => /if visitor is not null and coalesce\(hdr ->> 'x-ezhalah-robot', ''\) <> '1' then[\s\S]{0,200}net := guard\.network_source\(visitor\)/.test(s);
check('only the visitor the front door vouches for is checked, and robots with a pass are skipped', vouchedOnly(sql));

// 2. A lookup failure never blocks: the lookups sit inside the fail-open block, and refusal happens only in 'block' mode.
const failOpen = (s: string) => /exception when others then\s+blocked := false;\s+net := null;/.test(s)
  && /if net_mode = 'block' then\s+raise sqlstate 'PT403'/.test(s);
check('a failed lookup lets the visitor through; only block mode refuses', failOpen(sql));
check('it starts in watch mode (owner: a day of watching first)', /insert into guard\.network_block_mode \(id, mode\) values \(1, 'watch'\)/.test(sql));

// 3. A bad download cannot empty the guard, and a failed download fails the job.
check('a list that shrank to almost nothing is refused', /too small to be real/.test(sql) && /when 'tor' then 300 else 3000/.test(sql));
check('the daily job fails loudly on a failed download or store', /download failed/.test(wf) && /store failed/.test(wf) && /exit \$fail/.test(wf) && /cron: /.test(wf));

// 4. The robot pass: only the exact gate secret earns it, and a caller's own header is never forwarded as-is.
const robotPass = (await liftSymbols(join(root, 'api/sb.ts'), [{ header: 'export function robotPass(' }], ['robotPass'])).robotPass as (p: string | null, g: string) => boolean;
const g = 'x'.repeat(64);
check('only the exact gate secret earns the robot pass',
  robotPass(g, g) && !robotPass('1', g) && !robotPass(null, g) && !robotPass(g, '') && !robotPass(g.slice(1) + 'y', g));
check('the database only ever hears robot = 1, set by the front door',
  /const robot = robotPass\(request\.headers\.get\('x-ezhalah-robot'\), GATE\);/.test(proxy) && /if \(robot\) headers\.set\('x-ezhalah-robot', '1'\);/.test(proxy)
  && !/'x-ezhalah-robot'/.test((/const PASS_REQUEST = \[([^\]]*)\]/.exec(proxy)?.[1] ?? '')));

mustCatch('judging Cloudflare\'s address instead of the vouched visitor (would block everyone)',
  !vouchedOnly(sql.replace('net := guard.network_source(visitor)', "net := guard.network_source(hdr ->> 'cf-connecting-ip')")));
mustCatch('a lookup error that blocks', !failOpen(sql.replace('blocked := false;\n    net := null;', "blocked := false;\n    net := 'datacenter';")));
const tmp = join(mkdtempSync(join(tmpdir(), 'nb-')), 'sb.ts');
writeFileSync(tmp, proxy.replace("if (!gate || !presented || presented.length !== gate.length) return false;", 'if (!presented) return false; return true;'));
const loosePass = (await liftSymbols(tmp, [{ header: 'export function robotPass(' }], ['robotPass'])).robotPass as (p: string | null, g: string) => boolean;
mustCatch('a robot pass for any caller', loosePass('1', g) === true);

// 5. A refused visitor is TOLD why («please turn off your VPN»), never left looking at an empty or broken search.
const client = readFileSync(join(root, 'src/lib/supabase.ts'), 'utf8');
const layout = readFileSync(join(root, 'src/app/_layout.tsx'), 'utf8');
const i18n = readFileSync(join(root, 'src/i18n.tsx'), 'utf8');
const isBlocked = (await liftSymbols(join(root, 'src/lib/supabase.ts'), [{ header: 'export function isNetworkBlocked(' }], ['isNetworkBlocked']))
  .isNetworkBlocked as (s: number, b: unknown) => boolean;
const refusal = { code: 'PT403', message: 'This network is not supported' };
check('the guard\'s refusal is recognised, and nothing else is',
  isBlocked(403, refusal) && !isBlocked(403, { code: '42501', message: 'permission denied' }) && !isBlocked(200, refusal) && !isBlocked(403, null));
check('the message is raised on that refusal and mounted at the root, in Arabic and English',
  /isNetworkBlocked\(r\.status, b\)\) window\.dispatchEvent\(new Event\(NETWORK_BLOCKED_EVENT\)\)/.test(client)
  && /<NetworkBlockedNotice \/>/.test(layout)
  && /'Please turn off your VPN': 'فضلاً أوقف الـ VPN'/.test(i18n));
mustCatch('the refusal no longer raising the message', !/isNetworkBlocked\(r\.status, b\)\) window\.dispatchEvent/.test(client.replace('window.dispatchEvent(new Event(NETWORK_BLOCKED_EVENT))', 'void 0')));

if (failed) { console.error(`\n❌ verify-network-block: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-network-block: VPN / Tor / server networks are judged safely, robots keep working.');
