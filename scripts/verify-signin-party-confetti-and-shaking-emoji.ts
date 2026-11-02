// Sign-in party, owner 2026-10-30: «make that 5 seconds 3 seconds … then the message and name … shaking the party emoji,
// i want it to keep blowing … later the fact change … i want the fire works to pop confetti».
//   1. every welcome line carries 🥳 (Arabic AND English), so there is an emoji to shake;
//   2. the headline tags exactly 🥳 as the party emoji, and the app-wide CSS makes it shake on an INFINITE loop
//      (still under prefers-reduced-motion);
//   3. every firework pop is at least half confetti and throws extra slow confetti on top.
// The 3-second timing itself is pinned (with mutations) by verify-eagle-takes-off-every-visit.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const home = read('src/app/index.tsx');
const party = read('src/lib/nameParty.ts');
const welcome = read('src/lib/filterWelcome.ts');

let failed = 0;
const check = (name: string, ok: boolean, info = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !info ? '' : `  (${info})`}`);
  if (!ok) failed++;
};
const mustCatch = (name: string, caught: boolean) => check(`(mutation) catches ${name}`, caught);

// 1. the welcome lines: GREET_LINES rows (id 101…) — every one has 🥳 in both languages
const greetRows = (src: string) => [...src.matchAll(/\{ id: 1\d\d, when: 'any', needs: \[\], ar: '([^']*)', en: '([^']*)' \}/g)];
const allParty = (src: string) => { const r = greetRows(src); return r.length >= 3 && r.every((m) => m[1].includes('🥳') && m[2].includes('🥳')); };
check('every welcome line has 🥳 in Arabic and in English', allParty(welcome), `rows=${greetRows(welcome).length}`);

// 2. the headline tags 🥳 as the party emoji …
const tags = (src: string) => /const PARTY_EMOJI = '🥳';/.test(src)
  && src.includes("dataSet: { ezhEmoji: p === PARTY_EMOJI ? 'party' : '' }")
  && /\{withVisibleEmoji\(welcomeLine \?\? /.test(src);
check('the headline marks 🥳 as the party emoji', tags(home));
// … and the CSS shakes it forever, but not under reduced motion
const shakes = (src: string) => {
  const rule = src.match(/\[data-ezh-emoji="party"\]\{([^}]*)\}/)?.[1] ?? '';
  const name = rule.match(/animation:(\w+) [\d.]+s [\w-]+ infinite/)?.[1];
  return /display:inline-block/.test(rule) && !!name && new RegExp(`@keyframes ${name}\\{[^]*rotate\\(`).test(src);
};
check('🥳 shakes on an infinite loop (inline-block, rotating keyframes)', shakes(party));
const calm = (src: string) => /@media \(prefers-reduced-motion:reduce\)\{[^{]*\[data-ezh-emoji\][^{]*\{animation:none!important/.test(src);
check('…and stands still under prefers-reduced-motion', calm(party));
const loaded = read('src/components/NamePrompt.tsx').includes('useEffect(() => { ensureNameBoxCss(); }, []);') && read('src/app/_layout.tsx').includes('<NamePrompt />');
check('the CSS is loaded app-wide (NamePrompt in the root layout injects it)', loaded);

// 3. fireworks pop into confetti
const confetti = (src: string) => {
  const share = Number(src.match(/export const CONFETTI_SHARE = ([\d.]+);/)?.[1]);
  const extra = Number(src.match(/export const CONFETTI_PER_BURST = (\d+);/)?.[1]);
  return share >= 0.5 && extra >= 20
    && src.includes('kind: Math.random() < CONFETTI_SHARE ? 1 : 0,')
    && /for \(let i = 0; i < CONFETTI_PER_BURST; i\+\+\) \{[^]*?kind: 1,/.test(src);
};
check('every pop is at least half confetti, plus ≥ 20 extra confetti pieces', confetti(party));

// ── mutation proofs ──────────────────────────────────────────────────────────────────────────────────────────
mustCatch('an English welcome line without 🥳', !allParty(welcome.replace(/(en: 'Welcome \{n\}) 🥳/, '$1')));
mustCatch('an Arabic welcome line without 🥳', !allParty(welcome.replace(/(ar: 'نورت \{n\}) 🥳/, '$1')));
mustCatch('the party tag dropped (every emoji plain)', !tags(home.replace("ezhEmoji: p === PARTY_EMOJI ? 'party' : ''", "ezhEmoji: ''")));
mustCatch('the shake playing once instead of forever', !shakes(party.replace(/(\[data-ezh-emoji="party"\]\{[^}]*?) infinite/, '$1 1')));
mustCatch('the shake on an inline span that cannot rotate', !shakes(party.replace('[data-ezh-emoji="party"]{display:inline-block;', '[data-ezh-emoji="party"]{')));
mustCatch('the shake rule removed', !shakes(party.replace('[data-ezh-emoji="party"]{', '[data-ezh-x]{')));
mustCatch('the emoji still shaking under reduced motion', !calm(party.replace('[data-ezh-shine],[data-ezh-emoji]{', '[data-ezh-shine]{')));
mustCatch('confetti back to a third of the shell', !confetti(party.replace('export const CONFETTI_SHARE = 0.5;', 'export const CONFETTI_SHARE = 0.3;')));
mustCatch('the extra confetti removed', !confetti(party.replace('export const CONFETTI_PER_BURST = 24;', 'export const CONFETTI_PER_BURST = 0;')));
mustCatch('the share constant declared but not used', !confetti(party.replace('kind: Math.random() < CONFETTI_SHARE ? 1 : 0,', 'kind: Math.random() < 0.3 ? 1 : 0,')));

if (failed) { console.error(`\n❌ signin-party: ${failed} check(s) failed`); process.exit(1); }
console.log('\n✅ signin-party: fireworks pop into confetti, «نورت {name} 🥳» with the 🥳 shaking nonstop');
