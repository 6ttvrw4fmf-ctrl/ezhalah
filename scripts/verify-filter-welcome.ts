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
//   7. rotation: one line held for 1 hour then a different one, always personal, time lines only at their time.
import {
  WELCOME_LINES, moreThan, renderWelcome, chooseWelcomeLine, lineFitsTime, welcomeForNow, fallbackLine, HOLD_MS, PREPARED_MAX_MS, FACTLESS_ANYTIME_IDS,
  MY_DISTRICT_SHARE, MY_DISTRICT_TOP, headlineReduce, HEADLINE_UNSETTLED, SETTLE_CAP_MS, instantWelcome, GREET_LINES, GREET_HOLD_MS, greetIndex, greetingFor, fillName, NAME_SLOT, NEW_TODAY_MIN, riyadhDay, tabLine, TAB_KEY, type WelcomeFacts,
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
  sites: 149, newToday: 4_739, listings: 372_889, cities: 341, districts: 3_752, regions: 13,
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
check('exactly the 46 approved lines (30 + 10 insight + 5 own-district + 1 new-today), ids 1..46', ids.length === 46 && ids.every((id, i) => id === i + 1));
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

// ── 10. the headline never changes once shown (owner 2026-10-17: «never ever») ────────────────────
const L19 = WELCOME_LINES.find((l) => l.id === 19)!;
const factsEv = { type: 'facts' as const, line: L19, facts: FACTS };
const neverSwaps = (reduce: typeof headlineReduce) => {
  const afterGuest = reduce(HEADLINE_UNSETTLED, { type: 'guest' });
  const afterTimeout = reduce(HEADLINE_UNSETTLED, { type: 'timeout' });
  const afterFacts = reduce(HEADLINE_UNSETTLED, factsEv);
  return afterGuest.settled && afterGuest.line === null
    && afterTimeout.settled && afterTimeout.line === null
    && afterFacts.settled && afterFacts.line === L19
    // the rule: once settled, NOTHING changes the headline — not late facts, not a second event
    && reduce(afterTimeout, factsEv).line === null
    && reduce(afterGuest, factsEv).line === null
    && reduce(afterFacts, { type: 'timeout' }).line === L19
    && reduce(afterFacts, { ...factsEv, line: WELCOME_LINES[0] }).line === L19;
};
check('guest / timeout settle on the normal headline, facts settle on the personal line, and nothing moves afterwards', neverSwaps(headlineReduce));
check('the cap is short enough that a slow network still gets a headline quickly (≤ 3 s)', SETTLE_CAP_MS > 0 && SETTLE_CAP_MS <= 3000);
mustCatch('a reducer that lets late facts replace an already-shown headline (the swap the owner saw)',
  !neverSwaps((s, ev) => (ev.type === 'facts' ? { settled: true, line: ev.line, facts: ev.facts } : s.settled ? s : { settled: true, line: null, facts: null })));
mustCatch('a reducer that never settles on timeout (the title would hold at opacity 0 forever)',
  !neverSwaps((s, ev) => (ev.type === 'timeout' ? s : headlineReduce(s, ev))));
const homeSrc = (await import('node:fs')).readFileSync(new URL('../src/app/index.tsx', import.meta.url), 'utf8');
check('the Filter home holds the title\'s entrance on welcomeSettled',
  /useFilterWelcome\(!!user, sentenceName\(user, locale\)/.test(homeSrc) && /if \(!welcomeSettled\) return;/.test(homeSrc)
  && !/RNAnimated\.parallel\(\[rise\(badgeAnim, 80\), rise\(titleAnim, 230\)/.test(homeSrc));

// ── 11. instant: the headline comes from device memory, no network in the way (owner 2026-10-17) ──
const nowWed = new Date('2026-10-14T13:00:00'); // Wednesday afternoon — only any-time lines fit
const freshCache = { id: 25, at: nowWed.getTime() - 60_000, ar: 'هلا يوسف، AR-CACHED. إزهله.', en: 'Hi Yusuf, EN-CACHED. Ezhalah.' };
const inst = instantWelcome({ hasSession: true, cache: freshCache, now: nowWed, name: 'يوسف' });
check('a fresh cached line is shown as-is, instantly, in both languages', !!inst && inst.fromCache && inst.ar === freshCache.ar && inst.en === freshCache.en && inst.id === 25);
check('no stored session → no personal line (guest keeps the normal headline)', instantWelcome({ hasSession: true && false, cache: freshCache, now: nowWed, name: 'يوسف' }) === null);
const stale = instantWelcome({ hasSession: true, cache: { ...freshCache, at: nowWed.getTime() - HOLD_MS - 1 }, now: nowWed, name: 'يوسف', rand: () => 0 });
check('a cache older than the 2-hour hold is NOT reused — an instant factless line stands in (never the previous id)',
  !!stale && !stale.fromCache && stale.id !== 25 && !WELCOME_LINES.find((l) => l.id === stale.id)!.needs.length && stale.ar.includes('يوسف') && /إزهله\.$/.test(stale.ar) && /Ezhalah\.$/.test(stale.en));
const morningCache = { ...freshCache, id: 6 }; // a morning line
const night = instantWelcome({ hasSession: true, cache: morningCache, now: new Date('2026-10-14T21:00:00'), name: 'يوسف', rand: () => 0 });
check('a cached MORNING line is not reused at night, even inside the hold', !!night && !night.fromCache && night.id !== 6);
check('no cache + a session → an instant line that needs no numbers', (() => { const r = instantWelcome({ hasSession: true, cache: null, now: nowWed, name: 'يوسف', rand: () => 0.5 }); return !!r && !r.fromCache && !WELCOME_LINES.find((l) => l.id === r.id)!.needs.length; })());
check('no name on the device → no personal line (never a line with a blank name)', instantWelcome({ hasSession: true, cache: null, now: nowWed, name: '  ' }) === null);
mustCatch('an instant path that reuses a cache past the hold',
  !!instantWelcome({ hasSession: true, cache: { ...freshCache, at: nowWed.getTime() - HOLD_MS - 1 }, now: nowWed, name: 'يوسف' })?.fromCache === false);
const hookSrc = (await import('node:fs')).readFileSync(new URL('../src/lib/useFilterWelcome.ts', import.meta.url), 'utf8');
// Three setShown calls: the mount decision, and the two sign-in exceptions (owner 2026-10-22) — the welcome
// itself when the sign-in completes on this screen, and the hand-over from that welcome to a market insight
// («show the welcome with 🥳, then change it to a market insight», visibly). Nothing else re-decides.
check('the hook decides once per page load and re-decides ONLY for a sign-in welcome and its hand-over',
  (hookSrc.match(/setShown\(/g) ?? []).length === 3
  && /if \(greet\) welcomeThenInsight\(\);/.test(hookSrc) && /nameEn: session\.nameEn \}\);\s*welcomeThenInsight\(\);/.test(hookSrc)
  && (hookSrc.match(/welcomeThenInsight\(\);/g) ?? []).length === 2
  && /const g = takeGreeting\(session, now\);\s*if \(!g\) return;/.test(hookSrc)
  && /instantWelcome\(\{ hasSession: session\.present, cache, next, now,/.test(hookSrc) && /\}, \[\]\);/.test(hookSrc));
check('the background writes for LATER visits (the shown line\'s numbers, the next line) and never touches the screen',
  /writeCache\(\{ id: choice\.line\.id, at: held\.at, \.\.\.r \}\)/.test(hookSrc) && /writeKey\(NEXT_KEY, \{ id: INSIGHT_ID_BASE \+ pick\.templateId, at: now\.getTime\(\), ar: pick\.ar, en: pick\.en \}\)/.test(hookSrc)
  && !/setShown\([^)]*\)\s*;\s*\}\)\.catch/.test(hookSrc));

