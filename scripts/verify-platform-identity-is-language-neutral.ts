// PLATFORM IDENTITY MUST BE LANGUAGE-NEUTRAL — owner P0, 2026-09-26.
//
// THE INCIDENT. On production, الرياض / تجاري / بيع matched 21 platforms. All 21 were already in the
// page-0 buffer — pressing «عرض المزيد» fired NO new fetch, it only revealed rows the client was
// already holding. The first screen rendered 10 cards. The missing 11 were exactly the platforms
// whose stored `source` is Arabic: «أبعاد», «نفوذ», «دويليو», «عقاريون», «منصات», «القاسم العقارية»,
// «آي باكس», «ري إنفست», «علم الريادة الإدارية», «أحمد المحيسني العقارية», «العجلان للتسويق العقاري».
//
// THE CAUSE, in one expression. platformDiversity.ts tokenised a platform name with
//   s.toLowerCase().replace(/[^a-z0-9]/g, '')
// a LATIN-ONLY filter. Every Arabic character is outside `a-z0-9`, so an Arabic name became the
// EMPTY STRING, and two separate things broke:
//   1. distinctPlatformCount() skips empty identities — correctly, so a blank `source` cannot invent
//      a slot — so those platforms were NOT COUNTED. initialReveal() sizes the first screen from that
//      count, so they got no first-screen card and surfaced only after «عرض المزيد».
//   2. DOMAIN_BY_PLATFORM is keyed by that token, so 47 of the 120 registry rows collapsed onto ONE
//      `""` key, and rankedKey('platform') gave all 47 websites a single identity — the
//      five-dimension round-robin was balancing 47 different companies as if they were one.
// Both failures pushed the same way: against the smaller, Arabic-named platforms. The owner's rule is
// that every matching platform gets its fair initial slot, so this was the rule inverted.
//
// WHY NO BARRIER CAUGHT IT. verify-initial-batch-covers-platforms.ts covered the count and the
// coverage ordering thoroughly — but it fed itself `p0`, `p1`, `p2`… Invented names are ASCII, and
// ASCII is precisely the half that worked. A barrier that supplies its own input proves nothing; the
// strings below are the REAL `source` values captured off production on 2026-09-26.
//
//   node --experimental-strip-types scripts/verify-platform-identity-is-language-neutral.ts
//   (in `npm test`)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { platformIdentity, distinctPlatformCount, orderByScope } from '../src/lib/platformDiversity.ts';
import { initialReveal } from '../src/lib/initialReveal.ts';
import { PLATFORMS } from '../src/data/platforms.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  if (ok) console.log(`  PASS  ${msg}`);
  else { console.log(`  FAIL  ${msg}${extra ? ` — ${extra}` : ''}`); failed++; }
};
const mustCatch = (name: string, mutate: () => boolean) => {
  // A mutation proof: `mutate` rebuilds the defect and returns TRUE when the check above would have
  // caught it. Proving the check fails on the broken world is the only evidence it is load-bearing.
  check(mutate(), `(mutation) catches ${name}`);
};

// The EXACT production strings. Captured 2026-09-26 from the running app's own card fetch on
// الرياض / تجاري / بيع — 21 platforms, 21 distinct `source` values, 11 Arabic and 10 Latin.
const LIVE_ARABIC_SOURCES = [
  'أبعاد', 'نفوذ', 'دويليو', 'عقاريون', 'منصات', 'القاسم العقارية', 'آي باكس',
  'ري إنفست', 'علم الريادة الإدارية', 'أحمد المحيسني العقارية', 'العجلان للتسويق العقاري',
] as const;
const LIVE_LATIN_SOURCES = [
  'Almotmkenah', 'Muktamel', 'Raghdan', 'Sanadak', 'Deal App', 'Aldarim',
  'Ibrahim Alqarawi', 'KSA Aqar', 'Wasalt', 'Aqar',
] as const;
const LIVE_ALL = [...LIVE_ARABIC_SOURCES, ...LIVE_LATIN_SOURCES];

