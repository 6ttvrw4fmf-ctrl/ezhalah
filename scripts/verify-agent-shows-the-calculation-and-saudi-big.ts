// THE SUMMARY SHOWS WHAT WE DID WITH THE USER'S WORDS — the currency calculation, and «big» on the Saudi scale
// (owner 2026-10-11).
//
// Owner, looking at «ابي بيت في الرياض مع غرفة للخادمة … الحد الأقصى خمس مليون دينار» → «الميزانية: ر.س 61,000,000»:
// «include the calculation … what the user wrote translated, like price per meter multiplied by this». And:
// «when someone says big, think Saudi — what is big in Riyadh — not America».
//
// Found while reproducing it live: (1) a budget WRITTEN IN WORDS («خمس مليون دينار») never produced `priceOriginal`
// (both scans needed a digit), so the summary had no «ميزانيتك» line at all; (2) the model's own reply converted the
// same dinar at the Bahraini rate (49,750,000) while the search used the Kuwaiti one (61,000,000) — two numbers for one
// budget; (3) «بيت كبير» searched with NO size at all while the reply said «big».
//
// This EXECUTES the real code: the Saudi «big» reader and thresholds, the calculation line, the lifted summary, and the
// edge's originalCurrency — then pins the wiring, with a mutation for each.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bigWanted, bigAreaMin } from '../src/data/bigSize.ts';
import { detailFor } from '../src/data/taxonomy.ts';
import { currencyCalcLine, parseOriginalBudget, CURRENCY_RATE_BY_CODE } from '../src/lib/currencyCalc.ts';
import { liftSymbols } from './lib/liftSymbols.ts';
import { windowBetween } from './lib/sourceWindow.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nThe summary shows the calculation, and «big» is Saudi big\n');

// ── 1. «big» is read from the user's words, next to a property noun ─────────────────────────────────────────
const YES = ['ابي بيت كبير في الرياض', 'شقة كبيرة للإيجار', 'ابغى ارض كبيرة', 'فيلا واسعة بالدمام', 'استراحة كبيرة', 'مستودع كبير', 'بيت كبير جدا',
  'ابي بيت مساحته كبيرة', 'ابغى أرض شاسعة', 'فيلا ضخمة', 'big villa in Riyadh', 'large apartment for rent', 'a spacious house', 'huge plot in Jeddah'];
const NO = ['ابي بيت مع حوش كبير', 'شقة فيها مطبخ كبير', 'غرفة كبيرة', 'ما ابي بيت كبير', 'villa with a big garden', "I don't want a big house",
  'شقة غرفتين', 'ابي بيت', 'حي الكبير', 'شقة صغيرة'];
check('«كبير / واسع / ضخم / big / large» next to a property noun counts as big', YES.every(bigWanted), YES.filter((t) => !bigWanted(t)).join(' | '));
check('a big YARD / KITCHEN / ROOM, a refusal, or no big word never counts', NO.every((t) => !bigWanted(t)), NO.filter(bigWanted).join(' | '));

// ── 2. the thresholds are Saudi, and come from the product's own ladders where we have no measurement ─────
const T: Array<[string, number | null]> = [['Villa', 500], ['House', 500], ['Apartment', 200], ['Floor', 300], ['Residential Land', 900], ['Rest House', 2000],
  ['Farm', 50000], ['Chalet', null], ['Room', null], ['Studio', null]];
check('villa/house 500 · apartment 200 · floor 300 · land 900 · rest house 2,000 · farm 50,000 m²; chalet/room/studio have none',
  T.every(([t, n]) => bigAreaMin(t) === n), T.filter(([t, n]) => bigAreaMin(t) !== n).map(([t]) => `${t}=${bigAreaMin(t)}`).join(', '));
const ladderTop = (t: string) => parseInt(/^([\d,]+)\+/.exec(detailFor(t).options.at(-1)!)![1].replace(/,/g, ''), 10);
check('a commercial type uses the top tab of its own size ladder (warehouse 5,000 · office 600 · shop 250 · showroom 700)',
  ['Warehouse', 'Office', 'Shop', 'Showroom'].every((t) => bigAreaMin(t) === ladderTop(t)) && bigAreaMin('Warehouse') === 5000 && bigAreaMin('Office') === 600);
check('«big» is NEVER a bedroom count: the villa threshold is an area, far above any plausible number of rooms', (bigAreaMin('Villa') ?? 0) >= 300);

