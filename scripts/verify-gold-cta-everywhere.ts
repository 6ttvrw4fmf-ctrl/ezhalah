// THE GOLD «اضغط هنا» BUTTON SHINES ON EVERY CARD, AND EVERY PRESS THROWS A PARTY (owner 2026-10-12).
//
// «What determines our success is traffic to those websites.» So the card's call-to-action is a gold button
// that shines, with the note «للتأكد من التوفر والتفاصيل» under it — on the phone card and the laptop rows alike
// (the layout itself is the one the owner called perfect: unchanged). A press anywhere on the card — photo,
// button, details — opens the ad FIRST and then plays the golden-buzzer flash + confetti.
//
// What must hold (each rule has a mutation proof below):
//   1. the photo strip carries GoldShineButton shine="css" + 'Click here 👆' + the note, on every layout;
//   2. the press opens the ad FIRST, synchronously: `const fire = () => { onOpen(); setBurst(…) }` — a delayed
//      window.open is popup-blocked, and the nav barrier forbids animation-gated hand-offs;
//   3. the photo press AND the details press both use `fire`;
//   4. the buzzer layer is mounted on EVERY card (not only a laptop row);
//   5. the old layouts are intact: the laptop row branch (photoColRow) and the phone card (photoColMobile) remain,
//      and the 2026-10-11 photo-first laptop block is gone;
//   6. the shine is a pure CSS keyframe (no worklet per card) and draws nothing under reduced motion;
//   7. the buzzer is decoration: reduced motion draws nothing, a timer removes it, no .start(callback), no Math.random;
//   8. the new styles use theme colours only; the note exists in Arabic.
//   node --experimental-strip-types scripts/verify-gold-cta-everywhere.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const CARD = read('src/components/ResultCard.tsx');
const BUZZ = read('src/components/CardBuzzer.tsx');
const REVEAL = read('src/components/CardReveal.tsx');
const I18N = read('src/i18n.tsx');

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

const ctaStyles = (card: string) => {
  const a = card.indexOf('// gold CTA + note inside the photo strip');
  const b = card.indexOf('// MIDDLE: property info');
  return a >= 0 && b > a ? card.slice(a, b) : '';
};

