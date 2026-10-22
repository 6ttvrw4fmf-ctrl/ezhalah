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
import { readFileSync, existsSync } from 'node:fs';
import {
  GREETINGS, localClock, greetingFits, pickGreeting, fillGreeting, renderInsight, chooseInsightLine, insightKey,
  GREETING_SLOT, SEEN_DAYS, type Insight, type InsightTemplate, type InsightPack,
} from '../src/lib/insightWelcome.ts';
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
  'إجازة سعيدة', 'استمتع بإجازتك', 'هلا', 'أهلاً', 'هلا والله', 'مرحباً', 'يا هلا', 'حياك الله'];
check('the greetings are exactly the owner-approved list (no occasions, no afternoon wordings)',
  GREETINGS.length === owner.length && GREETINGS.every((g, i) => g.ar === owner[i] && !!g.en));

// ── 2. every sentence in the database, both languages ──
const MIG = new URL('../supabase/migrations/20261022081647_welcome_insights.sql', import.meta.url);
check('the migration that seeds the sentences is in the tree', existsSync(MIG));
const sql = existsSync(MIG) ? readFileSync(MIG, 'utf8') : '';
const templates: InsightTemplate[] = [];
for (const m of sql.matchAll(/^\s*\((\d+),\s*'([^']+)',\s*(true|false),\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)'\)/gm)) {
  templates.push({ id: Number(m[1]), kind: m[2], personal: m[3] === 'true', ar: m[4].replace(/''/g, "'"), en: m[5].replace(/''/g, "'") });
}
check('29 sentences are seeded', templates.length === 29, `found ${templates.length}`);
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
const shownAr = fillName(fillGreeting(r1.ar, morning, 'ar'), 'يوسف', 'ar')!;
const shownEn = fillName(fillGreeting(r1.en, morning, 'en'), 'Yusuf', 'en')!;
check('Arabic shows «صباح الخير يوسف، تدري إن …»', shownAr.startsWith('صباح الخير يوسف، تدري إن'), shownAr);
check('English shows the SAME line translated, with «Good morning Yusuf»', shownEn.startsWith('Good morning Yusuf, did you know'), shownEn);
check('an Arabic line never shows the Latin name', fillName(fillGreeting(r1.ar, morning, 'ar'), 'Yusuf', 'ar') === null);
check('a line without a greeting slot (older lines) is left as it is', fillGreeting('هلا ⟦n⟧', null, 'ar') === 'هلا ⟦n⟧');

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
check('a type with no English name is never put in a sentence', renderInsight(templates.find((t) => t.kind === 'town_single')!, pack.insights[2], en) === null);
check('an unknown region is never put in a sentence', renderInsight(templates.find((t) => t.kind === 'region_land')!, { id: 9, kind: 'region_land', ...base, region: 'منطقة مجهولة' }, en) === null);
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

if (failed) { console.error(`\n❌ verify-insight-welcome: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-insight-welcome: greetings by local time, every sentence in both languages, no repeats.');
