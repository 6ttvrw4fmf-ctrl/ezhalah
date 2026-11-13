// THE CARD LAYOUT RULE (owner 2026-11-13: «build it, make it a rule … we don't want mistakes»).
//   1. The price leads its line (right edge in Arabic); nothing is drawn before it in the headline.
//   2. The 📍 line says «district، city» — never «… المملكة العربية السعودية».
//   3. The site's own date reads «اليوم / أمس / قبل يومين / قبل N أيام / قبل N يوم» up to 29 days, FIRST in the facts
//      row; older, future or unreadable dates show the date itself (never a guess). Riyadh's day decides «اليوم».
//   4. The strip and «مستضاف على» name the website, not its domain.
//   5. What the Advanced Filter asked for keeps its ✓ and moves to the front (owner 2026-10-05).
// The date words are EXECUTED (src/lib/listedAgo.ts has no imports); the layout is read from ResultCard with a
// mutation for each fact.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listedAgoText, daysSinceCardDate, riyadhToday, AGO_MAX_DAYS } from '../src/lib/listedAgo.ts';

const root = join(import.meta.dirname ?? '.', '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  → ${detail}`}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

// ── 3. the words ──
const T = { y: 2026, m: 11, d: 13 };
const cases: [string, string, string][] = [
  ['13/11/2026', 'اليوم', 'Today'], ['12/11/2026', 'أمس', 'Yesterday'], ['11/11/2026', 'قبل يومين', '2 days ago'],
  ['10/11/2026', 'قبل 3 أيام', '3 days ago'], ['03/11/2026', 'قبل 10 أيام', '10 days ago'], ['02/11/2026', 'قبل 11 يوم', '11 days ago'],
  ['15/10/2026', 'قبل 29 يوم', '29 days ago'], ['14/10/2026', '', ''], ['14/11/2026', '', ''], ['31/02/2026', '', ''], ['recently', '', ''], ['', '', ''],
  ['31/12/2025', '', ''], ['01/01/2026', '', ''],
];
const bad = cases.filter(([d, ar, en]) => listedAgoText(d, 'ar', T) !== ar || listedAgoText(d, 'en', T) !== en);
check(`the date words follow the rule on ${cases.length} cases (month and year edges, future, 30+ days, junk)`, bad.length === 0, JSON.stringify(bad.map(([d]) => [d, listedAgoText(d, 'ar', T)])));
check('the cut-off is 29 days', AGO_MAX_DAYS === 29);
check('a month boundary counts real days (01/11 → 13/11 = 12)', daysSinceCardDate('01/11/2026', T) === 12);
// «اليوم» is Riyadh's day: 22:30 UTC on the 12th is already the 13th in Riyadh.
const r = riyadhToday(new Date(Date.UTC(2026, 10, 12, 22, 30)));
check('«today» is the Riyadh calendar day, not the viewer\'s', r.y === 2026 && r.m === 11 && r.d === 13, JSON.stringify(r));

// ── 1, 2, 4, 5. the layout ──
const CARD = readFileSync(join(root, 'src/components/ResultCard.tsx'), 'utf8');
function layout(src: string): string[] {
  const out: string[] = [];
  const head = src.slice(src.indexOf('<View style={card.headline}>'), src.indexOf('</View>', src.indexOf('<View style={card.headline}>')));
  if (!head || /<Text style=\{\[card\.title/.test(head)) out.push('something is drawn before the price in the headline');
  if (!/testID="card-price"/.test(head)) out.push('the price is not in the headline');
  if (/t\('Saudi Arabia'\)/.test(src)) out.push('the 📍 line still says «المملكة العربية السعودية»');
  if ((src.match(/testID="card-place">\s*\{\(place\(arabicOrPlaceholder\(t\(listing\.district\)/g) ?? []).length < 2) out.push('a place line does not lead with the district');
  if (/\{sourceHost\(listing\.source\)\}<\/Text>/.test(src)) out.push('a strip still prints the domain');
  if (!/numberOfLines=\{row \? 1 : undefined\}>\{siteName\}<\/Text>/.test(src)) out.push('the photo strip does not name the website');
  // Every facts row — the phone card and the laptop card — opens with «اليوم».
  const rows = src.split('<View style={card.statsRow}>').slice(1);
  if (rows.length < 2 || rows.some((r) => !/^\s*(\{\/\*[^]*?\*\/\}\s*)?\{listedClean && listedAgo \? <View style=\{card\.agoPill\}/.test(r))) out.push('«اليوم» is not the first thing in every facts row');
  if (/value: listedClean \}\);/.test(src) && !/if \(listedClean && !listedAgo && lpFacts\.length < 3\)/.test(src)) out.push('the laptop card shows the date twice');
  if (!/\.\.\.allActive\.filter\(\(f\) => pickedFeatures\.has\(f\.key\)\), \.\.\.allActive\.filter\(\(f\) => !pickedFeatures\.has\(f\.key\)\)/.test(src)) out.push('Advanced Filter picks no longer move to the front');
  if (!/name=\{picked \? 'checkmark-circle' : f\.icon\}/.test(src)) out.push('Advanced Filter picks lost their ✓');
  return out;
}
const L = layout(CARD);
check(`the card layout follows the rule${L.length ? ' → ' + L.join('; ') : ''}`, L.length === 0);
mustCatch('the place drawn before the price again', layout(CARD.replace('<View style={card.headline}>', '<View style={card.headline}>\n        <Text style={[card.title, tight && card.titleTight]}>x</Text>')).length > 0);
mustCatch('«المملكة العربية السعودية» back on the 📍 line', layout(CARD.replace('testID="card-place">', 'testID="card-place">{t(\'Saudi Arabia\')}')).length > 0);
mustCatch('the domain back on the photo strip', layout(CARD.replace('numberOfLines={row ? 1 : undefined}>{siteName}</Text>', 'numberOfLines={row ? 1 : undefined}>{sourceHost(listing.source)}</Text>')).length > 0);
mustCatch('«اليوم» moved off the front of the facts row', layout(CARD.replace(/(<View style=\{card\.statsRow\}>)/, '$1\n          <Stat icon="x" big="y" small="z" />\n          <Stat icon="x" big="y" small="z" />\n          <Stat icon="x" big="y" small="z" />\n          <Stat icon="x" big="y" small="z" />')).length > 0);
mustCatch('Advanced Filter picks not moved to the front', layout(CARD.replace('[...allActive.filter((f) => pickedFeatures.has(f.key)), ...allActive.filter((f) => !pickedFeatures.has(f.key))]', 'allActive')).length > 0);
mustCatch('a date word with no cut-off', listedAgoText('01/01/2026', 'ar', T) !== '' ? true : (() => { const n = daysSinceCardDate('01/01/2026', T); return n !== null && n > AGO_MAX_DAYS; })());

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\ncard layout rule holds: price first, district and city, «اليوم», site name, ✓ for picks');
