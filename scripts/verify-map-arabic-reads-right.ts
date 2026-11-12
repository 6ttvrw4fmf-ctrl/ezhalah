// The map's Arabic reads right (2026-11-12, found live on ezhalah.com): the filter button said «عرض 10 إعلان»
// (3–10 take «إعلانات»), and the «نشر خلال» menu wrote «14 يوماً» / «12 شهراً» with tanween, against the owner's
// «we can never have 7arakat». Executes the count words and scans the map's own strings for marks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adsNounAr, showAdsAr, viewCountText } from '../src/lib/mapPins.ts';
import { postedPhrase } from '../src/lib/postedWindows.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? ' — ' + info : ''}`); if (!ok) failed++; };
const MARKS = /[ً-ْ]/;

check('«عرض 10 إعلانات» — 3 to 10 take إعلانات', showAdsAr(10) === 'عرض 10 إعلانات' && showAdsAr(3) === 'عرض 3 إعلانات', showAdsAr(10));
check('«عرض 11 إعلان», «عرض 1,250 إعلان» — 11 and up take إعلان', showAdsAr(11) === 'عرض 11 إعلان' && showAdsAr(1250) === 'عرض 1,250 إعلان');
check('one and two read as words: «عرض إعلان واحد», «عرض إعلانين»', showAdsAr(1) === 'عرض إعلان واحد' && showAdsAr(2) === 'عرض إعلانين');
check('zero says so: «لا توجد إعلانات»', showAdsAr(0) === 'لا توجد إعلانات');
check('the last two digits decide: 103 → إعلانات, 110 → إعلانات, 111 → إعلان, 200 → إعلان', adsNounAr(103) === 'إعلانات' && adsNounAr(110) === 'إعلانات' && adsNounAr(111) === 'إعلان' && adsNounAr(200) === 'إعلان');
check('the map count line uses the same word', viewCountText(10, 'الرياض', 'ar') === '10 إعلانات في الرياض' && viewCountText(105, null, 'ar') === '105 إعلانات في هذه المنطقة');

const i18n = readFileSync(join(root, 'src/i18n.tsx'), 'utf8');
const lines = i18n.split('\n').filter((l) => /^\s*'(Published[^']*|The map could not load|Couldn’t load the listings here\. Try again|No route found between these two places|Only ads whose site shows a publish date[^']*)':/.test(l));
check('the «نشر خلال» menu and map messages have no diacritics', lines.length >= 13 && !lines.some((l) => MARKS.test(l)), `${lines.length} lines; marked: ${lines.filter((l) => MARKS.test(l)).length}`);
check('the search sentence\'s window has none either («آخر 30 يوما»)', [1, 7, 14, 30, 90, 183, 365, 730, 1095].every((d) => !MARKS.test(postedPhrase(d, 'ar'))) && postedPhrase(30, 'ar') === '، منشور خلال آخر 30 يوما');
check('(mutation) a marked label is caught', MARKS.test("'Published: 14 days': '14 يوماً',"));

const card = readFileSync(join(root, 'src/components/MapFilterCard.tsx'), 'utf8');
const wired = (src: string) => (src.match(/isRTL \? showAdsAr\(count\) : t\('Show \{n\} listings'/g) ?? []).length === 2;
check('both map filter buttons (phone and wide) use the Arabic count words', wired(card));
check('(mutation) catches the button back on «عرض {n} إعلان»', !wired(card.replace('isRTL ? showAdsAr(count) : ', '')));

console.log(failed ? `\n${failed} check(s) FAILED` : '\nverify-map-arabic-reads-right: all checks passed');
process.exit(failed ? 1 : 0);