// ── 11b. the line CHANGES for a visitor who comes back after the 2 hours (owner 2026-10-22: «I keep
// seeing the same one always»). Measured live before the fix: visits 2 h apart showed the same
// no-numbers line three times, because the prepared line was stamped when PREPARED and had expired
// before the visit. Executed: a simulated device across five visits 2 h 05 min apart.
{
  const t0 = new Date('2026-10-14T13:00:00').getTime(); // Wednesday afternoon: any-time lines only
  const step = HOLD_MS + 5 * 60_000;
  let cache: { id: number; at: number; ar: string; en: string } | null = null;
  let next: typeof cache = null;
  const seen: number[] = [];
  const factIds: number[] = [];
  let r = 0.11;
  for (let v = 0; v < 5; v++) {
    const now = new Date(t0 + v * step);
    const s = instantWelcome({ hasSession: true, cache, next, now, name: 'يوسف', rand: () => (r = (r * 7.3 + 0.17) % 1) })!;
    seen.push(s.id);
    if (!s.fromCache || s.promoted) { cache = { id: s.id, at: now.getTime(), ar: s.ar, en: s.en }; if (s.promoted) next = null; }
    // the background prepares the next line (a fact line, as the hook does) for the next visit
    const n = chooseWelcomeLine(now, cache!.id, () => (r = (r * 7.3 + 0.17) % 1));
    if (n) { next = { id: n.id, at: now.getTime(), ar: `AR-${n.id}`, en: `EN-${n.id}` }; factIds.push(n.id); }
  }
  check('a visitor coming back every 2 h 05 min sees a DIFFERENT line on every visit',
    seen.every((id, i) => i === 0 || id !== seen[i - 1]), `seen ${seen.join(',')}`);
  check('from the second visit on, each visit shows the line prepared for it (with its live numbers), not a no-numbers stand-in',
    seen.slice(1).every((id, i) => id === factIds[i]), `seen ${seen.join(',')} prepared ${factIds.join(',')}`);
  const reload = instantWelcome({ hasSession: true, cache, next, now: new Date(t0 + 4 * step + 30 * 60_000), name: 'يوسف' })!;
  check('a reload INSIDE the hour keeps the same line (never changes on every refresh)', reload.id === seen[4] && !reload.promoted);
  const old = { id: 20, at: t0 - PREPARED_MAX_MS - 1, ar: 'x', en: 'y' };
  check('a prepared line older than a day is not shown (its numbers may be stale)',
    !instantWelcome({ hasSession: true, cache: null, next: old, now: new Date(t0), name: 'يوسف', rand: () => 0 })!.promoted);
  // mutation: stamp the prepared line's hold from when it was PREPARED (the old code) → expired on arrival
  const stamped = instantWelcome({ hasSession: true, cache: { id: 20, at: t0, ar: 'AR', en: 'EN' }, next: null, now: new Date(t0 + step), name: 'يوسف', rand: () => 0 })!;
  mustCatch('a prepared line written over the shown one and stamped when prepared', stamped.fromCache === false);
}

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
const holdsTwoHours = (decide: typeof welcomeForNow) => {
  const t0 = at('2026-10-14T13:00:00').getTime(); // Wednesday 13:00 — only any-time lines fit
  const held = { id: 20, at: t0 };
  const kept1h = decide(new Date(t0 + 1 * 3600_000), held, () => 0.3);
  const kept3h = decide(new Date(t0 + 1.95 * 3600_000), held, () => 0.7);
  const after = decide(new Date(t0 + 2 * 3600_000 + 1), held, () => 0.3);
  return kept1h?.line.id === 20 && kept1h.keep && kept3h?.line.id === 20
    && !!after && !after.keep && after.line.id !== 20;
};
check('one line is held for 2 hours (owner 2026-10-28), then a different line takes over', holdsTwoHours(welcomeForNow));
check('HOLD_MS is 2 hours (owner 2026-10-28: «a new message every 2 hours»)', HOLD_MS === 2 * 3600_000);
mustCatch('a picker that changes on every refresh', !holdsTwoHours((now, held, rand) => {
  const line = chooseWelcomeLine(now, held?.id ?? null, rand); return line ? { line, keep: false } : null;
}));
mustCatch('a picker that holds a line forever', !holdsTwoHours((_now, held) => {
  const line = WELCOME_LINES.find((l) => l.id === held?.id)!; return { line, keep: true };
}));
const morningHeld = { id: 1, at: at('2026-10-14T11:30:00').getTime() };
const afternoon = welcomeForNow(at('2026-10-14T12:10:00'), morningHeld, () => 0.5);
check('a held MORNING line does not survive into the afternoon, even within the hour', !!afternoon && afternoon.line.id !== 1 && !afternoon.keep);
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

