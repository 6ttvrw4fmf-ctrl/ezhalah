// THE HOME HEADLINE'S DAILY INSIGHT LINE (owner 2026-10-22) — executed, not grepped.
//   1. the greeting follows the USER'S OWN local time (where they are): «صباح» only in their morning, «مساء» only
//      in their evening/night, «جمعة» only on their Friday, midday only the any-time hellos;
//   2. every sentence the database holds (read from the migration that seeds it) renders in BOTH languages
//      from a fact of its kind, says «تدري إن», never «قارن», and leaves no {slot} behind;
//   3. the name follows the language on screen (يوسف / Yusuf), and so does the greeting;
//   4. a fact this device saw in the past week is never picked again; a fact that cannot be said in English
//      is skipped, never half-filled;
//   5. a user who searched a district sometimes gets a line about it.
//   node --experimental-strip-types scripts/verify-insight-welcome.ts   (in `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import {
  GREETINGS, localClock, greetingFits, pickGreeting, fillGreeting, renderInsight, chooseInsightLine, insightKey,
  GREETING_SLOT, SEEN_DAYS, GREETING_EMOJI, type Insight, type InsightTemplate, type InsightPack,
} from '../src/lib/insightWelcome.ts';
import { HOW_IT_WORKS } from '../src/lib/insightHowItWorks.ts';
import { fillName, NAME_SLOT } from '../src/lib/filterWelcome.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

// ── 1. the user's OWN local time (owner 2026-10-22: «focus timing on where they are located») ──
const at = (iso: string) => new Date(iso);
const RIYADH = 180, LONDON = 60, NEW_YORK = -240;
const fits = (d: Date, off: number) => GREETINGS.filter((g) => greetingFits(g, d, off)).map((g) => g.when);
const t0 = at('2026-10-21T05:00:00Z'); // 08:00 Riyadh, 06:00 London, 01:00 New York
check('08:00 in Riyadh is a morning there', fits(t0, RIYADH).includes('morning') && !fits(t0, RIYADH).includes('evening'));
check('the SAME moment is 06:00 in London: a morning there too', fits(t0, LONDON).includes('morning'));
check('the SAME moment is 01:00 in New York: an evening/night greeting there, never a morning',
  fits(t0, NEW_YORK).includes('evening') && !fits(t0, NEW_YORK).includes('morning'));
const tEve = at('2026-10-21T17:00:00Z'); // 20:00 Riyadh, 13:00 New York
check('20:00 in Riyadh is an evening; the same moment at 13:00 in New York is only the any-time hellos',
  fits(tEve, RIYADH).includes('evening') && fits(tEve, NEW_YORK).every((w) => w === 'any'));
check('local midday (12:30) is only the any-time hellos', fits(at('2026-10-21T09:30:00Z'), RIYADH).every((w) => w === 'any'));
// 2026-10-22 is a Thursday. 22:30 UTC Thursday = 01:30 Friday in Riyadh, 18:30 Thursday in New York.
const fri = at('2026-10-22T22:30:00Z');
check('it is Friday for a user in Riyadh (01:30 Friday) …', localClock(fri, RIYADH).weekday === 5 && fits(fri, RIYADH).includes('friday'));
check('… and still Thursday for a user in New York at the same moment', localClock(fri, NEW_YORK).weekday === 4 && !fits(fri, NEW_YORK).includes('friday'));
mustCatch('one clock for everyone (Riyadh and New York agree)', fits(fri, RIYADH).join() !== fits(fri, NEW_YORK).join());
check('Saturday is the weekend but not Friday', fits(at('2026-10-24T10:00:00Z'), RIYADH).includes('weekend') && !fits(at('2026-10-24T10:00:00Z'), RIYADH).includes('friday'));
check('Sunday has no weekend greeting', !fits(at('2026-10-25T10:00:00Z'), RIYADH).includes('weekend'));
check('the device zone is what is used when no place is pinned',
  localClock(t0).hour === new Date(t0.getTime() - t0.getTimezoneOffset() * 60_000).getUTCHours());
