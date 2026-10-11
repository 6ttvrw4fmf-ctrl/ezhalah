// THE LAPTOP PROPERTY CARD IS PHOTO-FIRST, AND ONLY THE LAPTOP (owner 2026-10-11).
//
// What was decided: on the laptop (web, ≥1024px) a result card is a big photo on top, then the price with
// a GOLD «اضغط هنا» button across from it and a short note under it («للتأكد من التوفر والتفاصيل»), the
// location, the property TYPE (its own Filter icon) before the rooms/baths/size, the chips (the Advanced-
// Filter picks lit first), the source's own small facts, and the source's logo. Cards sit 3 across (2
// across when the ad pane is open). Pressing the photo OR the gold button opens the ad AND plays a
// golden-buzzer flash + confetti. «Only the property card — nothing else, laptop only.»
//
// What must hold (each one has a mutation proof below):
//   1. the phone/tablet card is untouched: the laptop layout lives ONLY behind `if (row)`;
//   2. pressing opens the ad FIRST, synchronously — never behind a timer or an animation (a delayed
//      window.open is popup-blocked; and the nav barrier forbids animation-gated hand-offs);
//   3. the photo AND the gold button both call that one handler;
//   4. no per-card forever-animation (a grid of hundreds of cards): the button is `idle={false}`;
//   5. the buzzer is decoration: reduced motion draws nothing, the layer is removed by a timer, no
//      `.start(callback)`, no Math.random;
//   6. the type comes BEFORE the rooms, with its own icon from the Filter's icon map;
//   7. the Advanced-Filter picks are the ones lit (✓), driven by `pickedFeatures`;
//   8. colours come from the theme (no raw hex in the new code);
//   9. the grid is a web-only CSS grid: 3 across only when nothing is open beside, otherwise 2;
//  10. the new copy exists in Arabic.
//   node --experimental-strip-types scripts/verify-laptop-photo-card.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const CARD = read('src/components/ResultCard.tsx');
const BUZZ = read('src/components/CardBuzzer.tsx');
const GRID = read('src/components/ResultCardGrid.tsx');
const AGENT = read('src/app/agent.tsx');
const I18N = read('src/i18n.tsx');
const RESP = read('src/lib/responsive.ts');

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

const laptopBlock = (src: string): string => {
  const a = src.indexOf('  if (row) {');
  const b = src.indexOf('Keep the linked photo above a content-sized body on every screen.');
  return a >= 0 && b > a ? src.slice(a, b) : '';
};
const lpStyles = (src: string): string => {
  const a = src.indexOf('LAPTOP PHOTO-FIRST CARD (owner 2026-10-11) ───\n');
  const b = src.indexOf('// MIDDLE: property info');
  return a >= 0 && b > a ? src.slice(a, b) : '';
};

