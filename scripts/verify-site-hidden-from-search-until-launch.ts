// HIDDEN FROM SEARCH ENGINES UNTIL LAUNCH (owner 2026-10-26: «hide it, I want the link to be private for people only»).
//
// Every response carries `X-Robots-Tag: noindex, nofollow`, so Google/Bing never list ezhalah.com while people with
// the link still open it. Deliberately NOT a robots.txt «Disallow: /»: that would stop crawlers from READING the
// noindex (Google can then still list the bare URL) and Twitterbot honours robots.txt, which would kill X link
// previews. WhatsApp / iMessage previews are unaffected: they fetch the page, they do not index it.
// ON LAUNCH DAY: remove the header and this check together (the owner's call, not an agent's).
//   node --experimental-strip-types scripts/verify-site-hidden-from-search-until-launch.ts   (discovered by `npm test`)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
type H = { source: string; headers: { key: string; value: string }[] };
const cfg = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as { headers?: H[] };
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const hidden = (hs: H[] | undefined) => {
  const all = (hs ?? []).find((h) => h.source === '/(.*)');
  const tag = all?.headers.find((x) => x.key.toLowerCase() === 'x-robots-tag')?.value ?? '';
  return /\bnoindex\b/.test(tag);
};
const robotsTxt = ['public/robots.txt', 'dist/robots.txt'].map((p) => join(root, p)).find(existsSync);
const blocksCrawl = (txt: string) => /^\s*disallow:\s*\/\s*$/im.test(txt);

check('every page tells search engines «noindex»', hidden(cfg.headers));
check('no robots.txt «Disallow: /» (crawlers must be able to READ the noindex; X previews need the fetch)',
  !robotsTxt || !blocksCrawl(readFileSync(robotsTxt, 'utf8')));
mustCatch('the header removed before launch', !hidden(cfg.headers?.map((h) => ({ ...h, headers: h.headers.filter((x) => x.key !== 'X-Robots-Tag') }))));
mustCatch('a robots.txt that blocks the crawl instead', blocksCrawl('User-agent: *\nDisallow: /\n'));

if (failed) { console.error(`\n❌ verify-site-hidden-from-search-until-launch: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-site-hidden-from-search-until-launch: search engines are told not to list the site; people with the link still open it.');