const rules = (card: string, buzz: string, reveal: string, i18n: string): Record<string, boolean> => ({
  'the photo strip carries the gold shining button + «Click here 👆» + the note, on every layout':
    /<GoldShineButton shine="css" style=\{\[card\.goldCta, row && card\.goldCtaRow\]\} testID="card-open-gold">\s*<Text[^>]*>\{t\('Click here 👆'\)\}<\/Text>\s*<\/GoldShineButton>\s*<Text style=\{\[card\.ctaNote, row && card\.ctaNoteRow\]\}>\{t\('To confirm availability and details'\)\}<\/Text>/.test(card),
  'press = open FIRST, synchronously: const fire = () => { onOpen(); setBurst(…) }':
    /const fire = \(\) => \{ onOpen\(\); setBurst\(\(b\) => b \+ 1\); \};/.test(card),
  'the photo press AND the details press both use fire':
    /<Pressable onPress=\{fire\} accessibilityRole="link"/.test(card) && /<Pressable onPress=\{fire\} style=\{\[card\.midCol/.test(card),
  'the buzzer layer is mounted on EVERY card':
    /\n      <BuzzLayer burst=\{burst\} \/>\n/.test(card) && !/row \? <BuzzLayer/.test(card),
  'the old layouts are intact (laptop row + phone card) and the photo-first laptop block is gone':
    /row \? \[card\.photoColRow/.test(card) && /photoColMobile/.test(card) && !/row === 'roomy'/.test(card) && !/lpWrap/.test(card),
  'the shine is a CSS keyframe behind shine="css", nothing under reduced motion':
    /shine === 'css' \? <CssShine \/>/.test(reveal) && /function CssShine\(\) \{\s*const reduced = useReducedMotion\(\);\s*if \(reduced \|\| Platform\.OS !== 'web'\) return null;/.test(reveal) && /animationIterationCount: 'infinite'/.test(reveal),
  'the buzzer is decoration: reduced motion draws nothing; removed by a timer; no .start(callback); no Math.random':
    /if \(!live \|\| reduced\) return null;/.test(buzz) && /setTimeout\(\(\) => setLive\(false\)/.test(buzz) && !/\.start\(\s*\(/.test(buzz) && !/Math\.random/.test(buzz),
  'the new styles use theme colours only, and the note exists in Arabic':
    ctaStyles(card).length > 100 && !/#[0-9a-fA-F]{3,8}\b/.test(ctaStyles(card)) && /goldOnFill/.test(ctaStyles(card))
    && /'To confirm availability and details':\s*'للتأكد من التوفر والتفاصيل'/.test(i18n),
});

const real = rules(CARD, BUZZ, REVEAL, I18N);
for (const [label, ok] of Object.entries(real)) check(label, ok);

// ── mutation proofs ───────────────────────────────────────────────────────────────────────────────
const mustCatch = (what: string, rule: string, broken: Record<string, boolean>) => {
  const caught = broken[rule] === false;
  if (!caught) failed++;
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${what}`);
};
mustCatch('a still (non-shining) gold button', 'the photo strip carries the gold shining button + «Click here 👆» + the note, on every layout',
  rules(CARD.replace('<GoldShineButton shine="css"', '<GoldShineButton shine="none"'), BUZZ, REVEAL, I18N));
mustCatch('the note dropped from the strip', 'the photo strip carries the gold shining button + «Click here 👆» + the note, on every layout',
  rules(CARD.replace("{t('To confirm availability and details')}", ''), BUZZ, REVEAL, I18N));
mustCatch('opening the ad behind a timer', 'press = open FIRST, synchronously: const fire = () => { onOpen(); setBurst(…) }',
  rules(CARD.replace('const fire = () => { onOpen(); setBurst((b) => b + 1); };', 'const fire = () => { setBurst((b) => b + 1); setTimeout(onOpen, 300); };'), BUZZ, REVEAL, I18N));
mustCatch('the details press no longer throwing the party', 'the photo press AND the details press both use fire',
  rules(CARD.replace('<Pressable onPress={fire} style={[card.midCol', '<Pressable onPress={onOpen} style={[card.midCol'), BUZZ, REVEAL, I18N));
mustCatch('the buzzer gated to laptop rows only', 'the buzzer layer is mounted on EVERY card',
  rules(CARD.replace('\n      <BuzzLayer burst={burst} />\n', '\n      {row ? <BuzzLayer burst={burst} /> : null}\n'), BUZZ, REVEAL, I18N));
mustCatch('the photo-first laptop block creeping back', 'the old layouts are intact (laptop row + phone card) and the photo-first laptop block is gone',
  rules(CARD.replace('  return (\n    // Keep the linked photo', "  if (row === 'roomy') { return null; }\n  return (\n    // Keep the linked photo"), BUZZ, REVEAL, I18N));
mustCatch('a shine that ignores reduced motion', 'the shine is a CSS keyframe behind shine="css", nothing under reduced motion',
  rules(CARD, BUZZ, REVEAL.replace("if (reduced || Platform.OS !== 'web') return null;", "if (Platform.OS !== 'web') return null;"), I18N));
mustCatch('a Math.random confetti', 'the buzzer is decoration: reduced motion draws nothing; removed by a timer; no .start(callback); no Math.random',
  rules(CARD, BUZZ + '\nconst x = Math.random();', REVEAL, I18N));
mustCatch('a raw hex colour in the CTA styles', 'the new styles use theme colours only, and the note exists in Arabic',
  rules(CARD.replace('goldCtaTx: { color: colors.goldOnFill,', "goldCtaTx: { color: '#2a1d06',"), BUZZ, REVEAL, I18N));
mustCatch('the Arabic note missing', 'the new styles use theme colours only, and the note exists in Arabic',
  rules(CARD, BUZZ, REVEAL, I18N.replace("'To confirm availability and details': 'للتأكد من التوفر والتفاصيل',", '')));

console.log(failed === 0 ? '\n✅ the gold button shines on every card, every press opens the ad first and then throws the party.\n' : `\n❌ ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
