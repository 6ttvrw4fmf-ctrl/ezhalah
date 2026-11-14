// THE MAP CARD can't be wrong (owner 2026-11-12/13: «we can't have mistakes … we can get sued»; design:
// docs/ARCHITECTURE.md «THE MAP BOX AND ITS CARD»). Executes the rules that decide what each card cell SAYS
// (src/lib/mapCard.ts), checks the server reads the box's OWN ads (the facts filter word for word) with every window gated
// on its log and every price from ≥ 10 ads of one type, that a guest gets no number, and that the map opens the card for
// the box's own view and loads it only on the first tap.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseMapCard, cardRow, quickLook, nearbyPrices, tone, filterChips, restIsSoon, FEW, SOON, NONE, NEAR, LEGEND, type MapCard,
  isSaleCard, saleTitle, saleSubtitle, saleSentence, saleNumbers, saleDiffs, saleRooms, saleDetails, saleWeeks, saleSites, DISCLAIMER, BANNED_WORDS } from '../src/lib/mapCard.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? ' — ' + info : ''}`); if (!ok) failed++; };
const mustCatch = (name: string, mutantPasses: () => boolean) => check(`(mutation) catches ${name}`, !mutantPasses());
const MARKS = /[ً-ْ]/;

// 1. what the card says
const raw = {
  any: 1916, city_ar: 'الرياض', district_ar: 'حي الملقا', price_type: 'شقة', sites: 28, updated_at: '2026-11-13T03:11:34Z',
  table: { y: { new: 4, gone: null, cuts: 4, ppm: null, ppm_n: 0 }, w: { new: 55, gone: null, cuts: null, ppm: null, ppm_n: 9 },
           m: { new: 250, gone: null, cuts: null, ppm: 10755, ppm_n: 110 }, q: { new: 698, gone: null, cuts: null, ppm: 9658, ppm_n: 274 } },
  median_price: 1299762, median_area: 135, price_low: 1000000, price_high: 1600000, stay_days: null,
  top_type: { type: 'شقة', pct: 49 }, top_rooms: { rooms: 3, pct: 67 }, median_age: 3,
  nb: { names: ['حي القيروان', 'حي الصحافة', 'حي العقيق', 'حي حطين'], n_districts: 4,
        month: { new: 103, gone: null, cuts: null, ppm: 11733, ppm_n: 101 },
        median_price: 1500000, median_area: 128, price_low: 1039600, price_high: 2200000, stay_days: null,
        top_type: { type: 'شقة', pct: 100 }, top_rooms: { rooms: 3, pct: 47 }, median_age: 0,
        by_district: [{ district: 'حي القيروان', ppm: 9396 }, { district: 'حي الصحافة', ppm: null }] },
};
const c = parseMapCard({ data: raw, error: null }) as MapCard;
check('parse: the real Malqa read becomes a card', !!c && c !== null && typeof c === 'object' && c.any === 1916 && c.nb?.nDistricts === 4);
check('parse: a failed read is null (the card says it could not load — never «0»)', parseMapCard({ data: null, error: { message: 'x' } }) === null && parseMapCard({ data: { any: 5 }, error: null }) === null);
check('parse: a guest read is «locked» and carries no number', parseMapCard({ data: { locked: true, any: 5 }, error: null }) === 'locked');
const rNew = cardRow(c, 'new', 'ar');
check('the new-ads row reads أمس · أسبوع · شهر · 3 أشهر · أحياء قريبة (per-district average)', JSON.stringify(rNew.cells.map((x) => x.text)) === JSON.stringify(['4', '55', '250', '698', '26']), JSON.stringify(rNew.cells));
check('a month far above the neighbours\' average is red', rNew.cells[2].tone === 'up');
const rGone = cardRow(c, 'gone', 'ar');
check('a window the removal log does not cover yet says «قريبا», never 0', rGone.cells.slice(0, 4).every((x) => x.text === SOON.ar) && rGone.cells[4].text === SOON.ar);
const rPpm = cardRow(c, 'ppm', 'ar');
check('a price from fewer than 10 ads shows the NEARBY month price, flagged «قريبة» (owner 2026-11-13)', rPpm.cells[0].text === '11,733' && rPpm.cells[0].near === true && rPpm.cells[1].near === true && rPpm.cells[2].text === '10,755' && !rPpm.cells[2].near, JSON.stringify(rPpm.cells));
mustCatch('a nearby price shown without its «قريبة» flag (passed off as this area\'s own)', () => cardRow(c, 'ppm', 'ar').cells[0].near !== true);
check('a nearby fallback in the yesterday / week column says it is the neighbours\' MONTH price (place AND period)', rPpm.cells[0].nearPeriod === 'month' && rPpm.cells[1].nearPeriod === 'month' && NEAR.ar.includes('شهر') && LEGEND.near.ar.includes('شهر'));
mustCatch('a fallback tag that names the place but not the period', () => NEAR.ar.replace(' · شهر', '').includes('شهر'));
const noNb = parseMapCard({ data: { ...raw, nb: null }, error: null }) as MapCard;
check('few ads here and none nearby: a plain «—», never a number', cardRow(noNb, 'ppm', 'ar').cells[0].text === NONE && !cardRow(noNb, 'ppm', 'ar').cells[0].near);
check('a row with no history after «أمس» collapses to one «باقي المدد تتوفر قريبا» line', restIsSoon(cardRow(c, 'gone', 'ar').cells, 'ar') && !restIsSoon(cardRow(c, 'new', 'ar').cells, 'ar'));
check('the filter pills say what the user picked', JSON.stringify(filterChips({ types: ['دور'], beds: [3, 4], priceMax: 1500000 }, 'ar')) === JSON.stringify(['دور', '3، 4 غرف', 'حتى 1.5 مليون']), JSON.stringify(filterChips({ types: ['دور'], beds: [3, 4], priceMax: 1500000 }, 'ar')));
check('no filter → no pills; English pills never print Arabic type names', filterChips(null, 'ar').length === 0 && filterChips({ types: ['فيلا'] }, 'en')[0] === 'Villa');
check('the price row names its ONE type and says «المعروض»', rPpm.label === 'سعر المتر المعروض (الشقق)');
check('cheaper than the neighbours is green', rPpm.cells[2].tone === 'down' && tone(100, 102) === 'plain');
mustCatch('the neighbours\' TOTAL printed instead of their per-district average (a big district compared unfairly)', () => cardRow({ ...c, nb: { ...c.nb!, nDistricts: 1 } }, 'new', 'ar').cells[4].text === '26');
const q = quickLook(c, 'ar');
check('نظرة سريعة has the 8 agreed numbers in order', JSON.stringify(q.map((x) => x.label)) === JSON.stringify(['متوسط السعر المعروض', 'متوسط المساحة', 'مدة بقاء الإعلان', 'نطاق الأسعار المعروضة', 'النوع الأكثر', 'عدد الغرف الأكثر', 'متوسط عمر العقار', 'مواقع تعرض إعلانات هنا']));
check('each but the last carries the neighbours\' value', q.slice(0, 7).filter((x) => x.label !== 'مدة بقاء الإعلان').every((x) => !!x.nearby && x.nearby.startsWith('أحياء قريبة')) && q[7].nearby === null);
check('values read plainly (1.3 مليون · 135 م² · 3 غرف (67%) · 3 سنوات · 28 موقعا)', q[0].value === '1.3 مليون' && q[1].value === '135 م²' && q[5].value === '3 غرف (67%)' && q[6].value === '3 سنوات' && q[7].value === '28 موقعا', JSON.stringify(q.map((x) => x.value)));
check('how long ads stay up: with too few removals here and none for the city either, «قريبا»', q[2].value === SOON.ar);
const withCity = parseMapCard({ data: { ...raw, stay_city: { city: 'الرياض', days: 86 } }, error: null }) as MapCard;
check('with too few removals here, the CITY\'s number — named («86 يوما في الرياض»), never passed off as the district\'s', quickLook(withCity, 'ar')[2].value === '86 يوما في الرياض');
mustCatch('a city\'s number shown without naming the city', () => quickLook(withCity, 'ar')[2].value === '86 يوما');
const own = parseMapCard({ data: { ...raw, stay_days: 40, stay_city: { city: 'الرياض', days: 86 } }, error: null }) as MapCard;
check('the area\'s own number wins once it has 10 removals', quickLook(own, 'ar')[2].value === '40 يوما');
check('a nearby district with too few ads is left out of the chips', JSON.stringify(nearbyPrices(c, 'ar')) === JSON.stringify([{ name: 'القيروان', text: '9,396' }]));
check('no Arabic diacritics anywhere on the card', [...rNew.cells, ...rPpm.cells].every((x) => !MARKS.test(x.text)) && q.every((x) => !MARKS.test(x.label + x.value + (x.nearby ?? ''))));

