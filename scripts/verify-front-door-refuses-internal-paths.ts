// SECURITY (owner 2026-11-04, «lock the back-room doors»): the front door (api/sb.ts) refuses internal monitoring tables and
// functions (ops_*, mon_*, rpc/source_district_dropped_rows) to anyone without the robot pass. Measured live that day: a
// real browser on ezhalah.com called rpc/ops_search_load_now through /sb and got 200, while scripts were refused by BotID
// and the back door by the lock. Our CI checks that read these reach the database directly with the gate handshake.
//
// EXECUTES the lifted internalPath() against real names, proves the handler refuses before forwarding and only for
// non-robots, proves the web app never names an internal path (else the rule would break a page), and watches mutations bite.
//   node --experimental-strip-types scripts/verify-front-door-refuses-internal-paths.ts   (discovered by `npm test`)
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { liftSymbols } from './lib/liftSymbols.ts';

const root = join(import.meta.dirname, '..');
const lift = async (file: string) => (await liftSymbols(file, [{ header: 'export function internalPath(' }], ['internalPath'])).internalPath as (p: string) => boolean;
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const internal = ['rpc/ops_search_load_now', 'rpc/ops_deploy_lock_status', 'rpc/ops_qa_sweep_plan', 'ops_content_parity_heartbeat',
  'ops_qa_coverage_ledger', 'rpc/mon_run_all_detectors', 'mon_anything', 'rpc/source_district_dropped_rows'];
const app = ['search_listings_ar', 'rpc/district_options_ar', 'rpc/top_cities_by_deal_ar', 'rpc/log_zero_result', 'user_chats',
  'rpc/loader_active_platforms_ar', 'location_index_live', 'rpc/source_listing_counts', 'loc_city_cluster', 'rpc/compose_ops'];
const internalPath = await lift(join(root, 'api/sb.ts'));
check('internal monitoring paths are recognised', internal.every(internalPath), internal.filter((p) => !internalPath(p)).join(', '));
check('the app\'s own paths are not', app.every((p) => !internalPath(p)), app.filter(internalPath).join(', '));

// The handler refuses BEFORE forwarding, and only when the robot pass is absent.
const sb = readFileSync(join(root, 'api/sb.ts'), 'utf8');
const refuse = sb.indexOf('if (!robot && internalPath(path))');
const forward = sb.indexOf('upstream = await fetch(');
const robotDef = sb.indexOf("const robot = robotPass(request.headers.get('x-ezhalah-robot'), GATE);");
check('the handler refuses internal paths to non-robots', refuse > 0, 'no «if (!robot && internalPath(path))» in api/sb.ts');
check('…before anything is forwarded upstream', refuse > 0 && forward > refuse);
check('…after the robot pass is read (our robots keep their access)', robotDef > 0 && robotDef < refuse);

// The web app and edge functions never name an internal path (the rule must never break a page).
function walk(d: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const f = join(d, e.name);
    if (e.isDirectory()) out.push(...walk(f)); else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) out.push(f);
  }
  return out;
}
const named: string[] = [];
for (const f of walk(join(root, 'src'))) {
  for (const m of readFileSync(f, 'utf8').matchAll(/\.(?:rpc|from)\(\s*['"`]([a-z0-9_]+)['"`]/g)) {
    const p = m[0].startsWith('.rpc') ? `rpc/${m[1]}` : m[1];
    if (internalPath(p)) named.push(`${f.slice(root.length + 1)}: ${p}`);
  }
}
check('the web app never reads an internal path through the door', named.length === 0, named.join('; '));

// Mutations: a rule that lets ops_ functions through, and a rule that swallows app paths, must each turn this red.
const tmp = mkdtempSync(join(tmpdir(), 'internal-path-'));
const mutate = async (name: string, from: string, to: string) => {
  const f = join(tmp, `${name}.ts`);
  writeFileSync(f, sb.replace(from, to));
  return lift(f);
};
const leaky = await mutate('leaky', "/^(rpc\\/)?(ops_|mon_)/", "/^(mon_)/");
mustCatch('a rule that lets rpc/ops_* through', !internal.every(leaky));
const greedy = await mutate('greedy', "/^(rpc\\/)?(ops_|mon_)/", "/^(rpc\\/)?/");
mustCatch('a rule that blocks the app\'s own paths', !app.every((p) => !greedy(p)));

if (failed) { console.log(`\n❌ verify-front-door-refuses-internal-paths: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ the front door keeps internal monitoring doors shut to everyone but our own robots.');
