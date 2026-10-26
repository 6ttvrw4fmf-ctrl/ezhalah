// THE OLD ADDRESS FORWARDS TO ezhalah.com (owner 2026-10-26: «ezhalah.com is the final»).
//
// vercel.json sends every page of ezhalah-app.vercel.app to the same path on https://ezhalah.com, EXCEPT the
// front door (/sb/...) and the API (/api/...): a tab opened before the switch keeps loading data instead of
// having its database calls bounced to another host. The deploy guard checks ezhalah.com for the same reason
// (scripts/deploy-target-guard.sh). EXECUTES the redirect's own pattern against real paths; mutations prove it.
//   node --experimental-strip-types scripts/verify-old-address-forwards-to-ezhalah-com.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
type Redirect = { source: string; destination: string; permanent?: boolean; has?: { type: string; value: string }[] };
const cfg = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as { redirects?: Redirect[] };
const guard = readFileSync(join(root, 'scripts/deploy-target-guard.sh'), 'utf8');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const OLD = 'ezhalah-app.vercel.app';
const findForward = (rs: Redirect[] | undefined) => (rs ?? []).find((r) => r.has?.some((h) => h.type === 'host' && h.value === OLD));
// The source is «/:path(<regex>)»: test the regex part against a path without its leading slash.
const forwards = (r: Redirect | undefined, path: string) => {
  const m = r && /^\/:path\((.*)\)$/.exec(r.source);
  return !!m && new RegExp(`^(?:${m[1]})$`).test(path.replace(/^\//, ''));
};
const good = (r: Redirect | undefined) => !!r && r.destination === 'https://ezhalah.com/:path'
  && forwards(r, '/') && forwards(r, '/agent') && forwards(r, '/s/HvJnnVKT') && forwards(r, '/og-image-v7.png')
  && !forwards(r, '/sb/rest/v1/search_listings_ar') && !forwards(r, '/api/human');

const fwd = findForward(cfg.redirects);
check('every page of the old address forwards to the same path on ezhalah.com; /sb/ and /api/ stay put', good(fwd), JSON.stringify(fwd));
check('the forward is listed FIRST, before any other redirect can answer the old host', cfg.redirects?.[0] === fwd);
check('the deploy guard proves ezhalah.com serves the new bundle', /DTG_CANONICAL_URL="https:\/\/ezhalah\.com"/.test(guard));

mustCatch('a forward that swallows the front door (open tabs lose their data)', !good({ ...fwd!, source: '/:path(.*)' }));
mustCatch('a forward to the wrong place', !good({ ...fwd!, destination: 'https://ezhalah.com/' }));
mustCatch('the forward removed', !good(findForward(cfg.redirects?.filter((r) => r !== fwd))));
mustCatch('the deploy guard still reading the old address', !/DTG_CANONICAL_URL="https:\/\/ezhalah\.com"/.test(guard.replace('https://ezhalah.com"', 'https://ezhalah-app.vercel.app"')));

if (failed) { console.error(`\n❌ verify-old-address-forwards-to-ezhalah-com: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-old-address-forwards-to-ezhalah-com: the old address forwards to ezhalah.com, the data door stays put.');