// The old, broken token — kept ONLY so every check below can be re-run against it. This is the
// defect verbatim; it is never imported by the app.
const brokenToken = (s: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const brokenIdentity = (s: string | null | undefined) => brokenToken(s ?? '');
const brokenDistinctCount = (rows: ReadonlyArray<{ source?: string | null }>) => {
  const seen = new Set<string>();
  for (const r of rows) { const p = brokenIdentity(r?.source); if (p) seen.add(p); }
  return seen.size;
};

// ── 1. NO VALID IDENTITY IS EVER BLANK ────────────────────────────────────────────────────────
// Owner requirement 1. A blank identity is how a real platform becomes invisible to the count.
{
  console.log('\n1. no valid platform identity becomes blank');
  const blankArabic = LIVE_ARABIC_SOURCES.filter((s) => platformIdentity(s) === '');
  check(blankArabic.length === 0, 'every Arabic production source has a non-empty identity',
    blankArabic.join(', '));
  const blankLatin = LIVE_LATIN_SOURCES.filter((s) => platformIdentity(s) === '');
  check(blankLatin.length === 0, 'every Latin production source has a non-empty identity',
    blankLatin.join(', '));
  const blankRegistry = PLATFORMS.filter((p) => platformIdentity(p.name) === '');
  check(blankRegistry.length === 0,
    `all ${PLATFORMS.length} registry platform names produce a non-empty identity`,
    blankRegistry.slice(0, 6).map((p) => `${p.name}(${p.domain})`).join(', '));
  // …and the one property the Latin-only filter DID get right must survive: a source that is
  // genuinely empty, whitespace or punctuation still invents nothing.
  for (const junk of ['', '   ', '\t\n', '،', '-', '– —', '...', '؟!']) {
    check(platformIdentity(junk) === '', `junk source ${JSON.stringify(junk)} stays blank (invents no platform)`);
  }
  check(platformIdentity(null) === '' && platformIdentity(undefined) === '', 'null/undefined stay blank');

  mustCatch('an Arabic name erased to the empty string',
    () => LIVE_ARABIC_SOURCES.some((s) => brokenIdentity(s) === ''));
  mustCatch('47 of the registry erased to the empty string',
    () => PLATFORMS.filter((p) => brokenIdentity(p.name) === '').length >= 40);
}

// ── 2. NO TWO PLATFORMS COLLAPSE INTO ONE IDENTITY ────────────────────────────────────────────
// Owner requirement 2. The mirror image of blanking: if two websites share an identity, the second
// one silently loses its slot in exactly the same way.
{
  console.log('\n2. different platforms do not collapse into one identity');
  check(new Set(LIVE_ARABIC_SOURCES.map(platformIdentity)).size === LIVE_ARABIC_SOURCES.length,
    `the ${LIVE_ARABIC_SOURCES.length} Arabic production sources are ${LIVE_ARABIC_SOURCES.length} distinct identities`);
  check(new Set(LIVE_ALL.map(platformIdentity)).size === LIVE_ALL.length,
    `the full production set of ${LIVE_ALL.length} sources is ${LIVE_ALL.length} distinct identities (mixed Arabic + English)`);

  // Registry-wide: an identity shared by two rows is CORRECT when both rows are the same website
  // (Aqar / Aqar Monthly → sa.aqar.fm, which is the fold this map exists for) and a BUG when the
  // domains differ.
  const domainsById = new Map<string, Set<string>>();
  for (const p of PLATFORMS) {
    const id = platformIdentity(p.name);
    if (!domainsById.has(id)) domainsById.set(id, new Set());
    domainsById.get(id)!.add(p.domain);
  }
  const crossDomain = [...domainsById].filter(([, d]) => d.size > 1);
  check(crossDomain.length === 0, 'no identity is shared by two DIFFERENT domains',
    crossDomain.slice(0, 3).map(([id, d]) => `${id} → ${[...d].join(' + ')}`).join(' | '));
  // The intended fold still works — this rule must not be "read" as "never fold anything".
  const sameDomainFolds = [...domainsById].filter(([, d]) => d.size === 1)
    .filter(([id]) => PLATFORMS.filter((p) => platformIdentity(p.name) === id).length > 1);
  check(sameDomainFolds.length >= 1,
    'two registry rows for ONE website still fold to one identity (the Aqar / Aqar Monthly case is intact)',
    `${sameDomainFolds.length} such fold(s)`);

  mustCatch('47 different websites collapsing onto a single identity', () => {
    const byId = new Map<string, Set<string>>();
    for (const p of PLATFORMS) {
      const id = brokenIdentity(p.name);
      if (!byId.has(id)) byId.set(id, new Set());
      byId.get(id)!.add(p.domain);
    }
    return [...byId].some(([, d]) => d.size > 1);
  });
}

// ── 3. ARABIC NORMALISATION — ONE WEBSITE, ONE IDENTITY, WHATEVER THE SPELLING ────────────────
// The same folding this repo already applies to city names (normLocKey). Without it a scraper that
// stores «أبعاد» and another that stores «ابعاد» would hand ONE website TWO first-screen slots —
// the fairness rule broken in the other direction.
{
  console.log('\n3. Arabic spelling variants fold to one identity');
  const pairs: Array<[string, string, string]> = [
    ['أبعاد', 'ابعاد', 'hamza on alef (أ → ا)'],
    ['إبريزة', 'ابريزة', 'hamza below (إ → ا)'],
    ['آي باكس', 'اي باكس', 'madda (آ → ا)'],
    ['القاسم العقارية', 'القاسم العقاريه', 'ta-marbuta (ة → ه)'],
    ['نُفوذ', 'نفوذ', 'harakat (vocalised vs bare)'],
    ['رﺍﻛﺰ', 'راكز', 'presentation forms fold to the base letters'],
    ['نفوذ', 'نـــفوذ', 'tatweel (ـ) is not a letter'],
    ['ري إنفست', 'ري  إنفست', 'collapsed whitespace'],
    ['عقاريون ', ' عقاريون', 'leading/trailing whitespace'],
    ['عقار٢٤', 'عقار24', 'Arabic-Indic digits fold to ASCII'],
  ];
  for (const [a, b, why] of pairs) {
    check(platformIdentity(a) === platformIdentity(b), `${why}: «${a}» ≡ «${b}»`,
      `${platformIdentity(a)} vs ${platformIdentity(b)}`);
  }
  // …but folding must not go so far that two genuinely different names meet.
  check(platformIdentity('نفوذ') !== platformIdentity('نفوذ العقارية'),
    'a longer distinct name is NOT folded into a shorter one');
  check(platformIdentity('أبعاد') !== platformIdentity('أبعد'),
    'two different Arabic words stay two identities');

  mustCatch('spelling variants that the broken token could not tell apart (both were blank)',
    () => brokenIdentity('أبعاد') === brokenIdentity('أبعد') && brokenIdentity('أبعاد') === '');
}

// ── 4. MIXED ARABIC + ENGLISH: EVERY MATCHING PLATFORM GETS ITS INITIAL SLOT ──────────────────
// Owner requirement 3, executed end-to-end through the REAL functions: count → reveal target →
// ordering. This is the shape the production defect actually took.
{
  console.log('\n4. every matching platform gets its initial fair slot (mixed Arabic + English)');
  const rows = LIVE_ALL.map((source) => ({ source }));
  check(distinctPlatformCount(rows) === 21, 'the production set of 21 sources counts as 21', `got ${distinctPlatformCount(rows)}`);
  const target = initialReveal({ fetched: 1500, honestTotal: 4358, stopAt: 25, platforms: distinctPlatformCount(rows) });
  check(target === 21, 'initialReveal() opens 21 slots for them, not 10', `got ${target}`);

  // The ORDER has to actually put one of each inside that window — a big-inventory platform must not
  // spend the window on itself. Built through the real orderByScope, with the Arabic-named platforms
  // deliberately given the LEAST inventory (one row each), which is when they are easiest to lose.
  const heavy = LIVE_LATIN_SOURCES.flatMap((p, i) =>
    Array.from({ length: 300 }, (_, k) => ({ l: { cleanType: 't' }, platform: p, city: 'c', region: 'r', district: `d${k % 7}`, rank: i * 300 + k, source_table: `${p}_t` })));
  const light = LIVE_ARABIC_SOURCES.map((p, i) => ({ l: { cleanType: 't' }, platform: p, city: 'c', region: 'r', district: 'd', rank: 100000 + i, source_table: `${p}_t` }));
  const ordered = orderByScope([...heavy, ...light], 'city');
  const window = ordered.slice(0, 21).map((r) => platformIdentity(r.platform));
  check(new Set(window).size === 21, 'the first 21 rows are 21 DIFFERENT platforms (no platform repeats inside the window)',
    `${new Set(window).size} distinct`);
  const missing = LIVE_ALL.filter((p) => !window.includes(platformIdentity(p)));
  check(missing.length === 0, 'every one of the 21 platforms appears in the initial window', missing.join(', '));
  const arabicInWindow = LIVE_ARABIC_SOURCES.filter((p) => window.includes(platformIdentity(p)));
  check(arabicInWindow.length === LIVE_ARABIC_SOURCES.length,
    'all 11 Arabic-named platforms are in the window even though each has ONE row against the others’ 300',
    `${arabicInWindow.length}/${LIVE_ARABIC_SOURCES.length}`);
  // The window is a PREFIX of the full order, so nothing it shows can be duplicated or skipped later.
  check(ordered.length === heavy.length + light.length, 'ordering is a permutation — no row invented or dropped');

  mustCatch('the first screen sized to 10 instead of 21 (the measured production defect)', () => {
    const brokenCount = brokenDistinctCount(rows);
    const brokenTarget = initialReveal({ fetched: 1500, honestTotal: 4358, stopAt: 25, platforms: brokenCount });
    return brokenCount === 10 && brokenTarget === 10;
  });
  mustCatch('the 11 Arabic platforms being absent from the initial window', () => {
    const brokenWindowSize = brokenDistinctCount(rows);                 // 10
    const brokenWindow = ordered.slice(0, brokenWindowSize).map((r) => r.platform);
    return LIVE_ARABIC_SOURCES.some((p) => !brokenWindow.includes(p));
  });
}

// ── 5. CALLER PARITY — EVERY RESULTS PATH INHERITS THIS, NONE RE-DERIVES IT ───────────────────
// Owner requirement 4. Filter, Agent and Advanced Filter must not be three fixes; they must be one.
// The proof is structural: there is ONE screen that renders result cards, it derives the platform
// count from ONE shared function, and nothing else counts platforms its own way.
{
  console.log('\n5. every results path inherits the shared logic');
  const srcDir = join(root, 'src');
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  const files = walk(srcDir).filter((f) => /\.tsx?$/.test(f));

  // (a) exactly one screen renders result cards — so there is no second results path to forget.
  //     Matched on the JSX ACTUALLY rendered (`<MemoResultCard`, the memo wrapper) as well as the
  //     bare component: an earlier draft of this check pinned only `<ResultCard` and silently
  //     matched ZERO files, which reads exactly like "more than one" and is just as wrong. Asserting
  //     the count is non-zero below is what makes this check falsifiable rather than decorative.
  const renderers = files
    .filter((f) => /<(Memo)?ResultCard[\s/>]/.test(readFileSync(f, 'utf8')))
    .map((f) => f.replace(root + '/', ''));
  check(renderers.length === 1, 'exactly ONE screen renders result cards (Filter/Agent/AF share it)',
    renderers.length === 0 ? 'matched NO files — the pattern is wrong, not the code' : renderers.join(', '));

  // (b) that screen derives the platform term from the shared counter, never a literal or a local Set.
  const screen = read('src/app/agent.tsx');
  check(/platforms:\s*distinctPlatformCount\(/.test(screen),
    'the screen passes distinctPlatformCount(...) as the platform term — never a literal');
  check(!/platforms:\s*\d+/.test(screen), 'no hardcoded platform count anywhere on the screen');
  const revealWrappers = screen.match(/const initialReveal\s*=/g) ?? [];
  check(revealWrappers.length === 1,
    'the screen has exactly ONE initialReveal wrapper, so every path (Filter, Agent, AF) shares one target',
    `${revealWrappers.length} found`);

  // (c) nobody re-implements the identity. Any OTHER file building a platform set must go through
  //     platformIdentity — a local `new Set(rows.map(r => r.source))` would reintroduce the class
  //     with the opposite failure (case/spelling variants counted as separate platforms).
  const offenders = files
    .filter((f) => !/platformDiversity\.ts$/.test(f))
    .filter((f) => /new Set\([^)]*\.(source|platform)\b/.test(readFileSync(f, 'utf8')))
    .map((f) => f.replace(root + '/', ''));
  check(offenders.length === 0,
    'no file builds its own platform Set — identity is derived in one place only', offenders.join(', '));

  // (d) the class cannot return via a sibling normaliser: no Latin-only character filter survives in
  //     src/. locations.ts and landmarks/index.ts already keep Arabic; this pins that they keep it.
  const latinOnly = files
    .map((f) => [f.replace(root + '/', ''), readFileSync(f, 'utf8')] as const)
    .filter(([, s]) => /replace\(\s*\/\[\^a-z0-9\]\s*\/[gimsuy]*\s*,/.test(s.replace(/^\s*\/\/.*$/gm, '')))
    .map(([f]) => f);
  check(latinOnly.length === 0,
    'no src/ file strips text with a Latin-only [^a-z0-9] filter (the exact defect shape)', latinOnly.join(', '));
}

// ── 6. THE REGISTRY ITSELF STAYS HEALTHY AS IT GROWS ──────────────────────────────────────────
// The roster is heading for ~136 sites and new entries are increasingly Arabic-named. These hold
// whether the next scraper lands tomorrow or in six months.
{
  console.log('\n6. the registry stays healthy as platforms are added');
  const arabicNamed = PLATFORMS.filter((p) => /[؀-ۿ]/.test(p.name));
  check(arabicNamed.length > 0, `the registry really does contain Arabic-named platforms (${arabicNamed.length} of ${PLATFORMS.length}) — this file is not vacuous`);
  check(arabicNamed.every((p) => platformIdentity(p.name) !== ''), 'every Arabic-named registry row has an identity');
  check(new Set(PLATFORMS.map((p) => p.domain)).size === new Set(PLATFORMS.map((p) => platformIdentity(p.name))).size
    || new Set(PLATFORMS.map((p) => platformIdentity(p.name))).size >= new Set(PLATFORMS.map((p) => p.domain)).size,
    'identities are at least as numerous as distinct domains — no website loses its own identity');
  // Idempotence: identifying an identity returns it unchanged, so a value that round-trips through
  // storage or a log can be re-identified without drifting.
  check(LIVE_ALL.every((s) => platformIdentity(platformIdentity(s)) === platformIdentity(s)),
    'platformIdentity is idempotent — re-identifying an identity is a no-op');

  mustCatch('a registry that silently lost its Arabic rows to the tokenizer',
    () => PLATFORMS.filter((p) => /[؀-ۿ]/.test(p.name)).some((p) => brokenIdentity(p.name) === ''));
}

console.log(failed === 0
  ? '\n✅ verify-platform-identity-is-language-neutral: identity is blank-free, collision-free, spelling-stable, and every results path inherits it.'
  : `\n❌ verify-platform-identity-is-language-neutral: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
