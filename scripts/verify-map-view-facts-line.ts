// The map box can't be wrong — THE SCREEN HALF (owner 2026-11-12; design: docs/ARCHITECTURE.md «THE MAP BOX AND ITS
// CARD»). Executes the rules that decide what the box may SAY (src/lib/mapViewFacts.ts) and checks the map asks for the
// box its count was read over. The server half is scripts/verify-map-view-facts.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { factBox, comparisonChip, parseViewFacts, FACTS_MIN_ADS, type ViewFacts, type FactBox } from '../src/lib/mapViewFacts.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? ' — ' + info : ''}`); if (!ok) failed++; };
const mustCatch = (name: string, mutantPasses: () => boolean) => check(`(mutation) catches ${name}`, !mutantPasses());
const MARKS = /[ً-ْ]/;
const plain = (x: string) => x.replace(/[⁦⁩]/g, '');

const full: ViewFacts = { any: 560, locked: false, new30: 72, gone30: 40, ppm: 9722, nbPpm: 11766, nbKind: 'near', nbNames: ['حي القيروان', 'حي الصحافة'], cityAr: 'الرياض', cuts30: 9, oneType: true };
const texts = (b: FactBox) => (b.kind === 'chips' ? b.chips.map((c) => plain(c.text)) : b.kind === 'locked' ? b.chips : []);

// 1. what the box says
const b = factBox(full, 560, 'ar', true);
check('the box reads as agreed', JSON.stringify(texts(b)) === JSON.stringify(['72 جديد', '40 اختفى', 'المتر المعروض 9,722 ريال', 'أرخص من أحياء قريبة 17%', '9 خفضوا السعر']), JSON.stringify(texts(b)));
check('a price always says «المعروض» (asking, never sold)', texts(b).some((t) => t.includes('المتر المعروض')));
check('a failed read (null) says nothing — never «0»', factBox(null, 560, 'ar', true).kind === 'none');
check('facts for OTHER ads than the pill counts say nothing (any ≠ shown)', factBox(full, 559, 'ar', true).kind === 'none' && factBox(full, null, 'ar', true).kind === 'none');
check(`a view under ${FACTS_MIN_ADS} ads says nothing`, factBox({ ...full, any: FACTS_MIN_ADS - 1 }, FACTS_MIN_ADS - 1, 'ar', true).kind === 'none');
check('a missing or zero number leaves its chip out', !texts(factBox({ ...full, gone30: null, cuts30: 0 }, 560, 'ar', true)).some((t) => t.includes('اختفى') || t.includes('خفضوا')));
check('no price, no comparison', !texts(factBox({ ...full, ppm: null }, 560, 'ar', true)).some((t) => t.includes('المتر') || t.includes('أحياء قريبة')));
const noType = factBox({ ...full, ppm: null, nbPpm: null }, 560, 'ar', false);
check('with no type picked the price is never mixed — the box asks for a type', noType.kind === 'chips' && noType.hint === 'اختر نوع العقار لعرض السعر');
const rentNoType = factBox({ ...full, ppm: null, nbPpm: null }, 560, 'ar', false, false);
check('a rent or mixed-deal view never asks for a type (no price can appear there)', rentNoType.kind === 'chips' && rentNoType.hint === null);
check('the English city fallback goes through the transliterator', comparisonChip(11800, 10000, 'city', 'الرياض', 'en', () => 'Riyadh').text.includes('Riyadh') && comparisonChip(11800, 10000, 'city', 'الرياض', 'ar', () => 'Riyadh').text.includes('الرياض'));
check('screen readers hear the sign-in ask, not the fake numbers', /accessibilityLabel=\{lockedAsk\(loc\)\}/.test(readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8')) && /importantForAccessibility="no-hide-descendants"/.test(readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8')));
check('no Arabic diacritics anywhere in the box', texts(b).every((t) => !MARKS.test(t)) && !MARKS.test(String(noType.kind === 'chips' ? noType.hint : '')));
mustCatch('a box that ignores the pill\'s count', () => { const ignoresPill = (f: ViewFacts, _shown: number) => factBox(f, f.any, 'ar', true); return ignoresPill(full, 559).kind === 'none'; });

