// Two owner bugs, 2026-11-01 (iPhone screenshot of the Filter in dark mode):
//  1. «Idk why they don't show»: the unselected «تجاري», «الفلل والبيوت», «الاستراحات والريف», «الأراضي السكنية» icons
//     were dark-on-dark. react-native-web tints an Image through an SVG filter with a FIXED id per Image; when the
//     palette flips after first paint only the flood colour changes under the same url(#tint-N), and Safari never
//     repaints. Each tinted layer must be KEYED by its tint so a colour change mounts a fresh Image (fresh filter id).
//  2. «remove price for short stays»: short-stay cards show no price (listingPrice → ''), so the من/إلى price box is
//     hidden when «إقامات قصيرة» is the ONLY period — and only then.
import { readFileSync } from 'node:fs';

const ui = readFileSync('src/components/ui.tsx', 'utf8');
const home = readFileSync('src/app/index.tsx', 'utf8');
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };
const mustCatch = (name: string, caught: boolean) => check(`(mutation) catches ${name}`, caught);

// ── 1. the icon layers ──
const crossfade = (src: string) => {
  const m = src.match(/function CrossfadeTintIcon\([\s\S]*?\n}\n/);
  return m ? m[0] : '';
};
const iconsRepaint = (src: string) => {
  const body = crossfade(src);
  const imgs = [...body.matchAll(/<AnimatedImage\b[^>]*\/>/g)].map((m) => m[0]);
  const keyedBy = (img: string, tint: string) =>
    new RegExp(`key=\\{[^}]*\\$\\{${tint}\\}`).test(img) && new RegExp(`tintColor: ${tint}\\b`).test(img);
  return imgs.length === 2 && imgs.some((i) => keyedBy(i, 'off')) && imgs.some((i) => keyedBy(i, 'on'));
};
check('every tinted icon layer is keyed by its own tint (a palette flip mounts a fresh, repainted Image)', iconsRepaint(ui));
check('…and both selector families still draw icons through CrossfadeTintIcon', (ui.match(/<CrossfadeTintIcon\b/g) ?? []).length >= 2);
mustCatch('the off layer losing its key (dark-on-dark icons again)', !iconsRepaint(ui.replace(/ key=\{`off-\$\{off\}`\}/, '')));
mustCatch('the on layer losing its key', !iconsRepaint(ui.replace(/ key=\{`on-\$\{on\}`\}/, '')));
mustCatch('a fixed key that never changes with the colour', !iconsRepaint(ui.replace('key={`off-${off}`}', 'key="off"')));

// ── 2. the price box ──
const priceBox = (src: string) => {
  const flag = /const shortStaysOnly = query\.deal === 'Rent' && !query\.dealCombined && rentPeriod === 'monthly';/.test(src);
  const gate = src.indexOf('{!shortStaysOnly && (<>');
  const minInput = src.indexOf('testID="price-min-input"');
  const maxInput = src.indexOf('testID="price-max-input"');
  const close = src.indexOf('</>)}', maxInput);
  const rentBudget = src.indexOf("t('Rent budget (yearly basis)')");
  return flag && gate > 0 && gate < minInput && minInput < maxInput && close > maxInput && close < rentBudget;
};
check('the من/إلى price box is hidden exactly when «إقامات قصيرة» is the only period', priceBox(home));
mustCatch('the gate removed (price box back for short stays)', !priceBox(home.replace('{!shortStaysOnly && (<>', '{(<>')));
mustCatch('hiding it for yearly too', !priceBox(home.replace("rentPeriod === 'monthly';", "rentPeriod !== 'both';")));
mustCatch('hiding it under شراء+إيجار (the combined budgets must stay)', !priceBox(home.replace("&& !query.dealCombined && rentPeriod === 'monthly'", "&& rentPeriod === 'monthly'")));
mustCatch('hiding it for a Buy search', !priceBox(home.replace("query.deal === 'Rent' && !query.dealCombined", "!query.dealCombined")));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✅ filter icons repaint on a palette flip; short stays have no price box');