// ── 3. wiring: only from the user's own words, never over an explicit size, never for a type with no threshold ─
const agentSrc = read('src/data/agent.ts');
const wire = windowBetween(agentSrc, '// «كبير» / "big" (owner 2026-10-11)', "q.priceInput = String(b.price", 'agent.ts');
const wired = (src: string) => /q\.areaMin == null && q\.areaMax == null && _areaTexts\.some\(bigWanted\)/.test(src)
  && /const bigMin = bigAreaMin\(q\.type\) \?\? \(!q\.type && q\.typeGroups\?\.length === 1 && q\.typeGroups\[0\] === LAND_GROUP \? bigAreaMin\('Residential Land'\) : null\);/.test(src) && /if \(bigMin\) \{ q\.areaMin = String\(bigMin\); q\.areaNote = 'big'; \}/.test(src);
check('queryFromBackend sets areaMin from the Saudi threshold only when no explicit size was given', wired(wire));
mustCatch('the explicit-size guard being dropped (it would overwrite «فوق ٧٠٠ متر»)', !wired(wire.replace('q.areaMin == null && q.areaMax == null && ', '')));
mustCatch('a bare «أرض كبيرة» getting no threshold (the land group must read as residential land)', !wired(wire.replace("q.typeGroups[0] === LAND_GROUP ? bigAreaMin('Residential Land') : null)", 'false ? 0 : null)')));
mustCatch('the threshold being applied when the type has none', !wired(wire.replace('if (bigMin) {', 'if (true) {')));
mustCatch('the word being read from anything but the user text', !wired(wire.replace('_areaTexts.some(bigWanted)', 'true')));

