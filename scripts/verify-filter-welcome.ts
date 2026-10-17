// verify-filter-welcome — the Filter home's rotating welcome may only ever say TRUE things.
//
// Owner 2026-10-17: «those number count should be true … gets updated». So this check EXECUTES
// src/lib/filterWelcome.ts (pure) and proves, with mutation proofs for each guard:
//   1. no line has a number typed into it — every number is a live placeholder;
//   2. «أكثر من» / "more than" always precedes a number STRICTLY below the real count;
//   3. a line whose fact is missing / not true today renders nothing (the normal subtitle stays);
//   4. «كل مناطق المملكة» is said only when all 13 regions have listings;
//   5. English never carries Arabic script (city/district names come from the official English names);
//   6. the owner's shape: 30 lines, Arabic without diacritics, every line ends with the brand,
//      and the English keeps "Ezhalah" untranslated;
//   7. rotation: one line held for 4 hours then a different one, always personal, time lines only at their time.
import {
  WELCOME_LINES, moreThan, renderWelcome, chooseWelcomeLine, lineFitsTime, welcomeForNow, fallbackLine, HOLD_MS, FACTLESS_ANYTIME_IDS,
  MY_DISTRICT_SHARE, MY_DISTRICT_TOP, type WelcomeFacts,
} from '../src/lib/filterWelcome.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failed++;
};
const mustCatch = (label: string, caught: boolean) => {
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`);
  if (!caught) failed++;
};

// Real production values on 2026-10-17, so the rendered examples read like the live site.
const FACTS: WelcomeFacts = {
  sites: 149, listings: 372_889, cities: 341, districts: 3_752, regions: 13,
  regionCounts: { 'منطقة الرياض': 170_363, 'منطقة مكة المكرمة': 104_681, 'المنطقة الشرقية': 48_662, 'منطقة القصيم': 16_235 },
  city: { ar: 'الرياض', en: 'Riyadh', count: 162_312 },
  topDistrict: { ar: 'حي المهدية', en: 'Al Mahdiyah', count: 11_994 },
  topDistricts: [
    { ar: 'حي المهدية', en: 'Al Mahdiyah', count: 11_994 },
    { ar: 'حي النرجس', en: 'An Narjis', count: 11_385 },
    { ar: 'حي الرمال', en: 'Ar Rimal', count: 10_000 },
  ],
  cityRank: 1,
  topCities: [{ ar: 'الرياض', en: 'Riyadh', count: 162_312 }, { ar: 'جدة', en: 'Jeddah', count: 88_241 }],
  myDistrict: { ar: 'حي النرجس', en: 'An Narjis', count: 11_385, rank: 2 },
};

// ── 6. shape ───────────────────────────────────────────────────────────────────────────────────
const ids = WELCOME_LINES.map((l) => l.id);
check('exactly the 45 approved lines (30 + 10 insight + 5 own-district), ids 1..45', ids.length === 45 && ids.every((id, i) => id === i + 1));
check('every Arabic line ends with «إزهله»', WELCOME_LINES.every((l) => /إزهله[.؟!]?$/.test(l.ar)));
check('every English line ends with "Ezhalah" (the brand is never translated)', WELCOME_LINES.every((l) => /Ezhalah[.?!]?$/.test(l.en)));
check('Arabic lines carry no diacritics (owner: «remove alharakat»)', WELCOME_LINES.every((l) => !/[ً-ْ]/.test(l.ar)));
check('every line greets the user by name', WELCOME_LINES.every((l) => l.ar.includes('{n}') && l.en.includes('{n}')));

// ── 1. no typed numbers ──────────────────────────────────────────────────────────────────────────
const typedNumber = (s: string) => /[0-9٠-٩]/.test(s.replace(/\{\w+\}/g, ''));
const noTypedNumbers = (lines: typeof WELCOME_LINES) => lines.every((l) => !typedNumber(l.ar) && !typedNumber(l.en));
check('no line has a number typed into it — every number is a live placeholder', noTypedNumbers(WELCOME_LINES));
mustCatch('a hard-coded "149" in a line', !noTypedNumbers([{ ...WELCOME_LINES[0], ar: 'صباح الخير {n}، 149 موقع في إزهله.' }]));

// ── 2. "more than" is honest ─────────────────────────────────────────────────────────────────────
const asNumber = (s: string) => (s.endsWith(' ألف') ? Number(s.replace(/[^\d]/g, '')) * 1000 : Number(s.replace(/,/g, '')));
const honest = (fn: typeof moreThan) => {
  for (const n of [1001, 1_500, 3_752, 9_999, 10_000, 16_235, 48_662, 100_000, 104_681, 162_312, 170_363, 370_000, 372_889, 1_000_000]) {
    for (const loc of ['ar', 'en'] as const) {
      const s = fn(n, loc);
      if (s === null) return false;
      if (!(asNumber(s) < n)) return false;
    }
  }
  return fn(999, 'ar') === null && fn(undefined, 'ar') === null && fn(Number.NaN, 'en') === null;
};
check('«أكثر من» is always strictly below the real count, and absent below 1,000', honest(moreThan));
check('today\'s numbers read as approved: 370 ألف · 3,700 · 170 ألف · 100 ألف · 48 ألف · 16 ألف',
  moreThan(372_889, 'ar') === '370 ألف' && moreThan(3_752, 'ar') === '3,700' && moreThan(170_363, 'ar') === '170 ألف'
  && moreThan(104_681, 'ar') === '100 ألف' && moreThan(48_662, 'ar') === '48 ألف' && moreThan(16_235, 'ar') === '16 ألف'
  && moreThan(372_889, 'en') === '370,000');
mustCatch('rounding UP ("more than 380 thousand" for 372,889)', !honest((n, l) => (typeof n === 'number' && n > 1000 ? (l === 'ar' ? `${Math.ceil(n / 10_000) * 10} ألف` : String(Math.ceil(n / 10_000) * 10_000)) : null)));
mustCatch('"more than X" where X equals the count (370,000 for exactly 370,000)', !honest((n) => (typeof n === 'number' && n > 1000 ? String(Math.floor(n / 1000) * 1000) : null)));

// ── 3. a missing fact hides the line ─────────────────────────────────────────────────────────────
const everyLineRenders = WELCOME_LINES.every((l) => {
  const ar = renderWelcome(l, 'يوسف', FACTS, 'ar'); const en = renderWelcome(l, 'Yusuf', FACTS, 'en');
  return !!ar && !!en && !/[{}]/.test(ar + en) && ar.includes('يوسف') && en.includes('Yusuf');
});
check('with every fact known, all 30 lines render in both languages with no leftover placeholder', everyLineRenders);
const hidesWhenMissing = (render: typeof renderWelcome) => WELCOME_LINES.filter((l) => l.needs.length).every((l) => {
  const empty: WelcomeFacts = {};
  return render(l, 'يوسف', empty, 'ar') === null && render(l, 'Yusuf', empty, 'en') === null;
});
check('every line that states a fact renders NOTHING when that fact is unknown', hidesWhenMissing(renderWelcome));
mustCatch('a renderer that prints a zero for an unknown count',
  !hidesWhenMissing((l, n, f, loc) => renderWelcome(l, n, { ...FACTS, ...f, sites: f.sites ?? 0, listings: f.listings ?? 0 } as WelcomeFacts, loc)));
check('no name → no personal line', WELCOME_LINES.every((l) => renderWelcome(l, '  ', FACTS, 'ar') === null));

// ── 4. "all 13 regions" only when true ───────────────────────────────────────────────────────────
const allRegionLines = WELCOME_LINES.filter((l) => l.needs.includes('allRegions'));
check('«كل مناطق المملكة» lines are hidden when only 12 regions have listings',
  allRegionLines.length > 0 && allRegionLines.every((l) => renderWelcome(l, 'يوسف', { ...FACTS, regions: 12 }, 'ar') === null));

// ── 5. no Arabic inside English ─────────────────────────────────────────────────────────────────
const arabicLeak = WELCOME_LINES.some((l) => {
  const en = renderWelcome(l, 'Yusuf', { ...FACTS, city: { ar: 'الرياض', en: 'الرياض', count: 162_312 }, topDistrict: { ar: 'حي المهدية', en: 'حي المهدية', count: 11_994 } }, 'en');
  return en !== null && /[؀-ۿ]/.test(en);
});
check('an English line is never shown with an Arabic city/district name in it', !arabicLeak);

// ── 8. insight lines (owner 2026-10-17) ───────────────────────────────────────────────────────
const line = (id: number) => WELCOME_LINES.find((l) => l.id === id)!;
const share = (f: WelcomeFacts) => renderWelcome(line(36), 'يوسف', f, 'ar');
const sharePct = (s: string | null) => Number(/(\d+)%/.exec(s ?? '')?.[1] ?? NaN);
const regionTotal = Object.values(FACTS.regionCounts!).reduce((a, b) => a + b, 0);
check('the Riyadh share is strictly below its true percentage of the same pool',
  sharePct(share(FACTS)) < (100 * 170_363) / regionTotal && sharePct(share(FACTS)) >= Math.floor((100 * 170_363) / regionTotal) - 1);
check('an exact share (50.0%) still reads "more than 49%", never "more than 50%"',
  sharePct(share({ ...FACTS, regionCounts: { 'منطقة الرياض': 50, 'منطقة مكة المكرمة': 50 } })) === 49);
check('the top-three line needs three real districts (two known → hidden)',
  renderWelcome(line(33), 'يوسف', { ...FACTS, topDistricts: FACTS.topDistricts!.slice(0, 2) }, 'ar') === null);
check('the rank line needs a live rank', renderWelcome(line(35), 'يوسف', { ...FACTS, cityRank: undefined }, 'ar') === null);
check('the two-cities line needs two live cities', renderWelcome(line(40), 'يوسف', { ...FACTS, topCities: FACTS.topCities!.slice(0, 1) }, 'ar') === null);
check('insight lines never say people are searching there, and never «نار»',
  WELCOME_LINES.filter((l) => l.id > 30).every((l) => !/الكل يدور|نار/.test(l.ar)));
console.log('  e.g. ' + renderWelcome(line(33), 'يوسف', FACTS, 'ar'));
console.log('  e.g. ' + renderWelcome(line(36), 'يوسف', FACTS, 'ar'));
console.log('  e.g. ' + renderWelcome(line(32), 'Yusuf', FACTS, 'en'));

// ── 9. the user's own district (owner 2026-10-17) ───────────────────────────────────────────────
const mine = WELCOME_LINES.filter((l) => l.needs.includes('myDistrict') || l.needs.includes('myTop10'));
check('five own-district lines exist', mine.length === 5);
check('«من أنشط أحياء» is hidden when the district ranks outside the top 10',
  renderWelcome(line(45), 'يوسف', { ...FACTS, myDistrict: { ...FACTS.myDistrict!, rank: MY_DISTRICT_TOP + 1 } }, 'ar') === null
  && renderWelcome(line(45), 'يوسف', FACTS, 'ar') !== null);
check('no own-district line promises to watch or alert (Ezhalah has no such feature)',
  mine.every((l) => !/يتابع|ينبه|تنبيه|watch|alert|notify/i.test(l.ar + l.en)));
check('own-district lines never render without a matched district', mine.every((l) => renderWelcome(l, 'يوسف', { ...FACTS, myDistrict: undefined }, 'ar') === null));
const neverMineWithout = (pick: typeof chooseWelcomeLine) => {
  for (let i = 0; i < 200; i++) {
    const r = [i / 200, (i * 7 % 200) / 200];
    const l = pick(new Date('2026-10-14T13:00:00'), null, () => r.shift() ?? 0, false);
    if (l && mine.includes(l)) return false;
  }
  return true;
};
check('a user without a searched district never gets an own-district line', neverMineWithout(chooseWelcomeLine));
mustCatch('a picker that offers own-district lines to everyone', !neverMineWithout((now, last, rand = Math.random) => {
  const pool = WELCOME_LINES.filter((l) => l.id !== last && lineFitsTime(l, now));
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}));
let mineHits = 0;
for (let i = 0; i < 300; i++) {
  const r = [i / 300, 0.5];
  const l = chooseWelcomeLine(new Date('2026-10-14T13:00:00'), null, () => r.shift() ?? 0, true);
  if (l && mine.includes(l)) mineHits++;
}
check(`with a searched district, about 1 in 3 periods is one of THEIR lines (got ${mineHits}/300)`,
  MY_DISTRICT_SHARE === 1 / 3 && Math.abs(mineHits / 300 - MY_DISTRICT_SHARE) < 0.02);
console.log('  e.g. ' + renderWelcome(line(41), 'يوسف', FACTS, 'ar'));
console.log('  e.g. ' + renderWelcome(line(42), 'يوسف', FACTS, 'ar'));
console.log('  e.g. ' + renderWelcome(line(43), 'Yusuf', FACTS, 'en'));

// ── 7. rotation ─────────────────────────────────────────────────────────────────────────────────
const at = (iso: string) => new Date(iso);
const neverRepeats = (pick: typeof chooseWelcomeLine) => {
  for (const last of WELCOME_LINES.map((l) => l.id)) {
    for (let i = 0; i < 97; i++) {
      if (pick(at('2026-10-16T09:00:00'), last, () => i / 97)?.id === last) return false;
    }
  }
  return true;
};
// HOLD (owner: «not every refresh … every now and then, hours» → 4 h, always personal).
const holdsFourHours = (decide: typeof welcomeForNow) => {
  const t0 = at('2026-10-14T13:00:00').getTime(); // Wednesday 13:00 — only any-time lines fit
  const held = { id: 20, at: t0 };
  const kept1h = decide(new Date(t0 + 1 * 3600_000), held, () => 0.3);
  const kept3h = decide(new Date(t0 + 3.9 * 3600_000), held, () => 0.7);
  const after = decide(new Date(t0 + 4 * 3600_000 + 1), held, () => 0.3);
  return kept1h?.line.id === 20 && kept1h.keep && kept3h?.line.id === 20
    && !!after && !after.keep && after.line.id !== 20;
};
check('one line is held for 4 hours, then a different line takes over', holdsFourHours(welcomeForNow));
check('HOLD_MS is 4 hours', HOLD_MS === 4 * 3600_000);
mustCatch('a picker that changes on every refresh', !holdsFourHours((now, held, rand) => {
  const line = chooseWelcomeLine(now, held?.id ?? null, rand); return line ? { line, keep: false } : null;
}));
mustCatch('a picker that holds a line forever', !holdsFourHours((_now, held) => {
  const line = WELCOME_LINES.find((l) => l.id === held?.id)!; return { line, keep: true };
}));
const morningHeld = { id: 1, at: at('2026-10-14T11:00:00').getTime() };
const afternoon = welcomeForNow(at('2026-10-14T13:00:00'), morningHeld, () => 0.5);
check('a held MORNING line does not survive into the afternoon, even within 4 hours', !!afternoon && afternoon.line.id !== 1 && !afternoon.keep);
let alwaysALine = true;
for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
  const now = new Date(2026, 9, 11 + d, h, 30);
  if (!welcomeForNow(now, null, () => 0.99) || !welcomeForNow(now, { id: 30, at: now.getTime() - 5 * 3600_000 }, () => 0.99)) alwaysALine = false;
}
check('a signed-in user always gets a personal line, every hour of every day', alwaysALine);
check('the fallback line (fact unknown) states no fact, fits any hour, and is never the previous line',
  FACTLESS_ANYTIME_IDS.length >= 2 && [null, ...FACTLESS_ANYTIME_IDS].every((avoid) => {
    for (let i = 0; i < 20; i++) { const l = fallbackLine(avoid, () => i / 20); if (l.needs.length || l.when !== 'any' || l.id === avoid) return false; }
    return true;
  }));
check('the previous line is never shown twice in a row', neverRepeats(chooseWelcomeLine));
const wed = at('2026-10-14T14:00:00'); // Wednesday afternoon
check('on a Wednesday afternoon no morning/evening/Friday/weekend line is eligible',
  WELCOME_LINES.filter((l) => lineFitsTime(l, wed)).every((l) => l.when === 'any'));
const friMorning = at('2026-10-16T08:00:00'); // Friday 08:00
check('Friday morning allows morning, Friday and weekend lines',
  ['morning', 'friday', 'weekend'].every((w) => WELCOME_LINES.some((l) => l.when === w && lineFitsTime(l, friMorning))));
mustCatch('a picker that ignores the previous line', !neverRepeats((now, _last, rand = Math.random) => {
  const pool = WELCOME_LINES.filter((l) => lineFitsTime(l, now));
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}));

console.log(`\nExample (ar): ${renderWelcome(WELCOME_LINES[3], 'يوسف', FACTS, 'ar')}`);
console.log(`Example (en): ${renderWelcome(WELCOME_LINES[23], 'Yusuf', FACTS, 'en')}`);
if (failed) { console.error(`\n❌ verify-filter-welcome: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-filter-welcome: every welcome line is live, honest, branded and rotates as approved.');
