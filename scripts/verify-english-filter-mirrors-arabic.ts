// THE ENGLISH FILTER IS A MIRROR OF THE ARABIC ONE (owner 2026-10-09).
//
// Owner, verbatim intent: «The Arabic is perfect, but the English is just the translation version. It should be the
// same text size as Claude and ChatGPT … You just mirror it to Arabic, that's it, and the user can select the city
// he wants in English. The district, everything is in English.» And: the toggle is «Smart Broker», and the sparkle
// beside it «doesn't look professional enough».
//
// What was wrong, measured on production 2026-10-09 (390 px phone + 1440 px laptop, English UI):
//   • ten text styles were pinned right-to-left for the Arabic, so English read «?Which city», right-aligned fields,
//     a right-aligned «Refine your search» card;
//   • typing «Riyadh», «Jeddah» or «Khobar» found NOTHING: Latin input was refused on purpose (Arabic-only era);
//   • wording that was not a translation («Smart Assis…» cut off, «Ezhalah An AI-powered platform…», «SAR currency»,
//     an Arabic «م²» in English), upper-case eyebrows, and Latin at the Arabic's 600-700 weights.
//
// This barrier EXECUTES the English matcher on the official names (src/data/sa-locations.json) and the translator on
// the English table, then pins the wiring that keeps the Arabic UI untouched. Each rule is proven to fail on its own
// defect (mustCatch).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latinRank, latinKey, isLatinQuery } from '../src/lib/locationSuggest.ts';
import { liftSymbols } from './lib/liftSymbols.ts';
import { windowBetween } from './lib/sourceWindow.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
};
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nThe English Filter mirrors the Arabic: same order, left-to-right, English names, typed in English\n');

// ── 1. typing in English finds the place by its OFFICIAL English name (executed) ─────────────────────────────────
const geo = JSON.parse(read('src/data/sa-locations.json')) as { cities: [number, number, string, string][] };
const enOf = (ar: string) => geo.cities.find((c) => c[3] === ar)?.[2];
const typed: [string, string][] = [
  ['Riyadh', 'الرياض'], ['riy', 'الرياض'], ['Jeddah', 'جدة'], ['Mecca', 'مكة المكرمة'], ['Medina', 'المدينة المنورة'],
  ['Dammam', 'الدمام'], ['Khobar', 'الخبر'], ['al khobar', 'الخبر'], ['Hofuf', 'الهفوف'], ['Buraydah', 'بريدة'], ['Taif', 'الطائف'],
];
const misses = typed.filter(([q, ar]) => latinRank(q, enOf(ar)) === null).map(([q, ar]) => `${q}→${ar} (${enOf(ar)})`);
check('every common English spelling finds its city by the official English name', misses.length === 0, misses.join(', '));
check('…and a different city is not offered for it («Jeddah» is not Riyadh)', latinRank('Jeddah', enOf('الرياض')) === null);
check('an English query is recognised as English, an Arabic one is not', isLatinQuery('Riyadh') && !isLatinQuery('الرياض') && !isLatinQuery('12'));
check('the matcher keeps letters of any script (language-neutral fold)', latinKey('Al Khobar') === 'khobar' && latinKey('نرجس') === 'نرجس');
mustCatch('a matcher that only compares the raw text (no article fold: «Khobar» vs «Al Khobar»)',
  (() => { const raw = (q: string, n: string) => n.toLowerCase().replace(/\s/g, '').startsWith(q.toLowerCase()); return !raw('khobar', 'Al Khobar'); })());

// ── 2. the English words are translations of the Arabic (executed on the real translator) ─────────────────────────
const i18n = await liftSymbols(join(ROOT, 'src/i18n.tsx'), [
  { header: 'const AR: Record<string, string> = {' }, { header: 'function fill(' },
  { header: 'const EN: Record<string, string> = {' }, { header: 'export function translate(' },
], ['translate'], "type Locale = 'ar' | 'en';");
const tr = i18n.translate as (l: 'ar' | 'en', k: string) => string;
const words: [string, string, string][] = [
  ['Smart Assistant', 'Smart Broker', 'الوسيط الذكي'], ['Any count', 'Any', 'أي عدد'], ['SAR currency', 'SAR', 'ريال'],
  ['ads', 'listings', 'إعلان'], ['m²', 'm²', 'م²'],
];
for (const [key, en, ar] of words) check(`«${ar}» reads «${en}» in English and is unchanged in Arabic`, tr('en', key) === en && tr('ar', key) === ar, `en=${tr('en', key)} ar=${tr('ar', key)}`);
check('the hero subtitle is a sentence, not «Ezhalah An AI-powered…»', /^Ezhalah is an /.test(tr('en', 'Ezhalah An AI-powered platform that searches real estate listings across Saudi Arabia.')));
mustCatch('a translator that ignores the English table (the key leaks: «Smart Assistant»)', tr('en', 'Smart Assistant') !== 'Smart Assistant');