let allFit = true;
for (const off of [RIYADH, LONDON, NEW_YORK, 330 /* India */, 0]) {
  for (let h = 0; h < 24 * 7; h++) {
    const d = new Date(Date.UTC(2026, 9, 18, 0) + h * 3600_000);
    for (let k = 0; k < 20; k++) { const i = pickGreeting(d, () => k / 20, off); if (!greetingFits(GREETINGS[i], d, off)) allFit = false; }
  }
}
check('a whole week, hour by hour, in five places: the picked greeting always fits the local time of that place', allFit);
const owner = ['صباح الخير', 'صباح النور', 'صباح الورد', 'مساء الخير', 'مساء النور', 'مساء الورد', 'جمعة مباركة', 'جمعتك مباركة',
  'إجازة سعيدة', 'استمتع بإجازتك', 'هلا', 'أهلاً', 'هلا فيك', 'مرحباً', 'يا هلا', 'حياك'];
check('the greetings are exactly the owner-approved list (no occasions, no afternoon wordings)',
  GREETINGS.length === owner.length && GREETINGS.every((g, i) => g.ar === owner[i] && !!g.en));

// ── 2. every sentence in the database, both languages ──
// The sentences as production holds them: every migration that writes welcome_template, in version order,
// later rows replacing earlier ones (the seed 20261022081647, then the wording fix 20261022162032, …).
const MIG_DIR = new URL('../supabase/migrations/', import.meta.url);
const migs = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => readFileSync(new URL(f, MIG_DIR), 'utf8')).filter((s) => s.includes('insert into public.welcome_template'));
check('the migrations that seed the sentences are in the tree', migs.length >= 2);
const byId = new Map<number, InsightTemplate>();
for (const sql of migs) {
  for (const m of sql.matchAll(/^\s*\((\d+),\s*'([^']+)',\s*(true|false),\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)'\)/gm)) {
    byId.set(Number(m[1]), { id: Number(m[1]), kind: m[2], personal: m[3] === 'true', ar: m[4].replace(/''/g, "'"), en: m[5].replace(/''/g, "'") });
  }
}
// a retired line (owner 2026-10-22: «pointless», «don't talk region») is switched off, never shown
for (const sql of migs) {
  for (const m of sql.matchAll(/update public\.welcome_template set active = false where id in \(([\d,\s]+)\)/g)) {
    for (const id of m[1].split(',')) byId.delete(Number(id.trim()));
  }
}
const templates: InsightTemplate[] = [...byId.values()].sort((x, y) => x.id - y.id);
check('31 sentences are live', templates.length === 31, `found ${templates.length}`);
check('no live sentence names a region (city, then district)', templates.every((t) => !t.ar.includes('{region}') && !t.en.includes('{region}')),
  templates.filter((t) => t.ar.includes('{region}')).map((t) => t.id).join(','));
check('the retired lines are gone (pool, websites, maid, one-ad towns, lowest rent, local offices, regions)',
  !templates.some((t) => ['pool', 'district_sites', 'region_sites', 'maid', 'town_single', 'town_few', 'min_rent_apt', 'local_office', 'region_week', 'region_land'].includes(t.kind)));
// 2026-10-24 (owner: «we can get sued»): a price line is a MEDIAN and says so plainly — «نص … أو أقل» — of what is
// ON OFFER («المعروض…» / «انعرضت»; "listed" / "ask"), never «متوسط» / "average" (scripts/verify-welcome-wording-matches-math.ts).
check('every price line says the ASKING price («المعروض» / "listed", "ask") as a median («نص … أو أقل»), never «متوسط»',
  templates.filter((t) => /(سعر|إيجار|مساحت)/.test(t.ar) && /نص/.test(t.ar)).length >= 12
  && templates.filter((t) => /نص/.test(t.ar)).every((t) => /(المعروض|انعرضت)/.test(t.ar) && /أو أقل/.test(t.ar) && /\b(listed|ask|asks)\b/.test(t.en))
  && templates.every((t) => !/متوسط/.test(t.ar) && !/\baverage\b/i.test(t.en)),
  templates.filter((t) => /متوسط/.test(t.ar)).map((t) => t.id).join(','));
