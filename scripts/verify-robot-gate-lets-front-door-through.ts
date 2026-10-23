// P1 SPEED (owner 2026-10-23): real users must never wait in the robot lanes.
//
// robot_gate() queues script user-agents («node», curl, python…) in 2 global lanes. Since the front door
// (api/sb.ts) every browser request reaches the database from Vercel's Node fetch, user-agent «node», so real users
// were queued as robots (front-door p95 5.2 s at the origin). Migration
// *_robot_gate_lets_front_door_visitors_through.sql lets a vouched front-door visitor through unless it carries the
// robot pass. This file guards that edit's shape and that api/sb.ts still marks our robots with the pass — if the
// front door stopped sending x-ezhalah-robot, our own post-deploy robots would skip the lanes and crowd users again.
//   node --experimental-strip-types scripts/verify-robot-gate-lets-front-door-through.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dir = join(root, 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();
const file = files.filter((f) => /_robot_gate_lets_front_door_visitors_through\.sql$/.test(f)).at(-1);
if (!file) { console.log('FAIL  migration *_robot_gate_lets_front_door_visitors_through.sql is missing'); process.exit(1); }
const sql = readFileSync(join(dir, file), 'utf8');
const sb = readFileSync(join(root, 'api', 'sb.ts'), 'utf8');
const later = files.filter((f) => f > file).map((f) => ({ f, s: readFileSync(join(dir, f), 'utf8') }));

function problems(s: string, proxy: string): string[] {
  const fail: string[] = [];
  if (!/if coalesce\(hdr ->> 'x-ezhalah-robot', ''\) = '1' then\s+null;\s+elsif visitor is not null or not public\.robot_gate_applies\(/.test(s)) fail.push('the lane check does not let vouched visitors through while still queueing the robot pass');
  if (/create\s+or\s+replace\s+function\s+public\.robot_gate/i.test(s)) fail.push('full-body replace of robot_gate (a concurrent edit would be lost) — use the needle edit');
  if (!/if n <> 1 then\s+raise exception 'robot_gate: the lane check was found/.test(s)) fail.push('no fail-closed needle count');
  if (!/a vouched browser still queued/.test(s) || !/the robot pass no longer queues/.test(s) || !/a direct node script no longer queues/.test(s)) fail.push('the apply-time proof does not cover browser / robot pass / direct script');
  if (!/if \(robot\) headers\.set\('x-ezhalah-robot', '1'\);/.test(proxy)) fail.push("api/sb.ts no longer marks our robots with x-ezhalah-robot: 1 — they would skip the lanes");
  if (!/headers\.set\('x-ezhalah-gate', GATE\)/.test(proxy)) fail.push('api/sb.ts no longer sends the front-door handshake');
  return fail;
}
const reverted = (ms: { f: string; s: string }[]) => ms.filter(({ s }) => /create\s+or\s+replace\s+function\s+public\.robot_gate\s*\(\s*\)/i.test(s) && !/elsif visitor is not null or not public\.robot_gate_applies\(/.test(s)).map(({ f }) => f);

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const p = problems(sql, sb);
check('front-door visitors skip the robot lanes; our robot pass and direct scripts still queue', p.length === 0, p.join('; '));
const r = reverted(later);
check('no later migration redefines robot_gate without the front-door branch', r.length === 0, r.join(', '));

mustCatch('the robot pass no longer queued', problems(sql.replace("if coalesce(hdr ->> 'x-ezhalah-robot', '') = '1' then\n      null;\n    elsif", 'if'), sb).length > 0);
mustCatch('vouched visitors still queued (branch removed)', problems(sql.replace('elsif visitor is not null or not public.robot_gate_applies(', 'elsif not public.robot_gate_applies('), sb).length > 0);
mustCatch('a full-body replace', problems(sql + '\ncreate or replace function public.robot_gate() returns void language plpgsql as $$ begin end $$;', sb).length > 0);
mustCatch('the front door dropping the robot pass', problems(sql, sb.replace("if (robot) headers.set('x-ezhalah-robot', '1');", '')).length > 0);
mustCatch('no apply-time proof for direct scripts', problems(sql.replace('a direct node script no longer queues', 'x'), sb).length > 0);
mustCatch('a later full redefinition without the branch', reverted([{ f: '29990101000000_x.sql', s: 'create or replace function public.robot_gate() returns void language plpgsql as $$ begin end $$;' }]).length > 0);

if (failed) { console.error(`\n❌ verify-robot-gate-lets-front-door-through: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-robot-gate-lets-front-door-through: real users never wait in the robot lanes.');