// ── 3. Latin typing is the wrong script ONLY in the Arabic UI ───────────────────────────────────────────────────────
const index = read('src/app/index.tsx');
const home = windowBetween(index, 'export default function Home() {', '\nconst s = StyleSheet.create({', 'src/app/index.tsx');
const gateOk = (src: string) => /const wrongScript = \(v: string\) => locale === 'ar' && isLatinOnlyInput\(v\);/.test(src)
  && (src.match(/isLatinOnlyInput\(/g) ?? []).length === 1; // the gate is the only caller: no field bypasses it
check('Latin input is refused only in the Arabic UI, and every field asks the one gate', gateOk(home));
mustCatch('a field that calls isLatinOnlyInput directly again (English typing refused in the English UI)', !gateOk(home + '\nconst latin = isLatinOnlyInput(v);'));
mustCatch('a gate that forgets the locale (English typing refused everywhere)', !gateOk(home.replace("locale === 'ar' && isLatinOnlyInput(v)", 'isLatinOnlyInput(v)')));

// ── 4. every Arabic-pinned text on the Filter carries its English override ─────────────────────────────────────────
const sheet = windowBetween(index, '\nconst E = StyleSheet.create({', '\n});', 'src/app/index.tsx');
const eKeys = [...sheet.matchAll(/^  (\w+): /gm)].map((m) => m[1]);
const sBlock = windowBetween(index, '\nconst s = StyleSheet.create({', '\n});', 'src/app/index.tsx');
const rtlPinned = [...sBlock.matchAll(/^  (\w+): \{[^\n]*(?:textAlign: 'right'|writingDirection: 'rtl')/gm)].map((m) => m[1]);
const used = (k: string) => new RegExp(`\\bs\\.${k}\\b`).test(home);
const unmirrored = (src: string) => rtlPinned.filter((k) => new RegExp(`\\bs\\.${k}\\b`).test(src) && !eKeys.includes(k));
check('every right-to-left style the Filter renders has an English override (left-to-right)', unmirrored(home).length === 0, unmirrored(home).join(', '));
const bare = (src: string) => eKeys.filter((k) => k !== 'heroTitleWide' && k !== 'msg')
  .filter((k) => (src.match(new RegExp(`\\bs\\.${k}\\b`, 'g')) ?? []).length !== (src.match(new RegExp(`\\bx\\.${k}\\b`, 'g')) ?? []).length);
check('…and every place that draws one of them applies it (s.k always travels with x.k)', bare(home).length === 0, bare(home).join(', '));
check('the overrides are English-only (x is empty in Arabic)', /const x: Partial<typeof E> = locale === 'en' \? E : \{\};/.test(home));
check('there were RTL-pinned styles to protect (this rule is not vacuous)', rtlPinned.filter(used).length >= 6, rtlPinned.join(','));
mustCatch('a new label drawn with s.fieldLabelAbove and no English override («?Which city» again)', bare(home + '\n<Text style={s.fieldLabelAbove}>x</Text>').includes('fieldLabelAbove'));

// ── 5. the toggle and the shared pieces ────────────────────────────────────────────────────────────────────────────
const mode = read('src/components/ModeSwitch.tsx');
// Owner 2026-10-09: the filled, breathing green sparkle «doesn't look professional»; 2026-10-10: «include the AI star».
const aiStarIsClean = (src: string) => /name="sparkles-outline"/.test(src) && !/name="sparkles"/.test(src) && !/\bbreath\b/.test(src); // the animation's own variable, not the word in a comment
check('the Smart Broker side has the AI stars as a clean outline (not the filled, breathing sparkle)', aiStarIsClean(mode));
mustCatch('the filled sparkle coming back', !aiStarIsClean(mode.replace('name="sparkles-outline"', 'name="sparkles"')));
mustCatch('the breathing animation coming back', !aiStarIsClean(mode + '\nconst breath = useRef(new Animated.Value(0)).current;'));
// Owner 2026-10-10: «make the star dark green» — both active icons are the dark brand green (a matched pair).
const darkIcons = (src: string) => /name="sparkles-outline" size=\{17\} color=\{aiSteady \? colors\.dark : colors\.muted\}/.test(src)
  && /name="funnel-outline" size=\{17\} color=\{active === 'filter' \? colors\.dark : colors\.muted\}/.test(src);
check('the active star and funnel are dark green', darkIcons(mode));
mustCatch('the star back on the lighter green', !darkIcons(mode.replace('aiSteady ? colors.dark', 'aiSteady ? colors.primary')));
check('«Smart Broker» fits: the English segment is wider than the Arabic one', /const SEG_W_EN = 1[1-9]\d;/.test(mode) && /const segW = en \? SEG_W_EN : SEG_W;/.test(mode));
check('English labels use the system font on the web (Poppins is not loaded there: a serif fallback)', /en && \{ fontFamily: SYSTEM_FONT/.test(mode));
const ui = read('src/components/ui.tsx');
check('section labels are plain in English («Category»), upper-case eyebrows only where they never apply',
  /\{en \? children : children\.toUpperCase\(\)\}/.test(ui));
check('tiles do not cut «Apartments» in English (lighter, tighter English tile text)', /boxTextEn: \{ fontSize: 12, fontWeight: '500'/.test(ui) && /en && !compact && s\.boxEn/.test(ui));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ the English Filter mirrors the Arabic, reads left-to-right, and finds places typed in English');