const drawnBox = factBox(full, 560, 'ar', true, true, (x) => x, true);
check('a drawn boundary gets the facts for the ads inside it, without «أحياء قريبة»', drawnBox.kind === 'chips' && texts(drawnBox).includes('72 جديد') && !texts(drawnBox).some((t) => t.includes('أحياء قريبة')));
mustCatch('a drawing compared with «nearby districts»', () => { const b2 = factBox(full, 560, 'ar', true, true, (x) => x, false); return b2.kind === 'chips' && !texts(b2).some((t) => t.includes('أحياء قريبة')); });
check('the map asks for facts inside a drawing too (its pin read carries the polygon)', /\(!viewPlace && !hasShape\)\) return;/.test(readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8')) && !/hasShape \|\| drawing \|\|/.test(readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8')));

// 2. the comparison
check('pricier than the neighbours reads red with the percentage', plain(comparisonChip(10900, 10000, 'near', 'الرياض', 'ar').text) === 'أغلى من أحياء قريبة 9%' && comparisonChip(10900, 10000, 'near', 'الرياض', 'ar').tone === 'up');
check('cheaper reads green', comparisonChip(8300, 10000, 'near', 'الرياض', 'ar').tone === 'down');
check('under 5% apart says «قريب من أحياء قريبة», no percentage', comparisonChip(10300, 10000, 'near', null, 'ar').text === 'قريب من أحياء قريبة');
check('the city fallback names the city', plain(comparisonChip(11800, 10000, 'city', 'الرياض', 'ar').text) === 'أغلى من الرياض 18%');
check('the percentage is isolated left-to-right (never the flipped «%9»)', comparisonChip(10900, 10000, 'near', null, 'ar').text.includes('⁦9%⁩'));
mustCatch('a comparison that shows a 2% wobble as a percentage', () => { const loose = (p: number, nb: number) => Math.round(((p - nb) / nb) * 100) !== 0; return !loose(10200, 10000); });

// 3. the guest
const guest = parseViewFacts({ data: { locked: true, any: 560, has_new: true, has_gone: false, has_ppm: true, has_cmp: true, has_cuts: false, new30: 72, ppm: 9722, nb_ppm: 11766 }, error: null });
check('a guest\'s facts carry no numbers, even if the server sent some', !!guest && guest.locked && guest.new30 === null && guest.ppm === null && guest.nbPpm === null);
const gb = factBox(guest, 560, 'ar', true);
check('a guest sees blurred shapes only for chips that exist', gb.kind === 'locked' && gb.chips.length === 3 && gb.chips.every((c) => /88/.test(c)));
check('a guest never sees whether the area is pricier or cheaper', gb.kind === 'locked' && !gb.chips.some((c) => c.includes('أغلى') || c.includes('أرخص')));
check('a guest\'s drawing shows no blurred «أحياء قريبة» shape either', (() => { const d = factBox(guest, 560, 'ar', true, true, (x) => x, true); return d.kind === 'locked' && !d.chips.some((c) => c.includes('أحياء قريبة')); })());
check('parse: an error or no data is null', parseViewFacts({ data: null, error: null }) === null && parseViewFacts({ data: { any: 5 }, error: { message: 'x' } }) === null);

// 4. the screen asks for the box the count was read over, and compares with the number it shows
const web = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
const wired = (src: string) => /setPinCount\(pillCount\(rows\)\); setFactsBox\(paddedBox\(center, span\)\);/.test(src)
  && (src.match(/setFactsBox\(paddedBox/g) ?? []).length === 1
  && /const my = \+\+seq;\s*setFactsBox\(null\);/.test(src)
  && /factBox\(viewFacts, hasShape \? pinCount : placeCount \?\? pinCount, loc, typePicked, saleOnly, translitPlace, hasShape\)/.test(src)
  && /fetchViewFacts\(box, pinFilter, !!user\)/.test(src);
check('the map asks for the counted box and shows the facts only against the number it shows', wired(web));
mustCatch('facts compared with a different number than the pill shows', () => wired(web.replace('factBox(viewFacts, hasShape ? pinCount : placeCount ?? pinCount, loc, typePicked, saleOnly, translitPlace, hasShape)', 'factBox(viewFacts, viewFacts?.any ?? null, loc, typePicked, saleOnly, translitPlace, hasShape)')));
mustCatch('facts asked for an area total (a box the count was not read over)', () => wired(web.replace('setPinCount(areasTotal(areas));', 'setPinCount(areasTotal(areas)); setFactsBox(paddedBox(center, span));')));
mustCatch('a new map read that keeps the last box (facts for the previous view)', () => wired(web.replace(/(const my = \+\+seq;)\s*setFactsBox\(null\);[^\n]*/, '$1')));

console.log(failed ? `\n${failed} check(s) FAILED` : '\nverify-map-view-facts-line: all checks passed');
process.exit(failed ? 1 : 0);