const orderWire = windowBetween(agentSrc, 'const ordering = vagueOrdering(userText);', 'return q;', 'agent.ts');
const keepsDiversity = (src: string) => /!\(ordering === 'area_desc' && q\.areaNote === 'big'\)/.test(src) && /if \(ordering && !q\.sort/.test(src);
check('a «big» that became a Saudi threshold is NOT also sorted largest-first (no outlier at #1, match-first + diversify stay in charge)', keepsDiversity(orderWire));
mustCatch('the largest-first sort coming back on top of the threshold', !keepsDiversity(orderWire.replace("&& !(ordering === 'area_desc' && q.areaNote === 'big')", '')));
check('«big» for a type with NO threshold (chalet) still only orders largest-first', bigAreaMin('Chalet') === null);

// ── 4. the calculation line ──────────────────────────────────────────────────────────────────────────────────
check('«KWD 5,000,000» → «5,000,000 دينار كويتي × 12.2 = ر.س 61,000,000»',
  currencyCalcLine('KWD 5,000,000', 61_000_000, 'ar', 'ر.س') === '5,000,000 دينار كويتي × 12.2 = ر.س 61,000,000');
check('English: «KWD 5,000,000 × 12.2 = SAR 61,000,000»', currencyCalcLine('KWD 5,000,000', 61_000_000, 'en', 'SAR') === 'KWD 5,000,000 × 12.2 = SAR 61,000,000');
check('a total the arithmetic does not produce (rent ×12, a range) is never printed after «=»',
  currencyCalcLine('USD 2,000', 90_000, 'ar', 'ر.س') === '2,000 دولار × 3.75');
check('an unknown currency code is not converted', currencyCalcLine('XYZ 5,000', 100, 'ar', 'ر.س') === null && parseOriginalBudget('SAR 100') === null);
const ccSrc = read('src/lib/currencyCalc.ts');
const guarded = (src: string) => /Math\.abs\(totalSar - product\) <= product \* 0\.01/.test(src);
check('the «=» total is only printed when it equals amount × rate (within 1%)', guarded(ccSrc));
mustCatch('«=» printed without checking the maths', !guarded(ccSrc.replace('Math.abs(totalSar - product) <= product * 0.01', 'true')));

// the summary really uses it (lifted budgetLines + searchSummary, executed)
const summaries = await liftSymbols(join(ROOT, 'src/data/search.ts'), [
  { header: 'function summaryLanguage(' }, { header: 'function fixedSize(' }, { header: 'function budgetLines(' }, { header: 'function locationLines(' }, { header: 'export function searchSummary(' },
], ['searchSummary'], `
import { currencyCalcLine } from ${JSON.stringify(join(ROOT, 'src/lib/currencyCalc.ts'))};
import { bigAreaMin } from ${JSON.stringify(join(ROOT, 'src/data/bigSize.ts'))};
import { detailFor } from ${JSON.stringify(join(ROOT, 'src/data/taxonomy.ts'))};
import { AMENITY_LABEL } from ${JSON.stringify(join(ROOT, 'src/lib/afEvidence.ts'))};
type Locale = 'ar' | 'en'; type SearchQuery = any;
const getLocale = () => 'ar'; const translate = (loc: string, key: string, v?: any) => v ? key.replace(/\\{(\\w+)\\}/g, (_: string, n: string) => String(v[n])) : key;
const tWord = (k: string) => k; const tPlace = (k: string) => k; const tPriceTab = (k: string) => k; const tDetailOption = (k: string) => k;
const arabicOrPlaceholder = (key: string) => key; const LOCATION_UNRESOLVED_AR = ''; const TYPE_UNRESOLVED_AR = '';
const effectiveTypes = (q: any) => q.types ?? []; const effectiveGroups = () => []; const effectiveBeds = () => [];
const numOrNull = (n: any) => n == null || n === '' ? null : Number(n); const grouped = (n: number) => Math.round(n).toLocaleString('en-US');
  const combinedBudgetParts = () => []; const withAdvancedLines = (s: string) => s;
const cityDisplay = (c: string, l: string) => l === 'ar' ? ({ Riyadh: 'الرياض' } as any)[c] ?? c : c; const translitPlace = (s: string) => s;
const t = (k: string, v?: any) => v ? k.replace(/\\{(\\w+)\\}/g, (_: string, n: string) => String(v[n])) : k;
`);
const summary = summaries.searchSummary as (q: any, l: string) => string;
const base = { location: 'الرياض', deal: 'Buy', type: 'House', priceInput: '61000000', priceOriginal: 'KWD 5,000,000' };
const s1 = summary(base, 'ar');
check('the summary shows «ميزانيتك: 5,000,000 دينار كويتي × 12.2 = SAR 61,000,000» (the user\'s figure, the rate, the result)',
  s1.includes('Your budget: 5,000,000 دينار كويتي × 12.2 = SAR 61,000,000'), s1);
check('…and still shows the Budget line the search uses', /Budget: SAR 61,000,000/.test(s1), s1);
check('English summary shows «KWD 5,000,000 × 12.2 = SAR 61,000,000»', summary(base, 'en').includes('Your budget: KWD 5,000,000 × 12.2 = SAR 61,000,000'));
const withMaid = summary({ ...base, amenities: ['maid_room', 'elevator'] }, 'ar');
check('the summary names the features the search requires: «Amenities: Maid room، Elevator»', withMaid.includes('Amenities: Maid room، Elevator'), withMaid);
check('…and names nothing when there are none or when a token is unknown', !summary(base, 'ar').includes('Amenities') && !summary({ ...base, amenities: ['bogus'] }, 'ar').includes('Amenities'));
const cityQ = { location: 'الرياض', deal: 'Rent', type: 'Apartment', priceInput: '', locationMatch: { kind: 'city', label: 'الرياض', raw: 'الرياض', city: 'Riyadh', region: 'Riyadh', districts: [], cities: [], ambiguous: false } };
check('the ENGLISH summary says «City: Riyadh», not the Arabic label the agent typed; the Arabic summary keeps «الرياض»',
  summary(cityQ, 'en').includes('City: Riyadh') && !/City: [؀-ۿ]/.test(summary(cityQ, 'en')) && summary(cityQ, 'ar').includes('City: الرياض'), summary(cityQ, 'en'));
const monthly = { location: 'الخبر', deal: 'Rent', type: 'Apartment', priceInput: '60000', priceIsAnnual: true, rentPeriod: 'monthly' };
const sm = summary(monthly, 'ar');
check('a MONTHLY rent the agent multiplied by 12 shows both: «Monthly Rent: SAR 5,000/month» and «Annual Equivalent: SAR 60,000/year»',
  sm.includes('Monthly Rent: {a}/month'.replace('{a}', 'SAR 5,000')) && sm.includes('Annual Equivalent: {a}/year'.replace('{a}', 'SAR 60,000')), sm);
const usdMonthly = { ...monthly, priceInput: '90000', priceOriginal: 'USD 2,000' };
check('…with a currency it reads «2,000 دولار × 3.75 = SAR 7,500» then the monthly and the yearly figure',
  summary(usdMonthly, 'ar').includes('Your budget: 2,000 دولار × 3.75 = SAR 7,500') && summary(usdMonthly, 'ar').includes('SAR 90,000/year'), summary(usdMonthly, 'ar'));
check('a yearly rent the user typed (not annualized by us) is untouched', !summary({ ...monthly, rentPeriod: 'annual' }, 'ar').includes('Monthly Rent'));
const ppm = (type: string, detail: string) => summary({ location: 'الرياض', deal: 'Buy', type, priceInput: '3500', detail }, 'ar');
check('price per m² × a typed size shows the total for a VILLA too: «3,500 × 300 → Calculated Total: SAR 1,050,000»',
  ppm('Villa', '300').includes('Calculated Total: SAR 1,050,000') && ppm('Residential Land', '300').includes('Calculated Total: SAR 1,050,000'), ppm('Villa', '300'));
check('…but a bedroom count is never multiplied («3,500/m² × 3 bedrooms» must not become a total)', !ppm('Villa', '3').includes('Calculated Total'));
const big = { location: 'الرياض', deal: 'Buy', type: 'House', priceInput: '', areaMin: '500', areaNote: 'big' };
check('«big» shows what it became: «Size: From 500 m² (big by Saudi market standards)»', summary(big, 'ar').includes('Size: From 500 m² (big by Saudi market standards)'), summary(big, 'ar'));
check('an explicit size the user typed never carries the «big» label', !summary({ ...big, areaNote: null }, 'ar').includes('big by Saudi'));
check('a stale «big» note (the type changed, so 500 is no longer its threshold) is not shown', !summary({ ...big, type: 'Apartment' }, 'ar').includes('big by Saudi'));
check('a size RANGE never carries the «big» label', !summary({ ...big, areaMax: '900' }, 'ar').includes('big by Saudi'));

// ── 5. the edge reads a budget written in WORDS, and the rates are one table ────────────────────────────────
const edge = read('supabase/functions/agent/index.ts');
const lifted = await liftSymbols(join(ROOT, 'supabase/functions/agent/index.ts'), [
  { header: 'const CUR_LABEL: Record<string, string> = {', endsWith: /^\};$/ },
  { header: 'const AR_CUR_LABEL: Array<[RegExp, string]> = [', endsWith: /^\];$/ },
  { header: 'function originalCurrency(', endsWith: /^\}$/ },
], ['originalCurrency'], `import { arabicWordAmounts, toWesternDigits } from ${JSON.stringify(join(ROOT, 'supabase/functions/agent/postModel.ts'))};`);
const oc = lifted.originalCurrency as (s: string) => string;
const O: Array<[string, string]> = [
  ['ابي بيت في الرياض مع غرفة للخادمة الحد الأقصى لي هو خمس مليون دينار', 'KWD 5,000,000'],
  ['ميزانيتي مليون ونص دولار', 'USD 1,500,000'],
  ['ابي فيلا بـ 5 مليون دينار', 'KWD 5,000,000'],
  ['villa up to 100k usd', 'USD 100,000'],
  ['ابغى شقة ٢٠٠٠ دولار شهري في الرياض', 'USD 2,000'],
  ['بيت بـ ٥ مليون دينار', 'KWD 5,000,000'],
  ['فيلا في جدة بمليونين ريال', ''],
  ['شقة ٣ غرف في الرياض', ''],
];
check('«خمس مليون دينار» → KWD 5,000,000 · «مليون ونص دولار» → USD 1,500,000 · digits and Latin still work · riyals/none → nothing',
  O.every(([i, o]) => oc(i) === o), O.filter(([i, o]) => oc(i) !== o).map(([i]) => `${i} → ${oc(i)}`).join(' | '));