const rules = (card: string, buzz: string, grid: string, agent: string, i18n: string, resp: string): Record<string, boolean> => {
  const lp = laptopBlock(card);
  const styles = lpStyles(card);
  return {
    'the laptop layout is ONLY behind `if (row)`; the phone card (photoColMobile) is still below it':
      lp.length > 500 && card.indexOf('  if (row) {') < card.indexOf('photoColMobile') && /row \? \[card\.photoColRow/.test(card),
    'press = open FIRST, synchronously: const fire = () => { onOpen(); setBurst(…) } — no timer, no animation':
      /const fire = \(\) => \{ onOpen\(\); setBurst\(\(b\) => b \+ 1\); \};/.test(lp),
    'the photo AND the gold button both press the same handler':
      /<Pressable onPress=\{fire\} accessibilityRole="link"/.test(lp) && /<GoldShineButton idle=\{false\} onPress=\{fire\}/.test(lp),
    'no per-card forever-animation: the gold button is idle={false}, and GoldShineButton honours it':
      /idle=\{false\}/.test(lp) && /\{idle \? <ShineSweep \/> : null\}/.test(read('src/components/CardReveal.tsx')),
    'the buzzer is decoration: reduced motion draws nothing; removed by a timer; no .start(callback); no Math.random':
      /if \(!live \|\| reduced\) return null;/.test(buzz) && /setTimeout\(\(\) => setLive\(false\)/.test(buzz)
      && !/\.start\(\s*\(/.test(buzz) && !/Math\.random/.test(buzz),
    'the buzzer layer mounts inside the laptop card and the card bumps `burst`':
      /<BuzzLayer burst=\{burst\} \/>/.test(lp),
    'the TYPE (with its Filter icon) comes before the rooms in the main line':
      lp.indexOf('style={card.lpType}') > 0 && lp.indexOf('style={card.lpType}') < lp.indexOf('listing.beds > 0 ? <Stat') && /typeImg\(listing\.cleanType/.test(lp),
    'the Advanced-Filter picks are the lit chips (✓), driven by pickedFeatures':
      /pickedFeatures\.has\(f\.key\)/.test(lp) && /name="checkmark"/.test(lp) && /card-feature-picked-/.test(lp),
    'the «مطابق لطلبك» evidence strip is kept, never truncated':
      /card-af-evidence/.test(lp) && /evidence\.map/.test(lp),
    'the source facts (additional info) and the source logo are kept':
      /<AdditionalInformationPanel listing=\{listing\}/.test(lp) && /<SourceBadge source=\{listing\.source\} \/>/.test(lp),
    'price truth is kept: derived-total equation, per-metre line, stay-length note, rating, RNPL':
      /derivedTotalEquation/.test(lp) && /pricePerMeter/.test(lp) && /isStayLengthPriced|stay \?/.test(lp) && /ratingVal/.test(lp) && /RnplBanner/.test(lp),
    'new styles and the buzzer use theme colours only (no raw hex)':
      styles.length > 200 && !/#[0-9a-fA-F]{3,8}\b/.test(styles) && !/#[0-9a-fA-F]{3,8}\b/.test(buzz),
    'ResultCardGrid: a web-only CSS grid; 3 across may run past 940 but never past the screen':
      /Platform\.OS === 'web' && !!cols/.test(grid) && /repeat\(3, minmax\(0, 1fr\)\)/.test(grid) && /repeat\(2, minmax\(0, 1fr\)\)/.test(grid) && /calc\(100vw - 340px\)/.test(grid),
    'agent.tsx: 3 across only when nothing is open beside the results and the screen is wide':
      /const cardCols = viewerSplit \? \(\(adPaneBeside \|\| !cardsThreeAcross\) \? 2 as const : 3 as const\) : undefined;/.test(agent)
      && /<ResultCardGrid wide=\{viewerSplit\} cols=\{cardCols\}>/.test(agent) && /CARDS_THREE_ACROSS_BREAKPOINT = 1360/.test(resp),
    'the new copy exists in Arabic':
      /'To confirm availability and details':\s*'للتأكد من التوفر والتفاصيل'/.test(i18n) && /'See \{n\} more':\s*'عرض \{n\} أخرى'/.test(i18n),
  };
};

const real = rules(CARD, BUZZ, GRID, AGENT, I18N, RESP);
for (const [label, ok] of Object.entries(real)) check(label, ok);

// ── mutation proofs: each broken shape must trip exactly its rule ───────────────────────────────────
const mustCatch = (what: string, rule: string, broken: Record<string, boolean>) => {
  const caught = broken[rule] === false;
  if (!caught) failed++;
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${what}`);
};
const R_OPEN = 'press = open FIRST, synchronously: const fire = () => { onOpen(); setBurst(…) } — no timer, no animation';
mustCatch('opening the ad behind a timer (popup-blocked window.open)', R_OPEN,
  rules(CARD.replace('const fire = () => { onOpen(); setBurst((b) => b + 1); };', 'const fire = () => { setBurst((b) => b + 1); setTimeout(onOpen, 400); };'), BUZZ, GRID, AGENT, I18N, RESP));
mustCatch('the photo no longer pressing the shared handler', 'the photo AND the gold button both press the same handler',
  rules(CARD.replace('<Pressable onPress={fire} accessibilityRole="link"', '<Pressable onPress={onOpen} accessibilityRole="link"'), BUZZ, GRID, AGENT, I18N, RESP));
mustCatch('a looping glint on every card', 'no per-card forever-animation: the gold button is idle={false}, and GoldShineButton honours it',
  rules(CARD.replace('<GoldShineButton idle={false} onPress={fire}', '<GoldShineButton onPress={fire}'), BUZZ, GRID, AGENT, I18N, RESP));
mustCatch('the buzzer ignoring reduced motion', 'the buzzer is decoration: reduced motion draws nothing; removed by a timer; no .start(callback); no Math.random',
  rules(CARD, BUZZ.replace('if (!live || reduced) return null;', 'if (!live) return null;'), GRID, AGENT, I18N, RESP));
mustCatch('a Math.random confetti', 'the buzzer is decoration: reduced motion draws nothing; removed by a timer; no .start(callback); no Math.random',
  rules(CARD, BUZZ + '\nconst x = Math.random();', GRID, AGENT, I18N, RESP));
mustCatch('the type icon row gone from the main line', 'the TYPE (with its Filter icon) comes before the rooms in the main line',
  rules(CARD.replace('<View style={card.lpType}>', '<View style={card.lpTypeGone}>'), BUZZ, GRID, AGENT, I18N, RESP));
mustCatch('the AF picks no longer lit', 'the Advanced-Filter picks are the lit chips (✓), driven by pickedFeatures',
  rules(CARD.replace('const picked = pickedFeatures.has(f.key);\n                return (\n                  <View key={f.key} style={[card.lpChip', 'const picked = false;\n                return (\n                  <View key={f.key} style={[card.lpChip'), BUZZ, GRID, AGENT, I18N, RESP));
mustCatch('a raw hex colour in the buzzer', 'new styles and the buzzer use theme colours only (no raw hex)',
  rules(CARD, BUZZ.replace('colors.goldLight, colors.goldDeep', "'#ffd966', colors.goldDeep"), GRID, AGENT, I18N, RESP));
mustCatch('a 3-across grid that ignores the open ad pane', 'agent.tsx: 3 across only when nothing is open beside the results and the screen is wide',
  rules(CARD, BUZZ, GRID, AGENT.replace('(adPaneBeside || !cardsThreeAcross) ? 2 as const : 3 as const', '!cardsThreeAcross ? 2 as const : 3 as const'), I18N, RESP));
mustCatch('the grid forced onto native', 'ResultCardGrid: a web-only CSS grid; 3 across may run past 940 but never past the screen',
  rules(CARD, BUZZ, GRID.replace("Platform.OS === 'web' && !!cols", '!!cols'), AGENT, I18N, RESP));
mustCatch('the laptop layout leaking onto the phone card', 'the laptop layout is ONLY behind `if (row)`; the phone card (photoColMobile) is still below it',
  rules(CARD.replace('  if (row) {', '  if (true) {'), BUZZ, GRID, AGENT, I18N, RESP));
mustCatch('the new copy missing in Arabic', 'the new copy exists in Arabic',
  rules(CARD, BUZZ, GRID, AGENT, I18N.replace("'To confirm availability and details': 'للتأكد من التوفر والتفاصيل',", ''), RESP));

console.log(failed === 0 ? '\n✅ the laptop card is photo-first, laptop-only, opens first, and the buzzer is only decoration.\n' : `\n❌ ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
