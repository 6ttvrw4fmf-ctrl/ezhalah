// THE LAPTOP PROPERTY CARD IS PHOTO-FIRST, AND ONLY THE LAPTOP (owner 2026-10-11).
//
// What was decided: on the laptop (web, ≥1024px) a result card is a big photo on top, then the price with
// a GOLD «اضغط هنا» button across from it and a short note under it («للتأكد من التوفر والتفاصيل»), the
// location, the property TYPE (its own Filter icon) before the rooms/baths/size, one row of chips (the
// Advanced-Filter picks lit first), and the source's logo — PLAIN and the SAME SIZE on every card
// (owner 2026-10-11, second pass: no long facts, no date, nothing wrapping). Cards sit 3 across (2
// across when the ad pane is open). Pressing the photo OR the gold button opens the ad AND plays a
// golden-buzzer flash + confetti. «Only the property card — nothing else, laptop only.»
//
// What must hold (each one has a mutation proof below):
//   1. the phone/tablet card is untouched: the laptop layout lives ONLY behind `if (row)`;
//   2. pressing opens the ad FIRST, synchronously — never behind a timer or an animation (a delayed
//      window.open is popup-blocked; and the nav barrier forbids animation-gated hand-offs);
//   3. the photo AND the gold button both call that one handler;
//   4. the gold button SHINES on every card, by a pure CSS keyframe (no worklet per card);
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
const OVERLAY = read('src/components/ConfettiOverlay.tsx');
const REVEAL = read('src/components/CardReveal.tsx');
const GRID = read('src/components/ResultCardGrid.tsx');
const AGENT = read('src/app/agent.tsx');
const I18N = read('src/i18n.tsx');
const RESP = read('src/lib/responsive.ts');

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

const laptopBlock = (src: string): string => {
  const a = src.indexOf("  if (row === 'roomy') {");
  const b = src.indexOf('Keep the linked photo above a content-sized body on every screen.');
  return a >= 0 && b > a ? src.slice(a, b) : '';
};
const lpStyles = (src: string): string => {
  const a = src.indexOf('LAPTOP PHOTO-FIRST CARD (owner 2026-10-11) ───\n');
  const b = src.indexOf('// MIDDLE: property info');
  return a >= 0 && b > a ? src.slice(a, b) : '';
};