// 2. the server reads the box's own ads, gates every window, floors every price, and gives a guest nothing
const migDir = join(root, 'supabase/migrations');
const files = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
const latestDef = (fn: string): string => {
  for (let i = files.length - 1; i >= 0; i--) {
    const src = readFileSync(join(migDir, files[i]), 'utf8');
    const at = src.search(new RegExp(`create or replace function public\\.${fn}\\(`));
    if (at < 0) continue;
    const open = /\bas\s+(\$[A-Za-z_]*\$)/.exec(src.slice(at));
    if (!open) return '';
    const bodyAt = at + open.index + open[0].length;
    const end = src.indexOf(open[1], bodyAt);
    return end < 0 ? '' : src.slice(at, end);
  }
  return '';
};
const core = latestDef('map_view_facts_core');
const card = latestDef('map_view_card_core');
const rpc = latestDef('map_view_card_ar');
const filterBlock = (src: string) => { const a = src.indexOf('from public.map_listing_points_ar s'); const b = src.indexOf('), f as (', a); const cc = src.indexOf('\n  )', b); return a > 0 && b > a && cc > b ? src.slice(a, cc) : ''; };
const PLACE_LINE = '\n      and (p_city is null or (s.city_ar = p_city and (p_districts is null or s.district_ar = any (p_districts))))';
// «نشر خلال» (owner 2026-11-14) narrows the card's own ads to the pins the map shows; the box's facts read every window at once
const POSTED_LINES = "\n      -- «نشر خلال» applies to the card too (owner 2026-11-14: «it should strictly follow what the user selected»)\n      and (p_posted_within_days is null or (k.posted_at is not null and k.posted_at >= now() - make_interval(days => p_posted_within_days)))";
const sameAds = (src: string) => { const x = src.split(PLACE_LINE).join('').split(POSTED_LINES).join(''); return src.includes(PLACE_LINE) && src.includes(POSTED_LINES) && filterBlock(x) !== '' && filterBlock(x) === filterBlock(core); };
check('the card reads the box\'s own ads: the facts filter word for word (plus only the named-district line)', sameAds(card));
mustCatch('a card filter that drifted from the box (a dropped rooms filter)', () => sameAds(card.replace('and (p_beds is null or s.bedrooms = any (p_beds)) ', '')));
const gated = (src: string) => /case when v_log_fresh and v_log_start <= w\.a then \(select count\(\*\) from gd/.test(src)
  && /case when v_diary_start <= w\.a and p_deals = array\['buy'\]::text\[\]\s+and not exists \(select 1 from public\.alert_event a where a\.kind = 'price_diary_unhealthy' and coalesce\(a\.resolved_at, now\(\)\) >= w\.a\)\s+then \(select count\(\*\) from cut/.test(src)
  && /'stay_days', \(select case when count\(\*\) >= 10 then round\(percentile_cont\(0\.5\)/.test(src)
  && /select case when count\(\*\) >= 10 then jsonb_build_object\('city', v ->> 'city_ar',/.test(src);
check('«اختفى» and «خفضوا السعر» wait until their log covers the whole window; how long ads stay up needs 10 removals (else the city\'s, from 10)', gated(card));
mustCatch('a «gone» week shown before the log covers it', () => gated(card.replace('case when v_log_fresh and v_log_start <= w.a then (select count(*) from gd', 'case when true then (select count(*) from gd')));
const floored = (src: string) => /'ppm', case when r\.ppm_n >= 10 and r\.ppm_med between 10 and 200000 then r\.ppm_med end/.test(src)
  && /group by o\.type_ar having count\(\*\) >= 10/.test(src) && /o\.type_ar = \(select ptype\.type_ar from ptype\)/.test(src)
  && (src.match(/case when count\(\*\) >= 10 then/g) ?? []).length >= 6;
check('every price is a median of ONE type from ≥ 10 ads, in sane bounds', floored(card));
mustCatch('a price per metre from 3 ads', () => floored(card.replace('r.ppm_n >= 10 and', 'r.ppm_n >= 3 and')));
mustCatch('prices that mix types', () => floored(card.replace('o.type_ar = (select ptype.type_ar from ptype)', 'true')));
mustCatch('price cuts counted through a window the diary was broken in', () => gated(card.replace(/\s+and not exists \(select 1 from public\.alert_event a where a\.kind = 'price_diary_unhealthy'[^\n]*/, '')));
const fairNearby = (src: string) => /v_nb\.neighbors, false, v ->> 'price_type', p_posted_within_days\);/.test(src) && /\n\s+p_types, p_beds, p_area_min, p_area_max, p_price_min, p_price_max, p_furnished, p_tables, p_tables2, p_types2, p_macro,\n\s+v ->> 'city_ar', v_nb\.neighbors/.test(src)
  && /'n_districts', greatest\(cardinality\(v_nb\.neighbors\), 1\)/.test(src) && /select p_price_type as type_ar where p_price_type is not null/.test(src);
check('«أحياء قريبة»: counts under the SAME filters, prices of the main card\'s type, averaged over every named neighbour', fairNearby(card));
mustCatch('neighbours counted on the price type only (all types here vs one type there)', () => fairNearby(card.replace(/\n(\s+)p_types, p_beds, p_area_min/, "\n$1array[v ->> 'price_type'], p_beds, p_area_min")));
mustCatch('a per-district average over only the neighbours that have ads', () => fairNearby(card.replace("'n_districts', greatest(cardinality(v_nb.neighbors), 1)", "'n_districts', greatest((v_nbv ->> 'n_districts')::int, 1)")));
check('the English card names the type in English', quickLook(c, 'en')[4].value === 'Apartment 49%');
const webSrc2 = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
check('a failed card download is reported and offers a retry (never a tap that does nothing)', /reportError\(e, \{ where: 'map card module download \(import MapFactsCard\)' \}\);\s*setCardLoadFailed\(true\);/.test(webSrc2) && /testID="map-card-load-failed"/.test(webSrc2));
check('«أمس» is the last FINISHED Riyadh day (never «اليوم»)', /v_day1 := \(date_trunc\('day', now\(\) at time zone 'Asia\/Riyadh'\)\) at time zone 'Asia\/Riyadh';/.test(card) && /\('y', v_day0, v_day1\)/.test(card));
check('«جديد» is the site\'s posting date, never first-seen', /from own o where o\.posted_at >= w\.a and o\.posted_at < w\.b/.test(card) && !/scraped_at/.test(card)
  && (card.match(/first_seen_at/g) ?? []).length === 2 && /a\.first_seen_at <= a\.posted_at \+ interval '3 days'/.test(card));
const guestNothing = (src: string) => { const i = src.indexOf("if auth.uid() is null then return jsonb_build_object('locked', true); end if;"); const j = src.indexOf('map_view_card_core('); return i > 0 && j > i && /if not coalesce\(\(select ff\.enabled from public\.ops_feature_flags ff where ff\.name = 'map_view_facts'\), false\) then return null;/.test(src); };
check('a guest gets {locked} before any number is read, and the off switch hides the card too', guestNothing(rpc));
mustCatch('a guest who gets the card', () => guestNothing(rpc.replace("if auth.uid() is null then return jsonb_build_object('locked', true); end if;", '')));

// 3. the map opens the card for the box's own view, loads it on the first tap, and closes it when the view changes
const web = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
const wired = (src: string) => /: factsBox \? \{ kind: 'box', box: factsBox, filter: pinFilter \} : null;/.test(src)
  && /factsPlace\.level === 'district' \? \{ kind: 'district', city: factsPlace\.city, district: factsPlace\.district, deals: pinFilter\.deals \} : null/.test(src)
  && /if \(!CardComp\) \{\s*void import\('@\/components\/MapFactsCard'\)/.test(src) && !/^import MapFactsCard/m.test(src)
  && /setCardTarget\(null\);/.test(src);
check('the card opens for the box\'s own view (or its named district), loads on the first tap, and closes on a new view', wired(web));
mustCatch('a card asked for a different box than the facts', () => wired(web.replace("{ kind: 'box', box: factsBox, filter: pinFilter }", "{ kind: 'box', box: paddedBox(mapRef.current!.region.center, mapRef.current!.region.span), filter: pinFilter }")));
const cardSrc = readFileSync(join(root, 'src/components/MapFactsCard.tsx'), 'utf8');
check('the card shows «couldn\'t load» on a failed read, and its ✕ is top-right', /card === null \? <Text/.test(cardSrc) && /✕ always top-right/.test(cardSrc) && /testID="map-card-close"/.test(cardSrc));


// 4. THE RESIDENTIAL-SALE CARD (owner 2026-11-14: «it should strictly follow what the user selected … we can go to jail»)
const saleRaw = {
  ...raw, any: 598, district_ar: 'حي النرجس', price_type: 'فيلا', sites: 6, median_price: 3300000, median_area: 300, price_low: 2500000, price_high: 4500000,
  stay_days: null, stay_city: { city: 'الرياض', days: 94 }, top_rooms: { rooms: 5, pct: 40 },
  n_priced: 463, ppm_all: 11373, rooms_share: { 4: 24, 5: 40, 6: 14 },
  by_rooms: [{ rooms: 4, n: 396, price: 2850000 }, { rooms: 5, n: 668, price: 3200000 }, { rooms: 6, n: 237, price: 3500000 }],
  price_types: ['فيلا', 'دور', 'شقة'], site_list: ['aqar', 'wasalt', 'rakez', 'sukna', 'propertyfinder', 'justsa', 'dealapp', 'bayut'],
  weeks: [{ start: '2026-11-15', n: 40, ppm: 11250 }, { start: '2026-11-22', n: 9, ppm: null }, { start: '2026-11-29', n: 41, ppm: 11400 },
          { start: '2026-12-06', n: 38, ppm: 11310 }, { start: '2026-12-13', n: 44, ppm: 11373 }],
  table: { ...raw.table, w: { ...raw.table.w, new: 6 }, m: { ...raw.table.m, new: 34 } },
  nb: { ...raw.nb, names: ['حي الياسمين', 'حي العارض', 'حي الندى', 'حي الصحافة'], n_districts: 4, median_area: 305, n_priced: 383, ppm_all: 10967, rooms_share: { 4: 29, 5: 33 },
        by_district: [{ district: 'حي العارض', ppm: 11200 }, { district: 'حي الندى', ppm: null }, { district: 'حي الصحافة', ppm: 10045 }] },
};
const sc = parseMapCard({ data: saleRaw, error: null }) as MapCard;
const F = { deals: ['buy'], types: ['فيلا'], beds: [5], areaMin: 250, areaMax: 400 };
check('sale: only a residential SALE gets the new card', isSaleCard({ deals: ['buy'] }) && isSaleCard({ deals: ['buy'], category: 'residential' })
  && !isSaleCard({ deals: ['rent'] }) && !isSaleCard({ deals: ['buy'], category: 'commercial' }) && !isSaleCard({ deals: ['buy', 'rent'] }) && !isSaleCard({ deals: ['buy'], scope: { macro: 'Commercial' } }));
check('sale: the title reads out the user\'s choice (Arabic «من … إلى …», never a flipping dash)', saleTitle('فيلا', F, 'ar') === 'فلل للبيع · 5 غرف · من 250 إلى 400 م²', saleTitle('فيلا', F, 'ar'));
check('sale: the English title too', saleTitle('فيلا', F, 'en') === 'Villas for sale · 5 rooms · 250–400 m²', saleTitle('فيلا', F, 'en'));
check('sale: every filter the user picked is in the title (price, furnished, «نشر خلال», a drawn area)',
  saleTitle('شقة', { priceMax: 1500000, furnished: true, postedWithinDays: 7, poly: {} }, 'ar') === 'شقق للبيع · حتى 1.5 مليون ريال · مفروشة · نشرت خلال 7 أيام · منطقة مرسومة', saleTitle('شقة', { priceMax: 1500000, furnished: true, postedWithinDays: 7, poly: {} }, 'ar'));
mustCatch('a title that drops a picked filter', () => !saleTitle('فيلا', { ...F, furnished: false }, 'ar').includes('غير مفروشة'));
check('sale: the subtitle names the place and says the prices are displayed ones, from how many sites', saleSubtitle(sc, 'x', 'ar') === 'حي النرجس، الرياض · الأسعار المعروضة في الإعلانات · من 6 مواقع');
check('sale: under 5% from the neighbours the sentence says «قريب», never «أعلى»', saleSentence(sc, true, 'ar') === 'سعر المتر المعروض لهذه الفلل هنا حوالي 11,400 ريال، وقريب من الأحياء القريبة بنفس الفلاتر.'
  && saleSentence(sc, true, 'en') === 'The displayed price per m² for these villas here is about 11,400 SAR, close to nearby districts with the same filters.', String(saleSentence(sc, true, 'ar')));
const far = parseMapCard({ data: { ...saleRaw, ppm_all: 12500 }, error: null }) as MapCard;
check('sale: a real gap is said with neutral words («أعلى … بحوالي 14 بالمئة»)', saleSentence(far, false, 'ar')!.includes('أعلى من الأحياء القريبة بحوالي 14 بالمئة'), String(saleSentence(far, false, 'ar')));
check('sale: the three numbers say «المعروض»', JSON.stringify(saleNumbers(sc, 'ar')) === JSON.stringify([{ value: '3.3 مليون', label: 'السعر المعروض المعتاد' }, { value: '11,373', label: 'سعر المتر المعروض' }, { value: '34', label: 'جديد هذا الشهر' }]));
const few = parseMapCard({ data: { ...saleRaw, ppm_all: null, median_price: null }, error: null }) as MapCard;
check('sale: a number from fewer than 10 ads says «إعلانات قليلة», never a guess', saleNumbers(few, 'ar')[0].value === FEW.ar && saleNumbers(few, 'ar')[1].value === FEW.ar && saleSentence(few, true, 'ar') === null);
const dRooms = saleDiffs(sc, true, 'ar');
check('sale: the comparison is measured facts only — price, size, ads (rooms left out when the user picked the rooms)',
  JSON.stringify(dRooms) === JSON.stringify(['سعر المتر المعروض 11,373 هنا مقابل 10,967، أعلى بحوالي 4\u00a0بالمئة', 'المساحة متقاربة، 300 م² هنا مقابل 305 م²', 'عدد الإعلانات هنا أكثر، 463 مقابل حوالي 96 لكل حي قريب']), JSON.stringify(dRooms));
check('sale: with no rooms picked, the rooms line compares the SAME room count nearby', saleDiffs(sc, false, 'ar').includes('الفلل بـ5 غرف أكثر هنا، 40% من الإعلانات مقابل 33%'), JSON.stringify(saleDiffs(sc, false, 'ar')));
mustCatch('a neighbours\' count compared as their TOTAL (a big area compared unfairly)', () => saleDiffs(parseMapCard({ data: { ...saleRaw, nb: { ...saleRaw.nb, n_districts: 1 } }, error: null }) as MapCard, true, 'ar')[2] === dRooms[2]);
check('sale: no neighbours → no comparison at all', saleDiffs(parseMapCard({ data: { ...saleRaw, nb: null }, error: null }) as MapCard, false, 'ar').length === 0);
check('sale: price by rooms only when the user did not pick the rooms', saleRooms(sc, true, 'ar').length === 0 && JSON.stringify(saleRooms(sc, false, 'ar').map((r) => r.label)) === JSON.stringify(['4 غرف', '5 غرف', '6 غرف']));
const det = saleDetails(sc, 'ar');
check('sale: details show only numbers that exist; a city number is named («94 يوما في الرياض»); a range reads «من … إلى …»',
  JSON.stringify(det.map((r) => r.label)) === JSON.stringify(['جديد هذا الأسبوع', 'خفضت سعرها أمس', 'المساحة المعتادة', 'نطاق الأسعار المعروضة', 'مدة بقاء الإعلان'])
  && det[3].value === 'من 2.5 مليون إلى 4.5 مليون' && det[4].value === '94 يوما في الرياض', JSON.stringify(det));
check('sale: «اختفت» shows only once its log covers a window (never a 0 that means «not measured»)', !det.some((r) => r.label.startsWith('اختفت')));
check('sale: the weekly graph is the latest run of weeks with ≥ 10 ads, at least 3 — a thin week breaks the run', JSON.stringify(saleWeeks(sc)?.map((w) => w.start)) === JSON.stringify(['2026-11-29', '2026-12-06', '2026-12-13']));
mustCatch('a graph drawn across a thin week', () => (saleWeeks(sc)?.length ?? 0) === 5);
check('sale: two finished weeks are not a graph', saleWeeks(parseMapCard({ data: { ...saleRaw, weeks: saleRaw.weeks.slice(3) }, error: null }) as MapCard) === null);
check('sale: at most 6 logos, the rest counted', JSON.stringify(saleSites(sc, 'ar')) === JSON.stringify({ shown: ['aqar', 'wasalt', 'rakez', 'sukna', 'propertyfinder', 'justsa'], more: 'وموقعان آخران' }));
const allSale = (c: MapCard) => (['ar', 'en'] as const).flatMap((l) => [saleTitle(c.priceType, F, l), saleSubtitle(c, 'x', l), saleSentence(c, true, l) ?? '', saleSentence(c, false, l) ?? '',
  ...saleNumbers(c, l).flatMap((n) => [n.value, n.label]), ...saleDiffs(c, false, l), ...saleDiffs(c, true, l), ...saleRooms(c, false, l).flatMap((r) => [r.label, r.value]),
  ...saleDetails(c, l).flatMap((r) => [r.label, r.value]), DISCLAIMER[l]]);
const banned = (texts: string[]) => texts.some((x) => BANNED_WORDS.some((w) => x.toLowerCase().includes(w)));
check('sale: no word that judges a price (أرخص · فرصة · صفقة · cheap · deal …) anywhere on the card, Arabic or English', !banned([...allSale(sc), ...allSale(far), ...allSale(few)]));
mustCatch('«أرخص» slipped into a sentence', () => !banned([saleSentence(far, false, 'ar')!.replace('أعلى', 'أرخص')]));
check('sale: no Arabic diacritics on the sale card', ![...allSale(sc), ...allSale(far)].some((x) => MARKS.test(x)));
check('sale: the disclaimer says displayed ads, not sale prices, not a valuation, not advice, check the advertiser, no responsibility',
  ['أسعار معروضة في إعلانات', 'ليست أسعار بيع', 'تقييما عقاريا', 'نصيحة', 'تحقق دائما من المعلن', 'لا تتحمل إزهله أي مسؤولية'].every((w) => DISCLAIMER.ar.includes(w))
  && ['displayed prices', 'not sale prices', 'valuation', 'advice', 'check with the advertiser', 'no responsibility'].every((w) => DISCLAIMER.en.includes(w)));
const saleSrc = readFileSync(join(root, 'src/components/MapSaleCard.tsx'), 'utf8');
const shows = (src: string) => /testID="map-card-disclaimer">\{DISCLAIMER\[loc\]\}<\/Text>/.test(src) && /testID="map-card-more"/.test(src)
  && /\{open \? \(ar \? 'إخفاء التفاصيل' : 'Hide details'\) : \(ar \? 'عرض تفاصيل أكثر' : 'Show more details'\)\}/.test(src) && /const rtl = loc === 'ar';/.test(src) && /rtl \? W - x : x/.test(src);
check('sale: the card always shows the disclaimer, a clear «عرض تفاصيل أكثر» button, and an Arabic graph that runs right to left', shows(saleSrc));
mustCatch('a card without its disclaimer', () => shows(saleSrc.replace('testID="map-card-disclaimer">{DISCLAIMER[loc]}</Text>', 'testID="map-card-disclaimer">{null}</Text>')));
const factsSrc = readFileSync(join(root, 'src/components/MapFactsCard.tsx'), 'utf8');
check('sale: the map card hands a residential sale to the new card and keeps the ✕ top-right', /const sale = isSaleCard\(target\.kind === 'box' \? target\.filter : \{ deals: target\.deals \}\);/.test(factsSrc) && /<MapSaleCard card=\{card\}/.test(factsSrc) && /style=\{s\.close\}/.test(factsSrc));
const dataSrc = readFileSync(join(root, 'src/data/mapCard.ts'), 'utf8');
check('sale: the card read sends «نشر خلال» and the tapped type', /p_posted_within_days: t\.filter\.postedWithinDays/.test(dataSrc) && /p_price_type: priceType/.test(dataSrc));

// 5. the server: «نشر خلال» counted, the graph only from the complete record and the SAME filters, the night checker recounts
const kb = (src: string, from: string, alias: string) => { const a = src.indexOf(`from public.${from} ${alias}\n    where`); const b = src.indexOf('\n      and (v_geom is null', a); const e = src.indexOf('\n', b + 5); return a > 0 && b > a ? src.slice(src.indexOf('\n', a) + 1, e) : ''; };
const keptBlock = kb(card, 'map_listing_points_ar', 's');
const seenBlock = kb(card, 'map_fact_ad_seen', 'a');
const sameFilters = (src: string) => { const k = kb(src, 'map_listing_points_ar', 's'); const g = kb(src, 'map_fact_ad_seen', 'a'); return k !== '' && g !== '' && g === k.replace(/(?<![\w.])s\./g, 'a.'); };
check('server: the weekly graph reads the SAME filters as the card, word for word', sameFilters(card), `${keptBlock.length}/${seenBlock.length}`);
mustCatch('a graph that drops the rooms filter', () => sameFilters(card.replace('and (p_beds is null or a.bedrooms = any (p_beds)) ', '')));
const gatedGraph = (src: string) => /and a\.deal = 'buy' and p_deals = array\['buy'\]::text\[\] and p_posted_within_days is null/.test(src)
  && /and a\.type_ar = \(select ptype\.type_ar from ptype\) and a\.price > 0 and a\.area_m2 > 0/.test(src)
  && /ss\.first_seen <= a\.posted_at - interval '30 days'/.test(src) && /ws\.ws \+ interval '10 days' <= now\(\)/.test(src)
  && /cr\.run_at >= ws\.ws and cr\.run_at < ws\.ws \+ interval '10 days'\) >= 10/.test(src) && /'ppm', case when q\.n >= 10 and q\.med between 10 and 200000 then q\.med end/.test(src)
  && /x\.platform = min|s0\.platform = min\(s0\.platform\) over \(partition by s0\.type_ar, s0\.price, s0\.area_m2, s0\.city_ar, s0\.district_ar\)/.test(src);
check('server: a weekly point = one type, ≥ 10 ads, copies once, a finished week the record covered every day, sites read 30 days, never with «نشر خلال»', gatedGraph(card));
mustCatch('a week drawn before the record covered it', () => gatedGraph(card.replace(">= 10\n    order by ws.ws desc", ">= 1\n    order by ws.ws desc")));
mustCatch('a newly added site moving the graph', () => gatedGraph(card.replace("interval '30 days')\n  ), sn as", "interval '0 days')\n  ), sn as")));
const postedCounted = (src: string) => /and \(p_posted_within_days is null or \(k\.posted_at is not null and k\.posted_at >= now\(\) - make_interval\(days => p_posted_within_days\)\)\)/.test(src)
  && /and \(p_posted_within_days is null or \(r\.posted_at is not null and r\.posted_at >= now\(\) - make_interval\(days => p_posted_within_days\)\)\)/.test(src);
check('server: «نشر خلال» narrows the card exactly as it narrows the pins', postedCounted(card));
mustCatch('a card that ignores «نشر خلال»', () => postedCounted(card.replace(/\n\s+and \(p_posted_within_days is null or \(k\.posted_at[^\n]*/, '')));
const capture = latestDef('map_fact_capture_removals');
check('server: every new ad is kept as first seen, and stays after it leaves', /insert into public\.map_fact_ad_seen[\s\S]*from public\.map_fact_points_snapshot p\s+on conflict \(source_table, listing_id\) do nothing;/.test(capture));
const audit = latestDef('audit_map_view_card');
const audits = (src: string) => ['ppm_all', 'n_priced', 'by_rooms', 'price_types', 'weeks'].every((k) => src.includes(`why := why || '${k}'`))
  && (src.match(/jsonb_typeof\(c -> /g) ?? []).length >= 4 && /update public\.ops_feature_flags set enabled = false/.test(src);
check('server: the night checker recounts the new numbers, reads lists safely, and hides the card on any mismatch', audits(audit));
mustCatch('a checker that stops recounting the price by rooms', () => audits(audit.replace("why := why || 'by_rooms'", "why := why")));

console.log(failed ? `\n${failed} check(s) FAILED` : '\nverify-map-card: all checks passed');
process.exit(failed ? 1 : 0);