// owner + their dad 2026-10-22: «investment usually happens أراضي، شقق، عماير» — purchase leads
check('investors get purchase volume for land, apartments and buildings, this week against last, and month against month',
  ['week_land', 'week_apt_sale', 'week_bld_sale', 'wow_land_up', 'wow_apt_sale_up', 'wow_bld_up', 'month_land_ppm', 'month_apt_ppm', 'month_bld_ppm']
    .every((k) => templates.some((t) => t.kind === k)));
check('rent is a side dish: at most 3 rent lines', templates.filter((t) => /إيجار/.test(t.ar)).length <= 3,
  templates.filter((t) => /إيجار/.test(t.ar)).map((t) => t.id).join(','));
check('the weak rent lines are gone (rent share, monthly payment, furnished, rent volume)',
  !templates.some((t) => ['rent_share', 'monthly', 'furnished', 'commercial_count', 'week_apt_rent', 'wow_apt_rent_up', 'wow_apt_rent_down'].includes(t.kind)));
// «we never recommend, we must never ever» — no line may advise, in either language
const ADVICE_AR = /فرصة|أرخص|أفضل|استثمر|ننصح|صفقة|يستاهل|الوقت المناسب|لا تفوت/;
const ADVICE_EN = /\b(deal|cheap|cheapest|best|invest|should|opportunity|bargain|don't miss)\b/i;
check('no sentence gives advice (Arabic or English)', templates.every((t) => !ADVICE_AR.test(t.ar) && !ADVICE_EN.test(t.en)),
  templates.filter((t) => ADVICE_AR.test(t.ar) || ADVICE_EN.test(t.en)).map((t) => t.id).join(','));
check('(mutation) the advice check catches «فرصة» and "best"', ADVICE_AR.test('فرصة ذهبية') && ADVICE_EN.test('the best price'));
check('counts say listings («إعلانات»), never properties, for the volume lines',
  templates.filter((t) => /^(week_|city_land|city_sale|city_bld_sale)/.test(t.kind)).every((t) => t.ar.includes('إعلانات') && /listings/.test(t.en)));
// owner 2026-10-22: «a lot of mistakes in the Arabic wording» — the corrected wording holds
check('no sentence puts a bare count before a singular noun («14 إعلان», «3 حي») or says «أضعاف», «الحين», «بس»',
  templates.every((t) => !/\{a\} (إعلان|حي|أرض|موقع)(?![ا-ي])/.test(t.ar) && !/أضعاف|الحين| بس[؟،. ]/.test(t.ar)), templates.filter((t) => /أضعاف|الحين| بس[؟،. ]|\{a\} (إعلان|حي)/.test(t.ar)).map((t) => t.id).join(','));
check('a district line says «اكتشفه», a city/region line «اكتشفها» (gender)',
  templates.filter((t) => t.kind === 'hot_district' && !t.personal).every((t) => t.ar.includes('اكتشفه مع')));
const base = { region: 'منطقة حائل', city: 'بقعاء', city_id: 1, district: 'حي النخيل', district2: 'حي الروضة', type: 'أرض', a: 1234, b: 56 };
const en = { city: () => 'Buqaa', district: (_c: number, d: string) => (d.includes('النخيل') ? 'Al Nakhil' : 'Al Rawdah') };
let rendered = 0;
for (const t of templates) {
  const r = renderInsight(t, { id: t.id, kind: t.kind, ...base }, en);
  if (!r) { check(`sentence ${t.id} (${t.kind}) renders`, false); continue; }
  rendered++;
  const ok = r.ar.includes('تدري إن') && !r.ar.includes('قارن') && r.ar.includes('إزهله') && r.en.includes('Ezhalah')
    && !/\{\w+\}/.test(r.ar) && !/\{\w+\}/.test(r.en) && r.ar.includes(GREETING_SLOT) && r.en.includes(GREETING_SLOT)
    && r.ar.includes(NAME_SLOT) && r.en.includes(NAME_SLOT) && !/[؀-ۿ]/.test(r.en.replace(GREETING_SLOT, '').replace(NAME_SLOT, ''));
  if (!ok) check(`sentence ${t.id} (${t.kind}) is clean in both languages`, false, `${r.ar} | ${r.en}`);
}
check('every sentence renders cleanly in Arabic and English (تدري إن، no «قارن», no leftover slot, no Arabic in English)', rendered === templates.length);
check('no sentence uses «حيك» (owner rule 2026-10-17)', templates.every((t) => !/(^|\s)حيك(\s|،|$)/.test(t.ar)));

// ── 3. name and greeting follow the language ──
const t1 = templates.find((t) => t.kind === 'land_ppm_city')!;
const r1 = renderInsight(t1, { id: 1, kind: t1.kind, ...base }, en)!;
const morning = GREETINGS.findIndex((g) => g.ar === 'صباح الخير');
// The name is bidi-isolated (U+2068 … U+2069, invisible): compare what the reader sees.
const vis = (s: string) => s.replace(/[\u2068\u2069]/g, '');
const shownAr = vis(fillName(fillGreeting(r1.ar, morning, 'ar'), 'يوسف', 'ar')!);
const shownEn = vis(fillName(fillGreeting(r1.en, morning, 'en'), 'Yusuf', 'en')!);
check('Arabic shows «صباح الخير يوسف، تدري إن …»', shownAr.startsWith('صباح الخير يوسف، تدري إن'), shownAr);
check('English shows the SAME line translated, with «Good morning Yusuf»', shownEn.startsWith('Good morning Yusuf, did you know'), shownEn);
check('an Arabic line never shows the Latin name', fillName(fillGreeting(r1.ar, morning, 'ar'), 'Yusuf', 'ar') === null);
check('a line without a greeting slot (older lines) is left as it is', fillGreeting('هلا ⟦n⟧', null, 'ar') === 'هلا ⟦n⟧');
// seen live 2026-10-22: «حي الرحاب بـالطائف», «بـجدة» — the «بـ» joins the place
const jed = { ...base, city: 'جدة' };
const rGap = renderInsight(templates.find((t) => t.kind === 'rent_gap')!, { id: 5, kind: 'rent_gap', ...jed, a: 6 }, en)!;
check('«بـ» joins the place: «بجدة», never «بـجدة»', rGap.ar.includes('بجدة') && !rGap.ar.includes('بـ'), rGap.ar);
let anyTatweel = false;
for (const t of templates) { const r = renderInsight(t, { id: t.id, kind: t.kind, ...base, city: 'الطائف' }, en); if (r && r.ar.includes('بـ')) anyTatweel = true; }
check('no sentence ever shows «بـ» before a place (e.g. «بالطائف»)', !anyTatweel);
// English reads as English: a place with no official English name skips the fact (never «Drh Al Arws»)
const noOfficial = { city: () => 'Jeddah', district: () => null };
check('a district with no official English name skips the fact (no transliterated English)',
  renderInsight(templates.find((t) => t.kind === 'rent_gap')!, { id: 6, kind: 'rent_gap', ...jed, a: 6 }, noOfficial as never) === null);

// ── 4. no repeats, no half-filled lines ──
const pack: InsightPack = { day: '2026-10-22', templates, insights: [
  { id: 1, kind: 'land_ppm_city', ...base },
  { id: 2, kind: 'rent_apt', ...base },
  { id: 3, kind: 'town_single', ...base, type: 'برج اتصالات' }, // a type with no English: must be skipped
] };
const now = Date.UTC(2026, 9, 22, 8);
const seenAll = Object.fromEntries(pack.insights.slice(0, 2).map((f) => [insightKey(f), now - 86_400_000]));
check('a fact seen in the past week is never picked again (only an unsayable one is left → nothing)',
  chooseInsightLine(pack, seenAll, now, en) === null);
const old = Object.fromEntries(pack.insights.slice(0, 2).map((f) => [insightKey(f), now - (SEEN_DAYS + 1) * 86_400_000]));
check('after a week the fact may come back', chooseInsightLine(pack, old, now, en) !== null);
const probe = (slot: string): InsightTemplate => ({ id: 0, kind: 'probe', personal: false, ar: `تدري إن {${slot}}؟`, en: `did you know {${slot}}?` });
check('a type with no English name is never put in a sentence', renderInsight(probe('type'), { ...pack.insights[2], kind: 'probe' }, en) === null);
check('an unknown region is never put in a sentence', renderInsight(probe('region'), { id: 9, kind: 'probe', ...base, region: 'منطقة مجهولة' }, en) === null);
const picks = new Set<number>();
for (let k = 0; k < 40; k++) { let r = (k + 1) / 41; const p = chooseInsightLine({ ...pack, insights: pack.insights.slice(0, 2) }, {}, now, en, { rand: () => (r = (r * 9.7 + 0.13) % 1) }); if (p) picks.add(p.templateId); }
check('different sentences come up (not always the same one)', picks.size >= 2);

// ── 5. the user's own district ──
const mine: InsightPack = { day: '2026-10-22', templates, insights: [
  { id: 10, kind: 'hot_district', ...base, district: 'حي النخيل', a: 12, b: 30 },
  { id: 11, kind: 'land_ppm_city', ...base },
] };
const p5 = chooseInsightLine(mine, {}, now, en, { district: 'النخيل', rand: () => 0.1 });
check('a user who searched a district gets a line about it (personal pick)', !!p5 && templates.find((t) => t.id === p5.templateId)!.personal && p5.ar.includes('حي النخيل'), p5?.ar);

// ── 6. the line ends with its greeting's emoji (owner 2026-10-22: «good morning ☀️ … last sentence») ──
{
  const line = renderInsight(templates.find((t) => t.kind === 'land_ppm_city')!, { id: 1, kind: 'land_ppm_city', ...base }, en)!;
  const want: Record<string, string> = { morning: '☀️', evening: '🌙', friday: '🕌', weekend: '🌴', any: '👋' };
  let allEnds = true; const bad: string[] = [];
  GREETINGS.forEach((g, i) => {
    for (const loc of ['ar', 'en'] as const) {
      const s = fillGreeting(loc === 'ar' ? line.ar : line.en, i, loc)!;
      if (!s.endsWith(` ${want[g.when]}`)) { allEnds = false; bad.push(`${g.ar}/${loc}: ${s.slice(-24)}`); }
      if (/\.\s+\S+$/.test(s)) { allEnds = false; bad.push(`full stop kept: ${s.slice(-24)}`); }
    }
  });
  check('every line ends with its greeting\'s emoji (☀️ morning, 🌙 evening, 🕌 Friday, 🌴 weekend, 👋 any time), the full stop dropped', allEnds, bad.join(' | '));
  check('the emoji table is exactly the owner\'s', JSON.stringify(GREETING_EMOJI) === JSON.stringify(want));
  const morning = GREETINGS.findIndex((g) => g.ar === 'صباح الخير');
  const shown = vis(fillName(fillGreeting(line.ar, morning, 'ar'), 'يوسف', 'ar')!);
  check('Arabic reads «صباح الخير يوسف، تدري إن … اكتشف أراضيها مع إزهله ☀️»', shown.startsWith('صباح الخير يوسف، تدري إن') && shown.endsWith('مع إزهله ☀️'), shown);
}

// ── 7. not Riyadh, Riyadh, Riyadh: city first, the user's city two lines in three, never twice in a row ──
{
  const cities = ['الرياض', 'جدة', 'أبها', 'تبوك', 'بريدة'];
  const facts: Insight[] = [];
  let id = 100;
  for (const c of cities) {
    const n = c === 'الرياض' ? 40 : 2; // Riyadh has far more facts, as in production
    for (let k = 0; k < n; k++) for (const kind of ['land_ppm_city', 'land_share']) facts.push({ id: id++, kind, ...base, city: c, city_id: id, district: `حي ${c} ${k}`, a: 100 + k });
  }
  const pack7: InsightPack = { day: '2026-10-22', templates, insights: facts };
  let r = 0.37; const rnd = () => (r = (r * 9.7 + 0.13) % 1);
  const t7 = Date.UTC(2026, 9, 22, 8);
  const count = (cityOpt: string | null) => {
    const by: Record<string, number> = {}; let seen: Record<string, number> = {}; let prev: Insight | null = null; let repeats = 0;
    for (let k = 0; k < 300; k++) {
      const p = chooseInsightLine(pack7, seen, t7 + k * 3600_000, en, { city: cityOpt, rand: rnd });
      if (!p) break;
      const f = facts.find((x) => insightKey(x) === p.key)!;
      by[f.city!] = (by[f.city!] ?? 0) + 1;
      if (prev && (prev.city === f.city || prev.kind === f.kind)) repeats++;
      prev = f; seen = { ...seen, [p.key]: t7 + k * 3600_000 };
      // a week passes every few picks in this small simulation, so facts come back (keep the last one shown)
      if (Object.keys(seen).length >= 6) seen = { [p.key]: t7 + k * 3600_000 };
    }
    return { by, repeats };
  };
  const guest = count(null);
  const total = Object.values(guest.by).reduce((a, b) => a + b, 0);
  check('a user with no searched city: Riyadh gets about its fair share, not most lines (≤ 35%)', (guest.by['الرياض'] ?? 0) / total <= 0.35, JSON.stringify(guest.by));
  check('(mutation) a pick over FACTS instead of cities would fail the fair-share check (Riyadh holds most facts)',
    facts.filter((f) => f.city === 'الرياض').length / facts.length > 0.35);
  check('every city gets a turn', cities.every((c) => (guest.by[c] ?? 0) > 0), JSON.stringify(guest.by));
  check('never the same city or the same kind of line twice in a row', guest.repeats === 0, `${guest.repeats} repeats`);
  const jeddah = count('جدة');
  const jt = Object.values(jeddah.by).reduce((a, b) => a + b, 0);
  const share = (jeddah.by['جدة'] ?? 0) / jt;
  check('a user who searches Jeddah: their city in roughly two lines of three (40%–80% here, with only 4 Jeddah facts)', share >= 0.4 && share <= 0.8, `${Math.round(share * 100)}% ${JSON.stringify(jeddah.by)}`);
}

// ── 8. «كيف تشتغل؟» says how duplicates are counted and that it is not advice (owner 2026-10-22) ──
{
  const ar = JSON.stringify(HOW_IT_WORKS.ar); const enS = JSON.stringify(HOW_IT_WORKS.en);
  check('the sheet is titled «كيف تشتغل؟» / "How it works"', HOW_IT_WORKS.ar.title.startsWith('كيف تشتغل؟') && HOW_IT_WORKS.en.title.startsWith('How it works'));
  check('it explains duplicates: same district, type, price and area count once, in counts and prices',
    ar.includes('نحسبه مرة وحدة بس') && ar.includes('نفس الحي') && ar.includes('في الأعداد وفي الأسعار') && enS.includes('we count it only once'));
  check('it says asking prices, not deals, and not investment advice', ar.includes('الأسعار المعروضة') && ar.includes('وليست نصيحة استثمارية') && enS.includes('not investment advice'));
  check('it says the fact changes every hour', ar.includes('كل ساعة') && enS.includes('every hour'));
  check('both languages carry the same sections', HOW_IT_WORKS.ar.sections.length === HOW_IT_WORKS.en.sections.length);
}

if (failed) { console.error(`\n❌ verify-insight-welcome: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-insight-welcome: greetings by local time, every sentence in both languages, no repeats.');
