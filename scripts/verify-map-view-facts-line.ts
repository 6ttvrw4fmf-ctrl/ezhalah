// The map pill's second line can't be wrong — THE SCREEN HALF (owner 2026-11-12). Executes the rules that decide what
// the line may SAY (src/lib/mapViewFacts.ts) and checks the map asks for the box its count was read over. The server
// half is scripts/verify-map-view-facts.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { factLine, lockedLine, newAdsAr, goneAr, parseViewFacts, monthArrow, FACTS_MIN_ADS, ARROW_MIN_COUNT, type ViewFacts } from '../src/lib/mapViewFacts.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? ' — ' + info : ''}`); if (!ok) failed++; };
const mustCatch = (name: string, mutantPasses: () => boolean) => check(`(mutation) catches ${name}`, !mutantPasses());
const MARKS = /[ً-ْ]/;

const full: ViewFacts = { any: 1081, locked: false, new30: 123, gone30: 85, median: 1_350_000 };
const text = (f: ViewFacts | null, shown: number | null, loc: 'ar' | 'en' = 'ar') => { const l = factLine(f, shown, loc); return l.kind === 'facts' ? l.text.replace(/[\u2066\u2069]/g, '') : l.kind; };
const arrow = (n: number | null, p: number | null | undefined, k: 'count' | 'price') => monthArrow(n, p, k).replace(/[\u2066\u2069]/g, '');

// 1. what the line says
check('the full line reads as agreed', text(full, 1081) === 'آخر 30 يوما: 🆕 123 إعلان جديد · ⚡ 85 اختفى · 💰 متوسط السعر 1.4 مليون', text(full, 1081));
check('a failed read (null) says nothing — never «0»', text(null, 1081) === 'none');
check('facts for OTHER ads than the pill counts say nothing (any ≠ shown)', text(full, 1080) === 'none' && text(full, null) === 'none');
check(`a view under ${FACTS_MIN_ADS} ads says nothing`, text({ ...full, any: FACTS_MIN_ADS - 1 }, FACTS_MIN_ADS - 1) === 'none');
check('no ⚡ before the 30-day removal log exists (gone null)', !String(text({ ...full, gone30: null }, 1081)).includes('⚡'));
check('no 💰 without a single picked type (median null)', !String(text({ ...full, median: null }, 1081)).includes('💰'));
check('a zero part is left out, and all-zero says nothing', !String(text({ ...full, new30: 0 }, 1081)).includes('🆕') && text({ ...full, new30: 0, gone30: 0, median: null }, 1081) === 'none');
check('«إعلان جديد», never «جديد» alone (the Filter\'s «جديد» means newly built)', /إعلان(ات)? جديد(ة)?|إعلانان جديدان/.test(String(text(full, 1081))));
check('Arabic words follow the count: 1, 2, 3, 11, 103', newAdsAr(1) === 'إعلان جديد واحد' && newAdsAr(2) === 'إعلانان جديدان' && newAdsAr(3) === '3 إعلانات جديدة' && newAdsAr(11) === '11 إعلان جديد' && newAdsAr(103) === '103 إعلانات جديدة' && goneAr(5) === '5 اختفت' && goneAr(85) === '85 اختفى');
check('no Arabic diacritics anywhere in the line', [text(full, 1081), lockedLine({ ...full, locked: true, has: { new: true, gone: true, median: true } }, 'ar').ask].every((x) => !MARKS.test(String(x))));
check('English reads too', text(full, 1081, 'en') === 'Last 30 days: 🆕 123 new listings · ⚡ 85 gone · 💰 avg price 1.4M', text(full, 1081, 'en'));

