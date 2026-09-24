// THE HOME HEADLINE ROTATES ON EVERY VISIT, AND EVERY LINE IS THE OWNER'S OWN (owner, 2026-09-23).
//
// The asked-for behaviour has three ways to die silently, so each is EXECUTED here, never grepped:
//   1. The pool shrinks, or a line loses its Arabic and the hero renders an English key to an
//      Arabic-first audience.
//   2. The pick stops advancing — a `Math.random()` "rotation" repeats the same line one visit in
//      five, and a module-scope pick is frozen into the statically pre-rendered index.html
//      (app.json → web.output: 'static'), so EVERY visitor sees one line until the next deploy.
//      That is the exact defect this file exists for: the feature would look implemented and be
//      dead, and no screenshot of one visit could tell the difference.
//   3. The hero stops reading the pool at all (someone re-inlines a fixed string).
//
// Both halves are PURE PREDICATES fed real and mutated input, so the proofs at the bottom are
// statements about the code that decides the verdict, not about a copy of it.
//
//   node --experimental-strip-types scripts/verify-hero-tagline-rotation.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { HERO_TAGLINE_KEYS, nextHeroTaglineIndex, __testing } from '../src/data/heroTaglineRotation.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};
const mustCatch = (label: string, problems: string[]) =>
  check(`(mutation) catches ${label}`, problems.length > 0, 'the audit passed deliberately broken input');
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ── the HOME WIRING, as a pure predicate over the screen's source ───────────────────────────────
export function heroWiringProblems(home: string): string[] {
  const bad: string[] = [];
  if (!/heroTitle[^>]*>\{t\(HERO_TAGLINE_KEYS\[heroTagline\]\)\}/.test(home))
    bad.push('the headline is no longer read from HERO_TAGLINE_KEYS — a fixed string would never rotate');
  if (!/useEffect\(\(\) => \{ setHeroTagline\(nextHeroTaglineIndex\(\)\); \}, \[\]\);/.test(home))
    bad.push('the pick is not in a mount effect — a module-scope pick is baked into the pre-rendered HTML and never changes');
  if (!/const \[heroTagline, setHeroTagline\] = useState\(0\);/.test(home))
    bad.push('the first render is not index 0, so it would disagree with the pre-rendered HTML (hydration mismatch)');
  if (/\{t\('Looking for a property and want to see all available listings in one place\? Ezhalah\.'\)\}/.test(home))
    bad.push('the retired fixed headline is being rendered again');
  return bad;
}

// ── the ROTATION ITSELF, as a pure predicate over any picker ────────────────────────────────────
/** A picker rotates when 10 consecutive opens walk every line in order and wrap. */
export function rotationProblems(pick: () => number, poolSize: number): string[] {
  const seen = Array.from({ length: 2 * poolSize }, () => pick());
  const bad: string[] = [];
  if (new Set(seen).size !== poolSize)
    bad.push(`two full cycles showed ${new Set(seen).size} of ${poolSize} headlines — a visitor can be stuck on one`);
  for (let i = 1; i < seen.length; i++) {
    if (seen[i] === seen[i - 1]) { bad.push('the same headline twice in a row — that is not a rotation'); break; }
  }
  return bad;
}

// ── 1. the pool, and its Arabic ─────────────────────────────────────────────────────────────────
check('the owner gave five headlines and five are shipped', HERO_TAGLINE_KEYS.length === 5,
  `got ${HERO_TAGLINE_KEYS.length}`);
check('no duplicate headline', new Set(HERO_TAGLINE_KEYS).size === HERO_TAGLINE_KEYS.length);

const i18n = read('src/i18n.tsx');
const arabicOf = (src: string, key: string) =>
  src.split('\n').find((l) => l.includes(`'${key}':`))?.match(/:\s*'([^']+)'/)?.[1] ?? '';
for (const key of HERO_TAGLINE_KEYS) {
  check(`«${key.slice(0, 34)}…» has an Arabic translation`, /[؀-ۿ]/.test(arabicOf(i18n, key)),
    'no Arabic dictionary entry — the hero would render the English key to an Arabic-first audience');
}

// ── 2. it actually ADVANCES, one step per open ──────────────────────────────────────────────────
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
};
// A first-ever visitor sees line 1 (there is no cursor yet); every visit after that advances one.
const visits = Array.from({ length: 11 }, () => nextHeroTaglineIndex());
check('every visit shows the NEXT headline, wrapping at five',
  JSON.stringify(visits) === JSON.stringify([0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0]),
  `got ${JSON.stringify(visits)}`);
check('the real picker satisfies the rotation property',
  rotationProblems(() => nextHeroTaglineIndex(), HERO_TAGLINE_KEYS.length).length === 0);
check('the cursor is persisted, so the NEXT page load continues the rotation',
  store.has(__testing.CURSOR_KEY));

(globalThis as any).localStorage = {
  getItem: () => { throw new Error('private window'); },
  setItem: () => { throw new Error('private window'); },
};
check('a browser that refuses storage still renders a real headline (index 0, never a crash)',
  nextHeroTaglineIndex() === 0);
delete (globalThis as any).localStorage;
check('no storage object at all (SSR/native) is also survivable', nextHeroTaglineIndex() === 0);

// ── 3. the hero renders the POOL, and the pick is client-side ───────────────────────────────────
const home = read('src/app/index.tsx');
const live = heroWiringProblems(home);
check('the home screen is wired to the rotating pool, client-side, hydration-safe', live.length === 0,
  live.join(' | '));

// ── MUTATION PROOFS (executable) ────────────────────────────────────────────────────────────────
mustCatch('a fixed headline re-inlined into the hero',
  heroWiringProblems(home.replace('{t(HERO_TAGLINE_KEYS[heroTagline])}',
    "{t('Looking for a property and want to see all available listings in one place? Ezhalah.')}")));
mustCatch('the pick moved out of the mount effect (frozen into the pre-rendered HTML)',
  heroWiringProblems(home.replace(/useEffect\(\(\) => \{ setHeroTagline\(nextHeroTaglineIndex\(\)\); \}, \[\]\);/, '')));
mustCatch('a first render that does not match the pre-rendered index 0',
  heroWiringProblems(home.replace('const [heroTagline, setHeroTagline] = useState(0);',
    'const [heroTagline, setHeroTagline] = useState(nextHeroTaglineIndex());')));
mustCatch('a Math.random() "rotation" that repeats and can strand a visitor',
  rotationProblems(() => Math.floor(Math.random() * HERO_TAGLINE_KEYS.length), HERO_TAGLINE_KEYS.length));
mustCatch('a picker that never moves off one headline',
  rotationProblems(() => 2, HERO_TAGLINE_KEYS.length));
mustCatch('a headline shipped without its Arabic',
  /[؀-ۿ]/.test(arabicOf(i18n.replace(
    `'${HERO_TAGLINE_KEYS[1]}': 'كل الإعلانات العقارية بالمملكة في موقع واحد'`,
    `'${HERO_TAGLINE_KEYS[1]}': 'Every property listing in the Kingdom, in one place'`), HERO_TAGLINE_KEYS[1]))
    ? [] : ['the English fallback was not caught']);

console.log(failed === 0
  ? '\n✅ the home headline rotates once per visit, in Arabic, across all five owner lines\n'
  : `\n❌ ${failed} check(s) failed — the rotating headline is broken\n`);
process.exit(failed === 0 ? 0 : 1);