// 8. THE NAME FOLLOWS THE LANGUAGE (owner 2026-10-17: «رجعت يا yusuf؟» on the Arabic headline).
// Executed: a slotted line + the user's names → Arabic spelling in Arabic, Latin in English, and never
// a Latin name inside an Arabic line. The hook must render and remember lines with the SLOT only.
{
  const slotted = renderWelcome(line(24), NAME_SLOT, FACTS, 'ar');
  const ar = fillName(slotted, 'يوسف', 'ar');
  check('Arabic line gets the Arabic spelling', !!ar && ar.includes('يوسف') && !/[A-Za-z]/.test(ar), String(ar));
  check('a Latin name is never put into an Arabic line', fillName(slotted, 'yusuf', 'ar') === null);
  check('English line gets the Latin name', fillName(renderWelcome(line(24), NAME_SLOT, { ...FACTS, city: { ar: 'الرياض', en: 'Riyadh', count: 162_312 } }, 'en'), 'yusuf', 'en')?.includes('yusuf') === true, String(renderWelcome(line(24), NAME_SLOT, FACTS, 'en')));
  check('no name → no line', fillName(slotted, '  ', 'ar') === null);
  // sentenceName = pickName (the menu's own rule) minus the other script (owner P1 2026-10-24: «يوسف, the market…»).
  check("the hook takes BOTH spellings from sentenceName (pickName, never the other script)", /sentenceName\(names, 'ar'\)/.test(hookSrc) && /sentenceName\(names, 'en'\)/.test(hookSrc));
  check('the hook remembers lines with the name SLOT and fills the name per language when shown',
    /name: NAME_SLOT/.test(hookSrc) && /const nm = NAME_SLOT;/.test(hookSrc) && /fillName\(fillGreeting\(shown\.ar, shown\.greet \?\? null, 'ar'\), live \|\| shown\.nameAr, 'ar'\)/.test(hookSrc)
    && /fillName\(fillGreeting\(shown\.en, shown\.greet \?\? null, 'en'\), live \|\| shown\.nameEn, 'en'\)/.test(hookSrc)
    // a changed name shows at once: the account's current name (the `name` argument) is used and re-read
    && /const live = \(name \?\? ''\)\.trim\(\);/.test(hookSrc) && /\[shown, locale, signedIn, name, swapKey\]/.test(hookSrc));
  check('old remembered lines (name baked in) are ignored', /filterWelcome:shown:v2'/.test(hookSrc));
  check('MUTATION: the pre-fix render (Latin name straight into the Arabic line) is what fillName refuses',
    /[A-Za-z]/.test(renderWelcome(line(24), 'yusuf', FACTS, 'ar') ?? '') && fillName(slotted, 'yusuf', 'ar') === null);
}

// ── 12. NEW ON EZHALAH TODAY (owner 2026-10-18, option A) ─────────────────────────────────────────
const nt = WELCOME_LINES.find((l) => l.id === 46)!;
check('line A reads «يوسف، 4,739 إعلان جديد اليوم على إزهله.» / "Yusuf, 4,739 new listings today on Ezhalah."',
  renderWelcome(nt, 'يوسف', FACTS, 'ar') === 'يوسف، 4,739 إعلان جديد اليوم على إزهله.'
  && renderWelcome(nt, 'Yusuf', FACTS, 'en') === 'Yusuf, 4,739 new listings today on Ezhalah.');
const ntOk = (min: number) => renderWelcome(nt, 'يوسف', { newToday: min - 1 }, 'ar') === null
  && renderWelcome(nt, 'يوسف', {}, 'ar') === null && renderWelcome(nt, 'يوسف', { newToday: min }, 'ar') !== null;
check(`a count under ${NEW_TODAY_MIN} or an unknown count shows no line (never «0 إعلان جديد», never a failed read as a number)`, ntOk(NEW_TODAY_MIN));
mustCatch('a line that would show «1 إعلان جديد» just after midnight (a floor of 1)', !ntOk(1));
const lateNight = new Date('2026-10-14T20:30:00Z'); // 23:30 Riyadh
const nextDay = new Date('2026-10-14T21:30:00Z');   // 00:30 Riyadh, the next day
const ntCache = { id: 46, at: lateNight.getTime(), ar: 'يوسف، 4,739 إعلان جديد اليوم على إزهله.', en: 'Yusuf, 4,739 new listings today on Ezhalah.' };
check('a held «today» line is reused the same Riyadh day',
  !!instantWelcome({ hasSession: true, cache: ntCache, now: new Date(lateNight.getTime() + 600_000), name: 'يوسف' })?.fromCache);
check('a held «today» line never crosses midnight Riyadh (yesterday\'s count is not «today»)',
  riyadhDay(lateNight.getTime()) !== riyadhDay(nextDay.getTime())
  && !instantWelcome({ hasSession: true, cache: ntCache, now: nextDay, name: 'يوسف', rand: () => 0 })?.fromCache);
mustCatch('a day rule on UTC instead of Riyadh (23:30 and 00:30 Riyadh share a UTC day)',
  Math.floor(lateNight.getTime() / 86_400_000) === Math.floor(nextDay.getTime() / 86_400_000) ? riyadhDay(lateNight.getTime()) !== riyadhDay(nextDay.getTime()) : false);
// A DAILY FACT (an insight line: «نُشر أمس …», «خلال آخر 7 أيام …») IS TRUE ONLY ON THE SAUDI DAY IT WAS BUILT FOR (owner
// 2026-10-27: «yesterday, 1 week should be based on real fact … it goes a day … we can go to jail»). Held or prepared at
// 23:30, it must not be shown at 00:30 — «أمس» would then be two days ago. Executed through the real instantWelcome.
{
  const fact = { id: 2001, at: lateNight.getTime() + 20 * 60_000, // 23:50 Riyadh
    ar: '⟦g⟧ ⟦n⟧، تدري إنه نُشر أمس ما لا يقل عن 900 إعلان جديد؟', en: '⟦g⟧ ⟦n⟧, did you know at least 900 new listings were posted yesterday?' };
  const sameNight = instantWelcome({ hasSession: true, cache: fact, now: new Date(fact.at + 5 * 60_000), name: 'يوسف', rand: () => 0 });
  const afterMidnightHeld = instantWelcome({ hasSession: true, cache: fact, now: nextDay, name: 'يوسف', rand: () => 0 });
  const afterMidnightPrepared = instantWelcome({ hasSession: true, cache: null, next: fact, now: nextDay, name: 'يوسف', rand: () => 0 });
  check('a fact line is reused the same Saudi day, but never after midnight (held OR prepared)',
    sameNight?.id === 2001 && afterMidnightHeld?.id !== 2001 && afterMidnightPrepared?.id !== 2001);
  // the case is real: 40 minutes old, inside both age limits, so only the day rule stops it
  mustCatch('an age-only rule (40 min old passes the 1 h hold and the 24 h prepare limit)', nextDay.getTime() - fact.at < Math.min(HOLD_MS, PREPARED_MAX_MS));
  const hookDays = (src: string) => (src.match(/sameRiyadhDay\(/g) ?? []).length >= 3
    && /if \(!sameRiyadhDay\(r\.line\.at, t\)\) return;/.test(src);
  check('…and the hook checks the day wherever it takes a prepared fact, and again when midnight passes while it waits', hookDays(hookSrc));
  mustCatch('the hook taking a prepared fact by age alone', !hookDays(hookSrc.replace(' && sameRiyadhDay(pend.at, start)', '').replace(' && sameRiyadhDay(pending.at, now.getTime())', '')));
}

// ── 13. the sign-in welcome (owner 2026-10-22: «whenever the user logs in or signs up, this message
// appears», five wordings so users see different ones, approved word for word) ──
{
  const APPROVED_AR = [
    'حياك {n}، إزهله طريقتك الجديدة لتلاقي عقارك في السعودية.',
    'أهلاً {n}، مع إزهله صار البحث عن عقارك في السعودية أسهل.',
    'حياك {n}، إزهله يدور لك على عقارك في كل السعودية.',
    'هلا {n}، عقارك في السعودية صار أقرب مع إزهله.',
    'مرحباً {n}، إزهله بدايتك الجديدة للبحث عن عقارك في السعودية.',
  ];
  check('the five sign-in lines are the owner\'s approved Arabic, word for word, in order',
    GREET_LINES.length === 5 && GREET_LINES.every((l, i) => l.ar === APPROVED_AR[i]));
  check('every sign-in line has its English, with the name and the untranslated brand «Ezhalah»',
    GREET_LINES.every((l) => l.en.includes('{n}') && l.en.includes('Ezhalah') && !/[؀-ۿ]/.test(l.en)));
  check('no sign-in line uses the word «حيك» (owner rule 2026-10-17)', GREET_LINES.every((l) => !/(^|\s)حيك(\s|،|$)/.test(l.ar)));
  // owner 2026-10-27: «remove this party pop 🥳» — the confetti is the party; the facts come only after it
  const noPop = (lines: readonly { ar: string; en: string }[]) => lines.every((l) => !l.ar.includes('🥳') && !l.en.includes('🥳'));
  check('no sign-in line carries 🥳 (the confetti is the party)', noPop(GREET_LINES));
  mustCatch('a 🥳 back on a sign-in line', !noPop([{ ar: 'حياك {n} 🥳', en: 'Welcome {n}' }]));
  const afterParty = (src: string) => /export const WELCOME_TO_INSIGHT_MS = RAIN_AT_MS \+ PARTY_MS;/.test(src)
    && /import \{ PARTY_MS \} from '@\/lib\/nameParty';/.test(src) && /import \{ RAIN_AT_MS \} from '@\/components\/HeroFalconer';/.test(src);
  check('the welcome changes to the facts only once the confetti party is over (eagle lands → confetti → facts)', afterParty(hookSrc));
  mustCatch('the facts arriving before the confetti (a fixed 5 s)', !afterParty(hookSrc.replace('export const WELCOME_TO_INSIGHT_MS = RAIN_AT_MS + PARTY_MS;', 'export const WELCOME_TO_INSIGHT_MS = 5000;')));
  check('the normal rotation never picks a sign-in line',
    !WELCOME_LINES.some((l) => GREET_LINES.some((g) => g.id === l.id)) && !FACTLESS_ANYTIME_IDS.some((id) => id >= 101));
  const uids = Array.from({ length: 60 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  const firsts = new Set(uids.map((u) => greetIndex(u, 0)));
  check('different users get different wordings (60 users cover all five)', firsts.size === 5);
  check('the same user sees the next wording on the next sign-in', greetIndex(uids[7], 1) === (greetIndex(uids[7], 0) + 1) % 5);
  mustCatch('a welcome that ignores who the user is (everyone the same line)', new Set(uids.map(() => 0)).size !== firsts.size);
  const g = greetingFor(uids[3], 0, NAME_SLOT)!;
  check('the welcome is rendered in BOTH languages at once, so switching language shows the same line translated',
    !!g && fillName(g.ar, 'يوسف', 'ar')!.includes('يوسف') && fillName(g.en, 'Yusuf', 'en')!.includes('Yusuf')
    && GREET_LINES.find((l) => l.id === g.id)!.en.replace('{n}', 'Yusuf') === fillName(g.en, 'Yusuf', 'en')!.replace(/[\u2068\u2069]/g, '')); // the name is bidi-isolated (invisible)
  check('an Arabic welcome never shows a Latin name (the normal headline stays instead)', fillName(g.ar, 'Yusuf', 'ar') === null);
  const tNow = new Date('2026-10-14T21:00:00');
  const held = { id: g.id, at: tNow.getTime() - 10 * 60_000, ar: g.ar, en: g.en };
  check('a reload within 30 minutes keeps the welcome', !!instantWelcome({ hasSession: true, cache: held, now: tNow, name: NAME_SLOT })?.fromCache);
  check('after 30 minutes the normal rotation resumes',
    !instantWelcome({ hasSession: true, cache: { ...held, at: tNow.getTime() - GREET_HOLD_MS - 1 }, now: tNow, name: NAME_SLOT, rand: () => 0 })!.fromCache);
}
{
  // the sign-in mark: set by a real sign-in, read once, stale after 10 minutes
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k) };
  const { markJustSignedIn, takeJustSignedIn, hasJustSignedIn, JUST_SIGNED_IN_MAX_MS } = await import('../src/lib/loginWelcome.ts');
  markJustSignedIn();
  const t = Date.now();
  check('a sign-in mark is seen', hasJustSignedIn(t) && !!takeJustSignedIn(t));
  check('the mark is taken once (one sign-in greets once)', !hasJustSignedIn(t) && takeJustSignedIn(t) === null);
  markJustSignedIn();
  check('each sign-in on the device counts up (so the wording moves on)', takeJustSignedIn(Date.now())!.count === 1);
  markJustSignedIn();
  check('a mark older than 10 minutes is ignored (a cancelled or abandoned sign-in)', takeJustSignedIn(Date.now() + JUST_SIGNED_IN_MAX_MS + 1) === null);
  const authSrc = (await import('node:fs')).readFileSync(new URL('../src/app/auth.tsx', import.meta.url), 'utf8');
  const tapSrc = (await import('node:fs')).readFileSync(new URL('../src/components/GoogleOneTap.tsx', import.meta.url), 'utf8');
  check('both sign-in paths mark the moment: the Google/Apple return route and Google One Tap',
    /markJustSignedIn\(\);/.test(authSrc) && /log\('signed in via One Tap'\), markJustSignedIn\(\);/.test(tapSrc));
  delete (globalThis as any).localStorage;
}

// ── A TAB KEEPS ITS LINE (owner 2026-10-28: «after 2 hours when I enter Ezhalah … I see the swap») ──
// Safari shows a saved picture of a sleeping tab and then reloads it; the line that tab showed is kept in its
// sessionStorage and shown again for the rest of that Saudi day. EXECUTED through the real tabLine.
{
  const t = new Date('2026-10-28T10:00:00Z').getTime();            // 13:00 Riyadh
  const saved = JSON.stringify({ id: 2007, at: t, ar: '⟦g⟧ ⟦n⟧، تدري إن 66% من إعلانات رابغ أراضٍ؟', en: '⟦g⟧ ⟦n⟧, did you know 66% of Rabigh\'s listings are land?', greet: 3 });
  const later = tabLine(saved, t + 5 * 3600_000);                    // 18:00 the same day, past the 2-hour hold
  const nextDay = tabLine(saved, new Date('2026-10-28T21:30:00Z').getTime()); // 00:30 Riyadh, the next day
  check('a returning tab gets ITS line back the same Saudi day, even after the 2-hour hold (no swap)', later?.id === 2007 && later.greet === 3);
  check('…but never on the next Saudi day, never from the future, never from garbage',
    nextDay === null && tabLine(saved, t - 1000) === null && tabLine('{bad', t) === null && tabLine(null, t) === null && tabLine(JSON.stringify({ id: 1, at: t, ar: '', en: 'x' }), t) === null);
  // the day rule is real: drop it and yesterday's line comes back after midnight
  const noDay = (raw: string, now: number) => { const v = JSON.parse(raw); return v.at <= now ? v : null; };
  mustCatch('a tab line kept across midnight (yesterday\'s «أمس»)', noDay(saved, new Date('2026-10-28T21:30:00Z').getTime()) !== null && nextDay === null);
  const hookTab = (src: string) => src.includes("const tab = !greet && session.present && (nameAr || nameEn) ? readTab(now.getTime()) : null;")
    && /: tab \? \{ id: tab\.id, ar: tab\.ar, en: tab\.en, fromCache: true, promoted: false \}\n\s*: \(nameAr \|\| nameEn\) \? instantWelcome\(/.test(src)
    && (src.match(/writeTab\(/g) ?? []).length >= 2 && src.includes('globalThis.sessionStorage?.getItem(TAB_KEY)');
  check('the hook shows the tab\'s line BEFORE choosing a new one, and records every line it shows in the tab', hookTab(hookSrc));
  mustCatch('a hook that ignores the tab (back to the swap)', !hookTab(hookSrc.replace('readTab(now.getTime())', 'null')));
  check('the tab memory is sessionStorage (one tab), never localStorage (every tab would freeze)', TAB_KEY.startsWith('ezhalah:') && !/localStorage\?\.getItem\(TAB_KEY\)/.test(hookSrc));
}

// ── THE EMOJI STAYS VISIBLE THROUGH THE SHINE (owner 2026-10-28: «the emoji after the name doesn't show») ──
{
  const home = (await import('node:fs')).readFileSync(new URL('../src/app/index.tsx', import.meta.url), 'utf8');
  const party = (await import('node:fs')).readFileSync(new URL('../src/lib/nameParty.ts', import.meta.url), 'utf8');
  const reSrc = (home.match(/^const EMOJI_RE = (\/.*\/);$/m) ?? [])[1];
  const re = reSrc ? new Function(`return ${reSrc}`)() as RegExp : null;
  const emojis = ['👋', '☀️', '🌙', '🕌', '🌴', '🤍', '☕', '🌿', '😊', '🌤️', '🏡', '✨'];
  const splits = (r: RegExp | null) => !!r && emojis.every((e) => `مساء الخير يوسف ${e}، تدري إن`.split(r).length === 3 && `مساء الخير يوسف ${e}، تدري إن`.split(r)[1] === e)
    && 'تدري إن 66% من إعلانات رابغ أراضٍ؟'.split(r).length === 1;
  check('every greeting emoji is cut into its own span (and a sentence without one is left whole)', splits(re));
  mustCatch('a pattern that misses the moon 🌙', !splits(/([☀-➿]️?)/));
  const wired = home.includes('{withVisibleEmoji(welcomeLine ?? t(HERO_TAGLINE_KEYS[heroTagline]))}')
    && home.includes("{...({ dataSet: { ezhEmoji: '' } } as any)}")
    && party.includes('[data-ezh-shine="on"] [data-ezh-emoji]{-webkit-text-fill-color:initial!important;color:initial!important}');
  check('the headline renders its emoji in that span, and the shine CSS gives the span its own fill', wired);
  mustCatch('the shine CSS without the emoji rule (the emoji vanishes on iPhone)', !(party.replace('[data-ezh-shine="on"] [data-ezh-emoji]', '[x]').includes('[data-ezh-shine="on"] [data-ezh-emoji]')));
}

console.log(`\nExample (ar): ${renderWelcome(WELCOME_LINES[3], 'يوسف', FACTS, 'ar')}`);
console.log(`Example (en): ${renderWelcome(WELCOME_LINES[23], 'Yusuf', FACTS, 'en')}`);
if (failed) { console.error(`\n❌ verify-filter-welcome: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-filter-welcome: every welcome line is live, honest, branded and rotates as approved.');