// 1b. the arrow against last month — only a real change
check('a real change gets an arrow: 123 vs 110 new → ↑12%, price 1.40M vs 1.35M → ↑4%, 85 vs 100 gone → ↓15%', arrow(123, 110, 'count') === ' ↑12%' && arrow(1_400_000, 1_350_000, 'price') === ' ↑4%' && arrow(85, 100, 'count') === ' ↓15%');
check('noise gets none: a count move under 10%, a price move under 3%', monthArrow(123, 120, 'count') === '' && monthArrow(1_390_000, 1_360_000, 'price') === '');
check(`small numbers get none (either month under ${ARROW_MIN_COUNT})`, monthArrow(19, 10, 'count') === '' && monthArrow(40, 12, 'count') === '');
check('no baseline, no arrow', monthArrow(123, null, 'count') === '' && monthArrow(123, undefined, 'count') === '' && monthArrow(123, 0, 'count') === '');
check('the line carries the arrows', text({ ...full, prevNew30: 110, prevGone30: 100, prevMedian: 1_300_000 }, 1081) === 'آخر 30 يوما: 🆕 123 إعلان جديد ↑12% · ⚡ 85 اختفى ↓15% · 💰 متوسط السعر 1.4 مليون ↑4%', String(text({ ...full, prevNew30: 110, prevGone30: 100, prevMedian: 1_300_000 }, 1081)));
check('the arrow is isolated left-to-right so Arabic shows «↑12%», not «%12↑»', monthArrow(123, 110, 'count') === ' \u2066↑12%\u2069');
check('a guest never gets an arrow (no numbers, no changes)', parseViewFacts({ data: { locked: true, any: 1081, has_new: true, prev_new30: 50 }, error: null })?.prevNew30 === undefined);
mustCatch('an arrow on a 2% price wobble', () => { const loose = (n: number, p: number) => { const pct = Math.round(((n - p) / p) * 100); return pct === 0 ? '' : `${pct}`; }; return loose(1_390_000, 1_360_000) === ''; });

// 2. the guest
const guest = parseViewFacts({ data: { locked: true, any: 1081, has_new: true, has_gone: false, has_median: true, new30: 123, median: 1_350_000 }, error: null });
check('a guest\'s facts carry no numbers, even if the server sent some', !!guest && guest.locked && guest.new30 === null && guest.median === null && guest.gone30 === null);
check('a guest sees the locked line, blurred shapes only for parts that exist', factLine(guest, 1081, 'ar').kind === 'locked' && !!guest && lockedLine(guest, 'ar').blurred === '🆕 888 · 💰 8.8');
check('a guest view with nothing to show says nothing', factLine({ any: 1081, locked: true, new30: null, gone30: null, median: null, has: { new: false, gone: false, median: false } }, 1081, 'ar').kind === 'none');
check('parse: an error or no data is null', parseViewFacts({ data: null, error: null }) === null && parseViewFacts({ data: full, error: { message: 'x' } }) === null);
mustCatch('a line that ignores the pill\'s count', () => { const ignoresPill = (f: ViewFacts, _shown: number) => factLine(f, f.any, 'ar'); return ignoresPill(full, 1080).kind === 'none'; });

// 4. the screen asks for the box the count was read over, and compares with the number it shows
const web = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
const wired = (src: string) => /setPinCount\(pillCount\(rows\)\); setFactsBox\(paddedBox\(center, span\)\);/.test(src)
  && (src.match(/setFactsBox\(paddedBox/g) ?? []).length === 1
  && /const my = \+\+seq;\s*setFactsBox\(null\);/.test(src)
  && /factLine\(viewFacts, hasShape \? null : placeCount \?\? pinCount,/.test(src)
  && /fetchViewFacts\(box, pinFilter, !!user\)/.test(src);
check('the map asks for the counted box and shows the line only against the number it shows', wired(web));
mustCatch('a line compared with a different number than the pill shows', () => wired(web.replace('factLine(viewFacts, hasShape ? null : placeCount ?? pinCount,', 'factLine(viewFacts, viewFacts?.any ?? null,')));
mustCatch('facts asked for an area total (a box the count was not read over)', () => wired(web.replace('setPinCount(areasTotal(areas));', 'setPinCount(areasTotal(areas)); setFactsBox(paddedBox(center, span));')));
mustCatch('a new map read that keeps the last box (facts for the previous view)', () => wired(web.replace(/(const my = \+\+seq;)\s*setFactsBox\(null\);[^\n]*/, '$1')));

console.log(failed ? `\n${failed} check(s) FAILED` : '\nverify-map-view-facts-line: all checks passed');
process.exit(failed ? 1 : 0);
