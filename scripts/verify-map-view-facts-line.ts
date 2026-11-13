// The map box can't be wrong — THE SCREEN HALF (owner 2026-11-12; design: docs/ARCHITECTURE.md «THE MAP BOX AND ITS
// CARD»). Executes the rules that decide what the box may SAY (src/lib/mapViewFacts.ts) and checks the map asks for the
// box its count was read over. The server half is scripts/verify-map-view-facts.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { factBox, comparisonChip, parseViewFacts, sameCount, placeFactsFit, FACTS_MIN_ADS, type ViewFacts, type FactBox } from '../src/lib/mapViewFacts.ts';
import { areaPlace, type AreaRow } from '../src/lib/mapAreas.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? ' — ' + info : ''}`); if (!ok) failed++; };
const mustCatch = (name: string, mutantPasses: () => boolean) => check(`(mutation) catches ${name}`, !mutantPasses());
const MARKS = /[ً-ْ]/;
const plain = (x: string) => x.replace(/[⁦⁩]/g, '');

const full: ViewFacts = { any: 560, locked: false, new30: 72, gone30: 40, ppm: 9722, nbPpm: 11766, nbKind: 'near', nbNames: ['حي القيروان', 'حي الصحافة'], cityAr: 'الرياض', cuts30: 9, oneType: true, topType: null, topPpm: null, place: false };
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
const screenSrc = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
const guestSmall = (src: string) => /accessibilityLabel=\{lockedAsk\(loc\)\}/.test(src) && /\{box\.kind === 'locked' \? \(\s*<Pressable onPress=\{\(\) => openAuth\(\)\}[^>]*>\s*<Text style=\{s\.factAsk\}>\{lockedAsk\(loc\)\}<\/Text>\s*<\/Pressable>/.test(src) && !/FACT_BLUR/.test(src);
check('a guest sees only the small sign-in ask (no blurred row), and screen readers hear it', guestSmall(screenSrc));
mustCatch('the big blurred guest row coming back', () => guestSmall(screenSrc.replace('<Text style={s.factAsk}>{lockedAsk(loc)}</Text>', '<View style={[s.factLine, FACT_BLUR]} /><Text style={s.factAsk}>{lockedAsk(loc)}</Text>')));
const small = (src: string) => /countPillTall: \{ borderRadius: 12, maxWidth: '64%', paddingVertical: 6 \}/.test(src) && /factLine: \{ color: '#fff', fontSize: 11\.5,/.test(src) && !/factChip:/.test(src);
check('the box is small: one line of 11.5px words, at most 64% of the map wide (clear of the buttons)', small(screenSrc));
mustCatch('boxed chips back (the big box)', () => small(screenSrc + "\n  factChip: { color: '#fff' },"));
check('no Arabic diacritics anywhere in the box', texts(b).every((t) => !MARKS.test(t)) && !MARKS.test(String(noType.kind === 'chips' ? noType.hint : '')));
mustCatch('a box that ignores the pill\'s count', () => { const ignoresPill = (f: ViewFacts, _shown: number) => factBox(f, f.any, 'ar', true); return ignoresPill(full, 559).kind === 'none'; });

const drawnBox = factBox(full, 560, 'ar', true, true, (x) => x, true);
check('a drawn boundary gets the facts for the ads inside it, without «أحياء قريبة»', drawnBox.kind === 'chips' && texts(drawnBox).includes('72 جديد') && !texts(drawnBox).some((t) => t.includes('أحياء قريبة')));
mustCatch('a drawing compared with «nearby districts»', () => { const b2 = factBox(full, 560, 'ar', true, true, (x) => x, false); return b2.kind === 'chips' && !texts(b2).some((t) => t.includes('أحياء قريبة')); });
check('the map asks for facts inside a drawing too (its pin read carries the polygon)', /\(!viewPlace && !hasShape && !factsExact\)\) return;/.test(readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8')) && !/hasShape \|\| drawing \|\|/.test(readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8')));

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

// 3b. with no type picked: the most common type's own price, NAMED (owner 2026-11-13: «if nothing is selected … just show a general»)
const top = { ...full, ppm: null, nbPpm: null, topType: 'شقة', topPpm: 3500 };
const namesTop = (x: FactBox) => x.kind === 'chips' && texts(x).includes('الشقق: المتر المعروض 3,500 ريال') && x.hint === null;
check('no type picked: the box names the most common type with its own price («الشقق: …»), no «اختر نوع العقار»', namesTop(factBox(top, 560, 'ar', false)));
check('…and in English', (() => { const e = factBox(top, 560, 'en', false); return e.kind === 'chips' && texts(e).includes('Apartments: asking 3,500 SAR/m²'); })());
check('a type the English names do not know shows no price at all (never an unnamed mix)', (() => { const e = factBox({ ...top, topType: 'نوع جديد' }, 560, 'en', false); return e.kind === 'chips' && !texts(e).some((t) => t.includes('SAR')); })());
check('the neighbours are compared with that same type\'s price', (() => { const c = factBox({ ...top, nbPpm: 4200, nbKind: 'near' as const }, 560, 'ar', false); return texts(c).includes('أرخص من أحياء قريبة 17%'); })());
mustCatch('a no-type price shown without its type name', () => namesTop(factBox({ ...top, ppm: 3500 }, 560, 'ar', false)));

// 3c. city/district label zoom reads that place's PREPARED facts
check('a place\'s prepared count may drift by new ads, never more than 3% (or 3 ads)', sameCount(1030, 1000, true) && !sameCount(1031, 1000, true) && sameCount(43, 40, true) && !sameCount(44, 40, true));
check('a live box keeps the exact match (no tolerance)', !sameCount(560, 559, false) && sameCount(560, 560, false));
check('facts for a place whose count is far off say nothing', factBox({ ...full, any: 1000, place: true }, 1500, 'ar', true).kind === 'none' && factBox({ ...full, any: 1000, place: true }, 1020, 'ar', true).kind === 'chips');
mustCatch('a place compared with no limit', () => factBox({ ...full, any: 1000, place: true }, 1500, 'ar', true).kind !== 'none');
const fit = placeFactsFit;
check('prepared place facts only for one deal with no other filter', fit({ deals: ['buy'] }) && !fit({ deals: ['buy', 'rent'] }) && !fit({ deals: ['buy'], types: ['شقة'] })
  && !fit({ deals: ['buy'], priceMin: 0 }) && !fit({ deals: ['buy'], beds: [3] }) && !fit({ deals: ['buy'], poly: [[1, 2]] }) && !fit({ deals: ['buy'], postedWithinDays: 7 }) && !fit({ deals: ['buy'], category: 'تجاري' }));
const rows: AreaRow[] = [{ city: 'الرياض', district: 'الملقا', lat: 24.8, lng: 46.6, n: 900 }, { city: 'الرياض', district: 'حطين', lat: 24.76, lng: 46.6, n: 100 }];
const atDistrict = areaPlace(rows, 'district', 'ar', (x) => x, { latitude: 24.8, longitude: 46.6 }, { latitudeDelta: 0.3, longitudeDelta: 0.3 });
check('the district the pill names carries its own facts key (city + district)', atDistrict?.facts?.level === 'district' && atDistrict.facts.city === 'الرياض' && atDistrict.facts.district === 'الملقا' && atDistrict.n === 900);
check('the whole-Kingdom view carries no place facts', !areaPlace(rows, 'country', 'ar', (x) => x, { latitude: 24, longitude: 45 }, { latitudeDelta: 17, longitudeDelta: 17 })?.facts);

// 3d. the pill names a city but counts only the districts on screen: the facts of EXACTLY those districts (summed)
const part: AreaRow[] = [{ city: 'الرياض', district: 'حي الملقا', lat: 24.8, lng: 46.6, n: 400 }, { city: 'الرياض', district: 'حي حطين', lat: 24.76, lng: 46.6, n: 350 },
  { city: 'الرياض', district: 'حي النرجس', lat: 24.85, lng: 46.65, n: 380 }, { city: 'جدة', district: 'حي الروضة', lat: 24.82, lng: 46.62, n: 20 }];
const cityNamed = areaPlace(part, 'district', 'ar', (x) => x, { latitude: 24.8, longitude: 46.62 }, { latitudeDelta: 0.3, longitudeDelta: 0.3 });
const keyedToItsDistricts = (p: typeof cityNamed) => p?.facts?.level === 'districts' && p.facts.city === 'الرياض'
  && JSON.stringify([...(p.facts.districts ?? [])].sort()) === JSON.stringify(['حي الملقا', 'حي النرجس', 'حي حطين'].sort()) && p.n === 1130;
check('a city-named view of part of the city reads the facts of exactly its districts (same ads as its count)', keyedToItsDistricts(cityNamed), JSON.stringify(cityNamed));
mustCatch('a part-of-the-city view keyed to the WHOLE city (facts for ads it does not count)', () => keyedToItsDistricts(cityNamed ? { ...cityNamed, facts: { level: 'city', city: 'الرياض', district: '' } } : null));
const data = readFileSync(join(root, 'src/data/mapViewFacts.ts'), 'utf8');
check('the districts on screen are summed by map_place_facts_sum_ar', /place\.level === 'districts' \? 'map_place_facts_sum_ar' : 'map_place_facts_ar'/.test(data) && /p_districts: \[\.\.\.new Set\(place\.districts \?\? \[\]\)\]\.sort\(\)/.test(data));
check('a place\'s facts (all types) never ask «اختر نوع العقار» — picking a type would leave them', (() => { const x = factBox({ ...full, ppm: null, nbPpm: null, place: true }, 560, 'ar', false); return x.kind === 'chips' && x.hint === null; })());
mustCatch('a place box that asks for a type', () => { const x = factBox({ ...full, ppm: null, nbPpm: null, place: false }, 560, 'ar', false); return x.kind === 'chips' && x.hint === null; });

// 3e. after a district search the pill and its box are about THAT district (owner 2026-11-13: «it shows later … not true»)
const around: AreaRow[] = [{ city: 'الرياض', district: 'حي الملقا', lat: 24.81, lng: 46.61, n: 1916 }, { city: 'الرياض', district: 'حي القيروان', lat: 24.84, lng: 46.58, n: 1205 },
  { city: 'الرياض', district: 'حي حطين', lat: 24.76, lng: 46.6, n: 592 }, { city: 'الرياض', district: 'حي الصحافة', lat: 24.8, lng: 46.64, n: 840 },
  { city: 'الرياض', district: 'حي النرجس', lat: 24.83, lng: 46.66, n: 6539 }, { city: 'الرياض', district: 'حي العقيق', lat: 24.77, lng: 46.63, n: 546 }];
const V0 = { latitude: 24.805, longitude: 46.615 }; const S0 = { latitudeDelta: 0.12, longitudeDelta: 0.12 };
const malqa = { district: 'الملقا', lat: 24.808, lng: 46.612, latitudeDelta: 0.12 };
const leads = (p: ReturnType<typeof areaPlace>) => p?.name === 'حي الملقا' && p.n === 1916 && p.facts?.level === 'district' && p.facts.district === 'حي الملقا' && p.facts.city === 'الرياض';
check('a searched district names the pill with ITS count and ITS facts, even when it is not most of the screen', leads(areaPlace(around, 'district', 'ar', (x) => x, V0, S0, malqa)));
check('…and lets go once the user zooms well out', !leads(areaPlace(around, 'district', 'ar', (x) => x, V0, { latitudeDelta: 0.3, longitudeDelta: 0.3 }, malqa)));
check('…or pans it off the screen', !leads(areaPlace(around, 'district', 'ar', (x) => x, { latitude: 24.6, longitude: 46.8 }, S0, malqa)));
check('a same-named district far from where Apple put the search is never taken for it', !leads(areaPlace(around, 'district', 'ar', (x) => x, V0, S0, { ...malqa, lat: 21.5, lng: 39.2 })));
check('with no search the old rule stands (the city named over many districts)', areaPlace(around, 'district', 'ar', (x) => x, V0, S0)?.facts?.level === 'districts');
mustCatch('a searched district ignored (the pill names the whole screen after the user searched one district)', () => leads(areaPlace(around, 'district', 'ar', (x) => x, V0, S0)));
const webSrc = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
const focusWired = (src: string) => /if \(p\.kind === 'district'\) live\.focus = \{ district: /.test(src) && /areaPlace\(areas, level, loc, translitPlace, m\.region\.center, m\.region\.span, live\.focus\);/.test(src) && /live\.focus = null;/.test(src);
check('a district search sets the focus, the label view reads it, clearing the search clears it', focusWired(webSrc));
mustCatch('a label view that never reads the searched district', () => focusWired(webSrc.replace('m.region.span, live.focus);', 'm.region.span);')));

// 4. the screen asks for the box the count was read over, and compares with the number it shows
const web = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
const wired = (src: string) => /setPinCount\(pillCount\(rows\)\); setFactsBox\(paddedBox\(center, span\)\);/.test(src)
  && (src.match(/setFactsBox\(paddedBox/g) ?? []).length === 2
  && /if \(factsWide\(span\.latitudeDelta\)\) \{ setFactsBox\(paddedBox\(center, span\)\); setFactsExact\(true\); \}/.test(src)
  && /if \(exact && f\) setPinCount\(f\.any\);/.test(src)
  && /const my = \+\+seq;\s*setFactsBox\(null\); setFactsExact\(false\);/.test(src)
  && /factBox\(viewFacts, hasShape \? pinCount : placeCount \?\? pinCount, loc, typePicked, saleOnly, translitPlace, hasShape\)/.test(src)
  && /fetchViewFacts\(box, pinFilter, !!user\)/.test(src);
check('the map asks for the counted box and shows the facts only against the number it shows', wired(web));
const bubblesExact = (src: string) => /setPinCount\(pillCount\(rows\)\); setFactsBox\(paddedBox\(center, span\)\); if \(drawCell > 0 && factsWide\(span\.latitudeDelta\)\) setFactsExact\(true\);/.test(src);
check('a bubble view (whole map squares) takes the exact count of the view from the box, so the box can show', bubblesExact(web));
mustCatch('a bubble view whose square count never meets the box\'s exact count (box never shows)', () => bubblesExact(web.replace(' if (drawCell > 0 && factsWide(span.latitudeDelta)) setFactsExact(true);', '')));
const placeWired = (src: string) => /factsPlace && !hasShape && !drawing && pinFilter && placeFactsFit\(pinFilter\) && typeof placeCount === 'number'/.test(src)
  && /fetchPlaceFacts\(place, deals, !!user\)/.test(src)
  && /setFactsPlace\(!whole && place\?\.facts \? place\.facts : null\);/.test(src)
  && /setFactsBox\(null\); setFactsExact\(false\); setFactsPlace\(null\);/.test(src);
check('label zoom asks for the named place\'s facts only when the count is all of one deal there, and a new read forgets it', placeWired(web));
mustCatch('place facts asked for under a type or price filter', () => placeWired(web.replace('placeFactsFit(pinFilter)', 'pinFilter.deals.length === 1')));
mustCatch('a new map read that keeps the last place (facts for the previous city)', () => placeWired(web.replace('setFactsExact(false); setFactsPlace(null);', 'setFactsExact(false);')));
mustCatch('facts compared with a different number than the pill shows', () => wired(web.replace('factBox(viewFacts, hasShape ? pinCount : placeCount ?? pinCount, loc, typePicked, saleOnly, translitPlace, hasShape)', 'factBox(viewFacts, viewFacts?.any ?? null, loc, typePicked, saleOnly, translitPlace, hasShape)')));
mustCatch('facts asked for an area total (a box the count was not read over)', () => wired(web.replace('setPinCount(areasTotal(areas));', 'setPinCount(areasTotal(areas)); setFactsBox(paddedBox(center, span));')));
mustCatch('a new map read that keeps the last box (facts for the previous view)', () => wired(web.replace(/(const my = \+\+seq;)\s*setFactsBox\(null\); setFactsExact\(false\);[^\n]*/, '$1')));
mustCatch('a wide view whose estimate is never replaced by the exact count (box and count could differ)', () => wired(web.replace('if (exact && f) setPinCount(f.any);', '')));

console.log(failed ? `\n${failed} check(s) FAILED` : '\nverify-map-view-facts-line: all checks passed');
process.exit(failed ? 1 : 0);
