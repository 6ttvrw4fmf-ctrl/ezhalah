// OUR FRONT DOOR IS OUR BACKEND ON EVERY HOST WE SERVE (falcon 2026-10-30).
//
// The site moved to ezhalah.com on 2026-10-26, and two live robots still recognised the front door only as
// `https://ezhalah-app.vercel.app/sb/rest/v1/…`: verify-combined-budget-live.ts failed «the browser talked to the
// expected backend» with «origins seen: https://ezhalah.com» on a correct production, on every real
// af-live-truth-check run for four days. This barrier EXECUTES the shared predicate (scripts/lib/frontDoorHosts.ts)
// and DISCOVERS by shape any script that pins the front door to one host again.
//   node --experimental-strip-types scripts/verify-front-door-is-recognised-on-every-host.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isFrontDoorUrl, isOurRpcUrl } from './lib/frontDoorHosts.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const SB = 'https://aannarbkwcymrotzwdbo.supabase.co';
const RPC = '/sb/rest/v1/rpc/location_search_candidates_ar';

// 1. The predicate, executed.
check('the front door is our backend on ezhalah.com, www and the old address',
  isFrontDoorUrl(`https://ezhalah.com${RPC}`) && isFrontDoorUrl(`https://www.ezhalah.com${RPC}`)
  && isFrontDoorUrl(`https://ezhalah-app.vercel.app${RPC}`));
check('a foreign host, a preview, plain http or another path is never our backend',
  !isFrontDoorUrl(`https://evil.example${RPC}`) && !isFrontDoorUrl(`https://ezhalah-app-git-x.vercel.app${RPC}`)
  && !isFrontDoorUrl(`http://ezhalah.com${RPC}`) && !isFrontDoorUrl('https://ezhalah.com/agent') && !isFrontDoorUrl('not a url'));
check('an RPC is ours through the project origin or the front door, and nothing else',
  isOurRpcUrl(`${SB}/rest/v1/rpc/x`, SB) && isOurRpcUrl(`https://ezhalah.com${RPC}`, SB)
  && !isOurRpcUrl(`https://ezhalah.com/sb/rest/v1/search_listings_ar`, SB) && !isOurRpcUrl('https://other.supabase.co/rest/v1/rpc/x', SB));

// 2. Mutation proof: the predicate the two robots used before this fix.
const OLD_BASE = 'https://ezhalah-app.vercel.app';
const oldPredicate = (u: string) => u.startsWith(`${OLD_BASE}/sb/rest/v1/`);
mustCatch('the old single-host predicate (it reads production on ezhalah.com as a foreign backend)',
  !oldPredicate(`https://ezhalah.com${RPC}`) && isFrontDoorUrl(`https://ezhalah.com${RPC}`));
const widened = (u: string) => u.includes('/sb/rest/v1/');
mustCatch('a predicate widened to any host (a preview or another site would read as production)',
  widened(`https://evil.example${RPC}`) && !isFrontDoorUrl(`https://evil.example${RPC}`));

// 3. Discovered by shape: no script or robot pins the front door to one host again.
const PINNED = /startsWith\(\s*`\$\{[A-Z_]+\}\/sb\/rest\/v1|`\$\{BASE\}\/sb\/rest\/v1\/rpc\/`/;
const files = [
  ...readdirSync(join(root, 'scripts')).filter((n) => /\.(ts|mjs)$/.test(n)).map((n) => join('scripts', n)),
  ...readdirSync(join(root, 'e2e'), { recursive: true }).map(String).filter((n) => /\.(ts|mjs|js)$/.test(n)).map((n) => join('e2e', n)),
].filter((f) => !f.endsWith('verify-front-door-is-recognised-on-every-host.ts'));
const pinned = files.filter((f) => PINNED.test(readFileSync(join(root, f), 'utf8')));
check('no robot recognises the front door on one host only (use isFrontDoorUrl / isOurRpcUrl)', pinned.length === 0, pinned.join(', '));
mustCatch('the shape the combined-budget robot carried before the fix',
  PINNED.test("searchOrigins.add(url.startsWith(`${BASE}/sb/rest/v1/`) ? A : B)"));
mustCatch('the shape the agent CTA robot carried before the fix',
  PINNED.test("const RPC_PREFIXES = [`${RPC_ORIGIN}/rest/v1/rpc/`, `${BASE}/sb/rest/v1/rpc/`];"));

if (failed) { console.error(`\n✗ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ the front door reads as our backend on every host we serve, and no robot pins it to one');
