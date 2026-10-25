// THE PLATFORM LOGOS ARE CACHED FOR A YEAR AND WARMED BEFORE THE SEARCH NEEDS THEM (owner 2026-10-25: «logos take time to show»).
//
// Two causes, one barrier each.
//  1) HEADERS. Production served every bundled image with `Cache-Control: public, max-age=0, must-revalidate` (the catch-all rule only
//     exempted /_expo/), so a phone re-asked the network for each of ~148 logos on every use. The files under /assets/ carry their content
//     hash in the file name (sa-aqar-fm.<md5>.png), so a changed logo is a NEW url and a year of immutable caching is safe.
//  2) WARMING. src/lib/warmPlatformLogos.ts downloads the logos a few at a time after the page settles and when the search box is touched.
//
//   node --experimental-strip-types scripts/verify-logos-are-cached-and-warmed.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WARM_CONCURRENCY, shouldSkipWarm, warmQueue } from '../src/lib/warmQueue.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const mustCatch = (name: string, caught: boolean) => { if (!caught) failed++; console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${name}`); };

type Rule = { source: string; headers: { key: string; value: string }[] };
const rules = (text: string): Rule[] => (JSON.parse(text) as { headers: Rule[] }).headers;
const vercel = readFileSync(join(root, 'vercel.json'), 'utf8');
const cacheOf = (rs: Rule[], source: string) => rs.find((r) => r.source === source)?.headers.find((h) => h.key === 'Cache-Control')?.value;
// Which Cache-Control a path ends up with: the LAST matching rule that sets one (Vercel applies them in order, later wins).
const effective = (rs: Rule[], path: string): string | undefined => {
  let v: string | undefined;
  for (const r of rs) {
    const re = new RegExp(`^${r.source.replace(/\(\.\*\)/g, '.*')}$`);
    const c = r.headers.find((h) => h.key === 'Cache-Control')?.value;
    if (c && re.test(path)) v = c;
  }
  return v;
};

// ── headers ─────────────────────────────────────────────────────────────────────────────────────
const IMMUTABLE = 'public, max-age=31536000, immutable';
check('a bundled logo is cached for a year, immutable', effective(rules(vercel), '/assets/assets/images/platform-logos/sa-aqar-fm.c6d4cf4bb4fdea1af1272b421b2e7845.png') === IMMUTABLE);
check('the app bundle is still immutable (unchanged)', effective(rules(vercel), '/_expo/static/js/web/entry-abc.js') === IMMUTABLE);
check('the page itself and the root icons still revalidate (an update must reach people)', effective(rules(vercel), '/') === 'public, max-age=0, must-revalidate' && effective(rules(vercel), '/favicon.ico') === 'public, max-age=0, must-revalidate');
check('the catch-all revalidate rule exempts /assets/', /\(\?!_expo\/\|assets\/\)/.test(vercel));
mustCatch('the old catch-all that revalidates every logo', effective(rules(vercel.replace('"/((?!_expo/|assets/).*)"', '"/((?!_expo/).*)"').replace(/\{\s*"source": "\/assets\/\(\.\*\)",[\s\S]*?\]\s*\},/, '')), '/assets/assets/images/platform-logos/x.png') !== IMMUTABLE);
mustCatch('an immutable rule on the page itself (updates would never reach people)', effective(rules(vercel.replace('"source": "/_expo/(.*)"', '"source": "/(.*)"')), '/') === IMMUTABLE);

// ── warming ─────────────────────────────────────────────────────────────────────────────────────
check('data-saver and 2G skip the warm-up; a normal link does not', shouldSkipWarm({ saveData: true }) && shouldSkipWarm({ effectiveType: '2g' }) && shouldSkipWarm({ effectiveType: 'slow-2g' }) && !shouldSkipWarm({ effectiveType: '4g' }) && !shouldSkipWarm(undefined));
let inFlight = 0, peak = 0; const order: number[] = [];
await warmQueue([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], async (n) => { inFlight++; peak = Math.max(peak, inFlight); order.push(n); await new Promise((r) => setTimeout(r, 5)); inFlight--; });
check(`at most ${WARM_CONCURRENCY} downloads in flight, all items done, in order`, peak <= WARM_CONCURRENCY && order.length === 10 && order.join() === '1,2,3,4,5,6,7,8,9,10');
let done = 0;
await warmQueue([1, 2, 3, 4], async (n) => { if (n === 2) throw new Error('boom'); done++; });
check('one failing logo never stops the rest', done === 3);
mustCatch('an unbounded warm-up (everything at once)', (() => { let p = 0, f = 0; const all = Array.from({ length: 10 }, () => { f++; p = Math.max(p, f); return 0; }); return all.length === 10 && p > WARM_CONCURRENCY; })());

// ── wiring ──────────────────────────────────────────────────────────────────────────────────────
const strip = (f: string) => readFileSync(join(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
const layout = strip('src/app/_layout.tsx'), agent = strip('src/app/agent.tsx'), lib = strip('src/lib/warmPlatformLogos.ts');
check('the root layout starts the warm-up a moment after load (web only)', /setTimeout\(warmPlatformLogos, 2500\)/.test(layout) && /Platform\.OS !== 'web'\) return;[\s\S]{0,80}setTimeout\(warmPlatformLogos/.test(layout));
check('touching the search box warms them too (free if already started), without touching the focus handler the intro barrier pins', /useEffect\(\(\) => \{ if \(composerFocused\) warmPlatformLogos\(\); \}, \[composerFocused\]\);/.test(agent) && /onFocus=\{\(\) => \{ setComposerFocused\(true\); setIntroInteracted\(true\); \}\}/.test(agent));
check('the warm-up runs once per page load and only on web', /if \(started \|\| Platform\.OS !== 'web'/.test(lib) && /started = true;/.test(lib));
check('the loader roster is warmed first', /\[\.\.\.PLATFORM_META\.map\(\(p\) => p\.logo\), \.\.\.Object\.values\(PLATFORM_PICKER_PROFILES\)/.test(lib));

console.log(failed ? `\n${failed} FAILED` : '\nlogo caching + warm-up: all checks passed');
process.exit(failed ? 1 : 0);