const rules = (card: string, buzz: string, grid: string, agent: string, i18n: string, resp: string, overlay: string = OVERLAY, reveal: string = REVEAL): Record<string, boolean> => {
  const lp = laptopBlock(card);
  const styles = lpStyles(card);
  return {
    'the photo-first layout is ONLY behind `if (row === \'roomy\')`; the old compact row and the phone card are still below it':
      lp.length > 500 && card.indexOf("  if (row === 'roomy') {") < card.indexOf('photoColMobile') && /row \? \[card\.photoColRow/.test(card),
    'press = open FIRST, synchronously: const fire = () => { onOpen(); if (partyHere) { setBurst(…); partyConfetti() } } — no timer, no animation':
      /const fire = \(\) => \{ onOpen\(\); if \(partyHere\) \{ setBurst\(\(b\) => b \+ 1\); partyConfetti\(\); \} \};/.test(card),
    // Owner 2026-10-17: the party is for the sites that open INSIDE Ezhalah (the in-app viewer list), not every card.
    'the party plays only for a listing that opens inside Ezhalah: inside = inAppViewerHost(listingOpenUrl(listing)); partyHere = IS_WEB && inside':
      /const inside = !!inAppViewerHost\(listingOpenUrl\(listing\)\);/.test(card) && /const partyHere = IS_WEB && inside;/.test(card) && /import \{ inAppViewerHost \} from '@\/lib\/inAppViewer';/.test(card),
    // Owner 2026-10-17: «the golden frame only with the 76 … the rest silver».
    'GOLD = opens inside Ezhalah, SILVER = everything else: tone = inside ? gold : silver, passed to the ring AND both strips; GoldSurface paints silver stops for it':
      /const tone: 'gold' \| 'silver' = inside \? 'gold' : 'silver';/.test(card)
      && (card.match(/<GoldSurface tone=\{tone\} /g) || []).length === 4 && !/<GoldSurface style=/.test(card)
      && /tone === 'silver' \? \[pal\.silverLight, pal\.silverDeep\] : \[pal\.goldLight, pal\.goldDeep\]/.test(reveal),
    // The screen-level party: above the ad sheet/pane, which covers the card\'s own layer on a phone.
    'the ConfettiOverlay is the LAST child of the agent screen (above the AdViewer), and it never takes a tap':
      /<\/AdViewer>|\/>\n    \)\}\n[\s\S]{0,300}<ConfettiOverlay \/>\n    <\/View>\n  \);\n\}/.test(agent)
      // EVERY overlay root (the web Web-Animations layer AND the native Animated layer) never takes a tap.
      && (overlay.match(/testID="confetti-overlay"/g) ?? []).length >= 1
      && (overlay.match(/testID="confetti-overlay"/g) ?? []).length === (overlay.match(/pointerEvents="none" style=\{\[StyleSheet\.absoluteFill, s\.top\]\} testID="confetti-overlay"/g) ?? []).length
      && /if \(!live \|\| reduced\) return null;/.test(overlay) && /setTimeout\(\(\) => setLive\(false\)/.test(overlay) && !/\.start\(\s*\(/.test(overlay) && !/Math\.random/.test(overlay),
    // Owner 2026-10-17: «whenever a user clicks on a listing I want this party confetti … on everything».
    'EVERY card presses the shared handler — the compact row and the phone card too, never onOpen directly':
      !/onPress=\{onOpen\}/.test(card) && /<Pressable onPress=\{fire\} style=\{\[card\.midCol/.test(card),
    'the photo AND the gold button both press the same handler':
      /<Pressable onPress=\{fire\} accessibilityRole="link"/.test(lp) && /<GoldShineButton shine="css" onPress=\{fire\}/.test(lp),
    'the gold button SHINES on every card, by a CSS keyframe (no worklet per card)':
      /shine="css"/.test(lp) && /shine === 'css' \? <CssShine \/>/.test(read('src/components/CardReveal.tsx')) && /animationIterationCount: 'infinite'/.test(read('src/components/CardReveal.tsx')),
    'the buzzer is decoration: reduced motion draws nothing; removed by a timer; no .start(callback); no Math.random':
      /if \(!live \|\| reduced\) return null;/.test(buzz) && /setTimeout\(\(\) => setLive\(false\)/.test(buzz)
      && !/\.start\(\s*\(/.test(buzz) && !/Math\.random/.test(buzz),
    'the buzzer layer mounts in the photo-first card AND unconditionally in the compact/phone card (every layout, owner 2026-10-17)':
      /<BuzzLayer burst=\{burst\} \/>/.test(lp) && /\n      <BuzzLayer burst=\{burst\} \/>\n    <\/View>\n    <\/GoldSurface>\n  \);\n\}/.test(card) && !/\{row \? <BuzzLayer/.test(card),
    // Owner 2026-10-17: «make the frame and this golden shining like a buzzer … for all».
    'EVERY card sits in a shining gold ring and its «اضغط هنا» strip is a shining gold surface (GoldSurface = the gold button\'s gradient + CSS glint)':
      (card.match(/<GoldSurface tone=\{tone\} style=\{card\.goldRing\} testID="card-gold-frame">/g) || []).length === 2
      && /<GoldSurface tone=\{tone\} style=\{\[card\.sourceStrip, row && card\.sourceStripRow\]\} pointerEvents="none" testID="card-gold-strip">/.test(card)
      && /<GoldSurface tone=\{tone\} style=\{card\.lpPhotoFoot\} pointerEvents="none" testID="card-gold-strip">/.test(lp) && /lpPhotoFootTx: \{ color: colors\.goldOnFill/.test(card)
      // GoldSurface must let the caller's `position: absolute` win (the strip sits at the photo's foot): clip first, style second
      && /<View style=\{\[s\.goldClip, style\]\} pointerEvents=\{pointerEvents\} testID=\{testID\}>/.test(reveal)
      && /export function GoldSurface\(/.test(reveal) && /<CssShine \/>/.test(reveal.slice(reveal.indexOf('export function GoldSurface(')))
      && /sourceText: \{ color: colors\.goldOnFill/.test(card) && /photoAction: \{ color: colors\.goldOnFill/.test(card),
    'the TYPE (with its Filter icon) comes before the rooms in the main line':
      lp.indexOf('style={card.lpType}') > 0 && lp.indexOf('style={card.lpType}') < lp.indexOf('listing.beds > 0 ? <Stat') && /typeImg\(listing\.cleanType/.test(lp),
    'the Advanced-Filter picks are the lit chips (✓), driven by pickedFeatures':
      /pickedFeatures\.has\(f\.key\)/.test(lp) && /name="checkmark"/.test(lp) && /card-feature-picked-/.test(lp),
    'the «مطابق لطلبك» evidence strip is kept, never truncated':
      /card-af-evidence/.test(lp) && /evidence\.map/.test(lp),
    'PLAIN + SAME SIZE: no additional-info panel, one title line, one row of ≤3 chips, one fixed facts row of ≤3 source facts; the logo is kept':
      !/AdditionalInformationPanel/.test(lp) && /lpFacts\.length < 3/.test(lp) && /card-lp-facts/.test(lp) && /const CHIP_CAP = 3;/.test(lp)
      && /\[card\.title, card\.lpTitle[^\n]*\n?[^\n]*numberOfLines=\{1\}/.test(lp)
      && /lpChips: \{ flexDirection: 'row', flexWrap: 'nowrap'/.test(styles) && /lpFacts: \{ flexDirection: 'row', flexWrap: 'nowrap'/.test(styles) && !/minHeight/.test(styles) && /<SourceBadge source=\{listing\.source\} \/>/.test(lp),
    'price truth is kept: derived-total equation, per-metre line, stay-length note, rating, RNPL':
      /derivedTotalEquation/.test(lp) && /pricePerMeter/.test(lp) && /isStayLengthPriced|stay \?/.test(lp) && /ratingVal/.test(lp) && /RnplBanner/.test(lp),
    'new styles and the buzzer use theme colours only (no raw hex)':
      styles.length > 200 && !/#[0-9a-fA-F]{3,8}\b/.test(styles) && !/#[0-9a-fA-F]{3,8}\b/.test(buzz),
    'ResultCardGrid: a web-only CSS grid; 3 across may run past 940 but never past the screen':
      /Platform\.OS === 'web' && !!cols/.test(grid) && /repeat\(3, minmax\(0, 1fr\)\)/.test(grid) && /repeat\(2, minmax\(0, 1fr\)\)/.test(grid) && /calc\(100vw - 340px\)/.test(grid),
    'agent.tsx: the photo-first grid only while nothing is open beside the results (the ad pane open = the old compact rows)':
      /const cardCols = viewerSplit && !adPaneBeside \? \(cardsThreeAcross \? 3 as const : 2 as const\) : undefined;/.test(agent)
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
const R_OPEN = 'press = open FIRST, synchronously: const fire = () => { onOpen(); if (partyHere) { setBurst(…); partyConfetti() } } — no timer, no animation';
const FIRE = 'const fire = () => { onOpen(); if (partyHere) { setBurst((b) => b + 1); partyConfetti(); } };';
mustCatch('opening the ad behind a timer (popup-blocked window.open)', R_OPEN,
  rules(CARD.replace(FIRE, 'const fire = () => { if (partyHere) { setBurst((b) => b + 1); partyConfetti(); } setTimeout(onOpen, 400); };'), BUZZ, GRID, AGENT, I18N, RESP));
mustCatch('a card press that forgets the screen-level party', R_OPEN,
  rules(CARD.replace(FIRE, 'const fire = () => { onOpen(); if (partyHere) { setBurst((b) => b + 1); } };'), BUZZ, GRID, AGENT, I18N, RESP));
mustCatch('the party playing for every card again (new-tab and preview sites included)', R_OPEN,
  rules(CARD.replace(FIRE, 'const fire = () => { onOpen(); setBurst((b) => b + 1); partyConfetti(); };'), BUZZ, GRID, AGENT, I18N, RESP));
const R_INSIDE = 'the party plays only for a listing that opens inside Ezhalah: inside = inAppViewerHost(listingOpenUrl(listing)); partyHere = IS_WEB && inside';
mustCatch('the in-app gate replaced by a constant', R_INSIDE,
  rules(CARD.replace('const partyHere = IS_WEB && inside;', 'const partyHere = true;'), BUZZ, GRID, AGENT, I18N, RESP));
const R_TONE = 'GOLD = opens inside Ezhalah, SILVER = everything else: tone = inside ? gold : silver, passed to the ring AND both strips; GoldSurface paints silver stops for it';
mustCatch('every card gold again (tone pinned to gold)', R_TONE,
  rules(CARD.replace("const tone: 'gold' | 'silver' = inside ? 'gold' : 'silver';", "const tone: 'gold' | 'silver' = 'gold';"), BUZZ, GRID, AGENT, I18N, RESP));
mustCatch('a ring that ignores the tone', R_TONE,
  rules(CARD.replace('\n    <GoldSurface tone={tone} style={card.goldRing} testID="card-gold-frame">\n    <View ', '\n    <GoldSurface style={card.goldRing} testID="card-gold-frame">\n    <View '), BUZZ, GRID, AGENT, I18N, RESP));
mustCatch('GoldSurface painting gold for the silver tone', R_TONE,
  rules(CARD, BUZZ, GRID, AGENT, I18N, RESP, OVERLAY, REVEAL.replace("tone === 'silver' ? [pal.silverLight, pal.silverDeep] : [pal.goldLight, pal.goldDeep]", '[pal.goldLight, pal.goldDeep]')));
mustCatch('the overlay unmounted from the agent screen', 'the ConfettiOverlay is the LAST child of the agent screen (above the AdViewer), and it never takes a tap',
  rules(CARD, BUZZ, GRID, AGENT.replace('    <ConfettiOverlay />\n    </View>\n  );\n}', '    </View>\n  );\n}'), I18N, RESP));
mustCatch('the overlay catching taps (it would block the sheet under it)', 'the ConfettiOverlay is the LAST child of the agent screen (above the AdViewer), and it never takes a tap',
  rules(CARD, BUZZ, GRID, AGENT, I18N, RESP, OVERLAY.replace('pointerEvents="none" style={[StyleSheet.absoluteFill, s.top]}', 'style={[StyleSheet.absoluteFill, s.top]}')));
mustCatch('the photo no longer pressing the shared handler', 'the photo AND the gold button both press the same handler',
  rules(CARD.replace('<Pressable onPress={fire} accessibilityRole="link"', '<Pressable onPress={onOpen} accessibilityRole="link"'), BUZZ, GRID, AGENT, I18N, RESP));
mustCatch('the phone/compact card pressing onOpen directly (no confetti there)', 'EVERY card presses the shared handler — the compact row and the phone card too, never onOpen directly',
  rules(CARD.replace('<Pressable onPress={fire} style={[card.midCol', '<Pressable onPress={onOpen} style={[card.midCol'), BUZZ, GRID, AGENT, I18N, RESP));
mustCatch('the buzzer layer gated back to laptop rows only', 'the buzzer layer mounts in the photo-first card AND unconditionally in the compact/phone card (every layout, owner 2026-10-17)',
  rules(CARD.replace('\n      <BuzzLayer burst={burst} />\n    </View>\n    </GoldSurface>\n  );\n}', '\n      {row ? <BuzzLayer burst={burst} /> : null}\n    </View>\n    </GoldSurface>\n  );\n}'), BUZZ, GRID, AGENT, I18N, RESP));
const R_GOLD = 'EVERY card sits in a shining gold ring and its «اضغط هنا» strip is a shining gold surface (GoldSurface = the gold button\'s gradient + CSS glint)';
mustCatch('the phone/compact card losing its gold ring', R_GOLD,
  // (the 4-space indent is the compact/phone card's ring; the photo-first card's sits at 6 spaces)
  rules(CARD.replace('\n    <GoldSurface tone={tone} style={card.goldRing} testID="card-gold-frame">\n    <View ', '\n    <View style={card.goldRing} testID="card-gold-frame">\n    <View '), BUZZ, GRID, AGENT, I18N, RESP));
mustCatch('the strip back to the flat dark-green View', R_GOLD,
  rules(CARD.replace('<GoldSurface tone={tone} style={[card.sourceStrip, row && card.sourceStripRow]} pointerEvents="none" testID="card-gold-strip">', '<View style={[card.sourceStrip, row && card.sourceStripRow]} pointerEvents="none">'), BUZZ, GRID, AGENT, I18N, RESP));
mustCatch('a gold surface that does not shine', R_GOLD,
  rules(CARD, BUZZ, GRID, AGENT, I18N, RESP, OVERLAY, REVEAL.replace(/(export function GoldSurface\([\s\S]*?)<CssShine \/>/, '$1')));
mustCatch('the laptop photo-first strip left dark green', R_GOLD,
  rules(CARD.replace('<GoldSurface tone={tone} style={card.lpPhotoFoot} pointerEvents="none" testID="card-gold-strip">', '<View style={card.lpPhotoFoot} pointerEvents="none">'), BUZZ, GRID, AGENT, I18N, RESP));
mustCatch('GoldSurface overriding the strip\'s absolute position (the strip would fall out of the photo)', R_GOLD,
  rules(CARD, BUZZ, GRID, AGENT, I18N, RESP, OVERLAY, REVEAL.replace('<View style={[s.goldClip, style]} pointerEvents={pointerEvents} testID={testID}>', '<View style={[style, s.goldClip]} pointerEvents={pointerEvents} testID={testID}>')));
mustCatch('white text on the gold strip', R_GOLD,
  rules(CARD.replace("photoAction: { color: colors.goldOnFill", "photoAction: { color: '#fff'"), BUZZ, GRID, AGENT, I18N, RESP));
mustCatch('a still (non-shining) gold button', 'the gold button SHINES on every card, by a CSS keyframe (no worklet per card)',
  rules(CARD.replace('<GoldShineButton shine="css" onPress={fire}', '<GoldShineButton shine="none" onPress={fire}'), BUZZ, GRID, AGENT, I18N, RESP));
mustCatch('the buzzer ignoring reduced motion', 'the buzzer is decoration: reduced motion draws nothing; removed by a timer; no .start(callback); no Math.random',
  rules(CARD, BUZZ.replace('if (!live || reduced) return null;', 'if (!live) return null;'), GRID, AGENT, I18N, RESP));
mustCatch('a Math.random confetti', 'the buzzer is decoration: reduced motion draws nothing; removed by a timer; no .start(callback); no Math.random',
  rules(CARD, BUZZ + '\nconst x = Math.random();', GRID, AGENT, I18N, RESP));
mustCatch('the type icon row gone from the main line', 'the TYPE (with its Filter icon) comes before the rooms in the main line',
  rules(CARD.replace('<View style={card.lpType}>', '<View style={card.lpTypeGone}>'), BUZZ, GRID, AGENT, I18N, RESP));
mustCatch('the AF picks no longer lit', 'the Advanced-Filter picks are the lit chips (✓), driven by pickedFeatures',
  rules(CARD.replace('const picked = pickedFeatures.has(f.key);\n                return (\n                  <View key={f.key} style={[card.lpChip', 'const picked = false;\n                return (\n                  <View key={f.key} style={[card.lpChip'), BUZZ, GRID, AGENT, I18N, RESP));
mustCatch('the long facts panel creeping back (cards would differ in height)', 'PLAIN + SAME SIZE: no additional-info panel, one title line, one row of ≤3 chips, one fixed facts row of ≤3 source facts; the logo is kept',
  rules(CARD.replace('          <View style={card.lpFoot}>', '          <AdditionalInformationPanel listing={listing} t={t} locale={locale} />\n          <View style={card.lpFoot}>'), BUZZ, GRID, AGENT, I18N, RESP));
mustCatch('the facts row wrapping and growing', 'PLAIN + SAME SIZE: no additional-info panel, one title line, one row of ≤3 chips, one fixed facts row of ≤3 source facts; the logo is kept',
  rules(CARD.replace("lpFacts: { flexDirection: 'row', flexWrap: 'nowrap'", "lpFacts: { flexDirection: 'row', flexWrap: 'wrap'"), BUZZ, GRID, AGENT, I18N, RESP));
mustCatch('chips wrapping onto a second row', 'PLAIN + SAME SIZE: no additional-info panel, one title line, one row of ≤3 chips, one fixed facts row of ≤3 source facts; the logo is kept',
  rules(CARD.replace("lpChips: { flexDirection: 'row', flexWrap: 'nowrap'", "lpChips: { flexDirection: 'row', flexWrap: 'wrap'"), BUZZ, GRID, AGENT, I18N, RESP));
mustCatch('a raw hex colour in the buzzer', 'new styles and the buzzer use theme colours only (no raw hex)',
  rules(CARD, BUZZ.replace('colors.goldLight, colors.goldDeep', "'#ffd966', colors.goldDeep"), GRID, AGENT, I18N, RESP));
mustCatch('a 3-across grid that ignores the open ad pane', 'agent.tsx: the photo-first grid only while nothing is open beside the results (the ad pane open = the old compact rows)',
  rules(CARD, BUZZ, GRID, AGENT.replace('viewerSplit && !adPaneBeside ?', 'viewerSplit ?'), I18N, RESP));
mustCatch('the grid forced onto native', 'ResultCardGrid: a web-only CSS grid; 3 across may run past 940 but never past the screen',
  rules(CARD, BUZZ, GRID.replace("Platform.OS === 'web' && !!cols", '!!cols'), AGENT, I18N, RESP));
mustCatch('the laptop layout leaking onto the phone card', 'the photo-first layout is ONLY behind `if (row === \'roomy\')`; the old compact row and the phone card are still below it',
  rules(CARD.replace("  if (row === 'roomy') {", '  if (true) {'), BUZZ, GRID, AGENT, I18N, RESP));
mustCatch('the new copy missing in Arabic', 'the new copy exists in Arabic',
  rules(CARD, BUZZ, GRID, AGENT, I18N.replace("'To confirm availability and details': 'للتأكد من التوفر والتفاصيل',", ''), RESP));

console.log(failed === 0 ? '\n✅ the laptop card is photo-first, laptop-only, opens first, and the buzzer plays on every card as decoration only.\n' : `\n❌ ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
