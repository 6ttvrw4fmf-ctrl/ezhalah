// THE FRONT DOOR RETRIES ITSELF BEFORE THE BACK DOOR (2026-10-27, before the back-door lock).
//
// Once the database refuses keyless callers, the app's old «front door failed → go direct» retry is refused too. So a
// network blip or a gateway hiccup (502/503/504) must get ONE more try at the door first; only then the direct retry.
// EXECUTES the real frontDoorFetch (src/lib/supabase.ts) against a fake window.fetch that fails on cue, and records
// where each attempt went. Mutations prove each rule can fail.
//   node --experimental-strip-types scripts/verify-front-door-retries-itself.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const root = join(import.meta.dirname, '..');
const SRC = join(root, 'src/lib/supabase.ts');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const SYMBOLS = [
  { header: 'export function frontDoorUrl(' }, { header: 'function frontDoorFetch(' }, { header: 'export function doorHiccup(' },
  { header: 'export function fallbackLabel(' }, { header: "export const NETWORK_BLOCKED_EVENT = 'ezhalah:network-blocked';", endsWith: /;$/ },
  { header: 'export function isNetworkBlocked(' }, { header: 'export function frontDoorAnswered(' },
];
// The fake browser: each call takes the next scripted outcome; «door» = /sb/, «direct» = supabase.co.
const PRELUDE = `const url = 'https://p.supabase.co';
const window = globalThis.__fakeWindow;
const setTimeout = (f) => f();`;

type Outcome = 'net' | number;
async function run(src: string, script: Outcome[]): Promise<{ trail: string; status: number | 'threw' }> {
  const file = join(root, 'scripts/.tmp-front-door-retry.ts');
  (await import('node:fs')).writeFileSync(file, src);
  const trail: string[] = [];
  (globalThis as any).__fakeWindow = {
    dispatchEvent() {},
    fetch: async (u: string) => {
      const where = String(u).startsWith('/sb/') ? 'door' : 'direct';
      const next = script.shift() ?? 200;
      trail.push(`${where}:${next}`);
      if (next === 'net') throw new TypeError('Failed to fetch');
      return new Response('[]', { status: next, headers: where === 'door' && next !== 404 ? { 'x-ezhalah-bot': 'human' } : {} }); // a 404 = no door at all: no stamp
    },
  };
  try {
    const mod = await liftSymbols(file, SYMBOLS, ['frontDoorFetch'], PRELUDE);
    const r = await (mod.frontDoorFetch as (u: string) => Promise<Response>)('https://p.supabase.co/rest/v1/rpc/x');
    return { trail: trail.join(' '), status: r.status };
  } catch { return { trail: trail.join(' '), status: 'threw' }; }
  finally { (await import('node:fs')).rmSync(file, { force: true }); }
}

const real = readFileSync(SRC, 'utf8');
const ok1 = await run(real, ['net', 200]);
check('a network blip retries THE DOOR once, and that answer is used', ok1.trail === 'door:net door:200' && ok1.status === 200, ok1.trail);
const ok2 = await run(real, [503, 200]);
check('a gateway hiccup (503) retries the door once', ok2.trail === 'door:503 door:200' && ok2.status === 200, ok2.trail);
const ok3 = await run(real, ['net', 'net', 200]);
check('two blips: only then the old direct retry (labelled), never a loop', ok3.trail === 'door:net door:net direct:200', ok3.trail);
const ok4 = await run(real, [200]);
check('a healthy door is called exactly once', ok4.trail === 'door:200', ok4.trail);
const ok5 = await run(real, [404]);
check('a missing door (404, local build) goes direct at once — no pointless wait', ok5.trail === 'door:404 direct:200', ok5.trail);

const noRetry = real.replace('() => pause().then(viaDoor).then((again) => settle(again, true), () => direct(\'net\')));', "() => direct('net'));");
mustCatch('the old «blip → back door» behaviour', (await run(noRetry, ['net', 200])).trail !== 'door:net door:200');
const loops = real.replace('if (!retried && doorHiccup(r.status))', 'if (doorHiccup(r.status))');
mustCatch('a door that retries forever on 503', (await run(loops, [503, 503, 503, 200])).trail === 'door:503 door:503 door:503 door:200');

if (failed) { console.error(`\n❌ verify-front-door-retries-itself: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-front-door-retries-itself: a blip retries the door once before the back door, and never loops.');