const ocWindow = windowBetween(edge, 'function originalCurrency(', '\n}\n', 'index.ts');
mustCatch('the word-amount scan being removed', !/for \(const wa of arabicWordAmounts\(input\)\)/.test(ocWindow.replace(/for \(const wa of arabicWordAmounts\(input\)\)/, 'for (const wa of [])')));
// the three rate tables are one
const edgeRate = (code: string) => Number(new RegExp(`\\b${code.toLowerCase()}: ([\\d.]+)`).exec(windowBetween(edge, 'const CURRENCY_RATES', '};', 'index.ts'))?.[1]);
const jodRate = Number(/\[\/دينار\\s\*أردني\|دينار\\s\*اردني\/, ([\d.]+)\]/.exec(edge)?.[1]);
const bad = Object.entries(CURRENCY_RATE_BY_CODE).filter(([c, r]) => (c === 'JOD' ? jodRate : edgeRate(c)) !== r).map(([c, r]) => `${c} ${r}≠${c === 'JOD' ? jodRate : edgeRate(c)}`);
check('the summary\'s rates equal the rates the search converts with (edge CURRENCY_RATES / AR_CURRENCY)', bad.length === 0, bad.join(', '));
const sizeNote = windowBetween(edge, 'const isSizeDetail =', 'insertBeforeTrailingEmoji(replyOut', 'index.ts');
const digitsAware = (src: string) => /!toWesternDigits\(replyOut\)\.replace\(\/,\/g, ""\)\.includes\(detailStr\)/.test(src);
check('the size note is not repeated when the reply already says the size in Arabic digits («١٠٠٠ متر»)', digitsAware(sizeNote));
mustCatch('the size note comparing raw text (it repeats «(1000 م²)» after «١٠٠٠ متر»)', !digitsAware(sizeNote.replace('toWesternDigits(replyOut).replace(/,/g, "")', 'replyOut')));
const hint = windowBetween(edge, 'const JSON_SHAPE_HINT = `', '`;', 'index.ts');
const noMoney = (src: string) => /Never write a price, a budget or a currency conversion in the reply/.test(src);
check('the reply format forbids a price, a budget or a conversion in the reply (the model once converted at another rate)', noMoney(hint));
mustCatch('that rule being deleted', !noMoney(hint.replace('Never write a price, a budget or a currency conversion in the reply', '')));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ the summary shows the calculation, and «big» is Saudi big');
