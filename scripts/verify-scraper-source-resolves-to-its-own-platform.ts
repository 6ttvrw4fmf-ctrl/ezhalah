// PERMANENT PR GATE — every `source` string a scraper WRITES must resolve, in all three card
// matchers, to that scraper's own platform — never to عقار's fallback (2026-09-20).
//
// THE DEFECT. scrapers/akariyoun/run.py writes SOURCE = "عقاريون" (Arabic). SourceBadge carried the
// Arabic alias; sourceName and sourceHost tested only the latin slug 'akariyoun' — sourceHost had no
// branch at all. So 280 live عقاريون cards showed عقاريون's logo beside «مستضاف على عقار», the hint
// "takes you to sa.aqar.fm", and Read Aloud saying «عقار»: another company's name on their listings.
//
// WHY NOTHING STOPPED IT. verify-platform-registration-complete.ts only asked about names in
// src/data/platforms.ts — akariyoun was never added there, so it was never asked about. The live
// barrier (verify-platform-identity-matches-live-source.ts) did catch it, but it runs after deploy,
// in a workflow nobody gates on, and it checked sourceHost only. It was red for days.
//
// #3447 (the fix) extended the registration barrier's check 1b to scraper `SOURCE = "…"` constants,
// through its PARSED model of the matchers. That sees 22 of the 61 scraper dirs: the other 39 write
// `"source": "…"` inline or pass `source="…"` (the inblaj platforms). This gate reads all three write
// shapes and EXECUTES the shipped functions, so the two cannot drift apart silently.
//
// SO THIS ONE: the input is what the SCRAPERS write, discovered by shape from scrapers/*/run.py (no
// list to remember to extend), and the matchers are the REAL lifted functions, all three. It runs in
// `npm test`, the required check on every PR, so a platform whose stored name falls through is RED
// before its first listing can go live.
//
// MUTATION-PROVEN. M1 and M2 run on every execution (bottom of this file) against the REAL source
// with the alias cut out; all five were also watched by hand 2026-09-20:
//   M1 drop `|| s.includes('عقاريون')` from sourceName    -> akariyoun: name falls to AQAR
//   M2 drop the akariyoun branch from sourceHost           -> akariyoun: host falls to sa.aqar.fm
//   M3 drop `|| s.includes('عقاريون')` from SourceBadge    -> akariyoun: badge falls to AQAR_LOGO
//   M4 a new scraper dir whose run.py writes no recognised source shape -> discovery check fails
//
//   node --experimental-strip-types scripts/verify-scraper-source-resolves-to-its-own-platform.ts
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftPlatformMatchers, fallbacksOf, MATCHER_KEYS, type Matcher, type Matchers } from './lib/platformMatchers.ts';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = join(import.meta.dirname, '..');
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) { failures++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// Aqar and its own monthly vertical ARE the fallback's identity.
const FALLBACK_OK = new Set(['aqar', 'aqarmonthly']);
// A literal that matches a write shape but is not a listing's source. Each names why.
const NOT_A_SOURCE = new Set([
  'gathern|web', // an HTTP request header in session(), not the stored value (SOURCE = "Gathern")
]);
const SHAPES = [
  /^SOURCE\s*=\s*"([^"]+)"/gm,           // SOURCE = "عقاريون"
  /["']source["']\s*:\s*"([^"]+)"/g,     // "source": "Al Khaas"
  /\bsource\s*=\s*"([^"]+)"/g,           // run_platform(..., source="Al Humaidan") / prune_unseen(source=)
];

const m = await liftPlatformMatchers(ROOT);
const fb = fallbacksOf(m);
// The predicate: every way one stored string can show another company's identity.
const problems = (mm: Matchers, dir: string, s: string): string[] => MATCHER_KEYS.flatMap((k) => {
  const got = mm[k](s);
  return [
    ...(got === fb[k] ? [`${k}("${s}") renders as Aqar's fallback ${got}`] : []),
    // The join is the matcher itself: the stored string and the platform's own slug must land on the
    // same identity (the live barrier's rule, applied to all three matchers).
    ...(got !== mm[k](dir) ? [`${k}("${s}") = ${got} but ${k}("${dir}") = ${mm[k](dir)}`] : []),
  ];
});

check('the fallback is Aqar\'s identity', m.host('aqar') === fb.host && fb.host === 'sa.aqar.fm',
  `fallback host=${fb.host}`);

const dirs = readdirSync(join(ROOT, 'scrapers'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(ROOT, 'scrapers', d.name, 'run.py')))
  .map((d) => d.name);
check('scraper directories discovered', dirs.length > 50, `${dirs.length}`);

let pairs = 0;
for (const dir of dirs) {
  if (FALLBACK_OK.has(dir)) continue;
  const src = readFileSync(join(ROOT, 'scrapers', dir, 'run.py'), 'utf8');
  const sources = new Set<string>();
  for (const re of SHAPES) for (const x of src.matchAll(re)) {
    if (!NOT_A_SOURCE.has(`${dir}|${x[1]}`)) sources.add(x[1]);
  }
  // Fails in the safe direction: a scraper whose write this cannot see is RED, not skipped.
  check(`${dir}: its run.py writes a source string this gate can see`, sources.size > 0);
  for (const s of sources) {
    pairs++;
    for (const p of problems(m, dir, s)) check(`${dir}: ${p}`, false);
  }
}
check('source strings were checked', pairs > 50, `${pairs}`);

// ── mutation proofs: the REAL shipped source with one alias cut out must be caught ────────────────
const mutant = async (file: string, header: string, name: string, cut: string): Promise<Matcher> =>
  (await liftSymbols(join(ROOT, file), [{ header, rewrite: (c) => c.replace(cut, '') }], [name]))[name] as Matcher;
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
mustCatch('sourceName losing its Arabic alias — the 2026-09-20 defect',
  problems({ ...m, name: await mutant('src/lib/listingDisplay.ts', 'export function sourceName', 'sourceName',
    " || s.includes('عقاريون')") }, 'akariyoun', 'عقاريون').length > 0);
mustCatch('sourceHost losing its akariyoun branch',
  problems({ ...m, host: await mutant('src/components/ResultCard.tsx', 'function sourceHost', 'sourceHost',
    "if (s.includes('akariyoun') || s.includes('عقاريون')) return 'akariyoun.sa';") }, 'akariyoun', 'عقاريون').length > 0);

console.log(failures === 0
  ? `✅ verify-scraper-source-resolves-to-its-own-platform: ${pairs} scraper source strings × 3 matchers, none renders as عقار.`
  : `\n✗ verify-scraper-source-resolves-to-its-own-platform: ${failures} check(s) failed — a platform's listings would show عقار's identity.`);
process.exit(failures === 0 ? 0 : 1);
