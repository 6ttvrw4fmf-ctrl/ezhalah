// THE HOME HEADLINE'S DAILY INSIGHT LINE (owner 2026-10-22). A signed-in user's headline is a greeting chosen
// by the user's LOCAL time + «تدري إن …» + one fact Ezhalah's own data says today, about any town, district or region.
// The facts are rebuilt every night in the database (build_welcome_insights, migration 20261022081647) and
// read through welcome_insights_pick; the sentence shapes live there too (welcome_template).
//
// Pure: no React, no network, no storage. Executed by scripts/verify-insight-welcome.ts.
//
// TIMING IS THE USER'S OWN LOCAL TIME (owner 2026-10-22: «focus timing on where they are located»): the hour
// and weekday come from the device's time zone, i.e. where the user is. A user in London at 8 am gets
// «صباح الخير» even though it is 10 am in Riyadh. The zone offset is passed in so tests can pin any place;
// a device that reports nothing usable falls back to Saudi time (UTC+3), the market's own zone.
//
// THE GREETING IS CHOSEN WHEN THE LINE IS SHOWN, not when it is prepared: the prepared line carries
// GREETING_SLOT and the hook fills it at mount from the clock of that moment. A line prepared at 11:00 and
// first seen at 20:00 therefore says «مساء الخير».
//
// THE NAME FOLLOWS THE LANGUAGE (owner: «يوسف in Arabic, Yusuf in English»): lines keep NAME_SLOT and the
// hook's fillName puts in the name for the language on screen; both languages are rendered together so
// the language button shows the same line translated.

export const GREETING_SLOT = '⟦g⟧';
const NAME = '⟦n⟧'; // same token as filterWelcome.ts NAME_SLOT

export type Greeting = { ar: string; en: string; when: 'morning' | 'evening' | 'friday' | 'weekend' | 'any' };
/** The line ends with its greeting's emoji (owner 2026-10-22: «good morning ☀️ should be the emoji, last sentence»). */
export const GREETING_EMOJI: Record<Greeting['when'], string> = { morning: '☀️', evening: '🌙', friday: '🕌', weekend: '🌴', any: '👋' };
/** «… اكتشفها مع إزهله.» → «… اكتشفها مع إزهله ☀️»: the closing full stop gives way to the emoji. */
export const endWithEmoji = (text: string, emoji: string): string => `${text.trimEnd().replace(/[.。]$/, '')} ${emoji}`;
// Owner-approved 2026-10-22 (occasions and afternoon wordings removed by the owner).
export const GREETINGS: readonly Greeting[] = [
  { when: 'morning', ar: 'صباح الخير', en: 'Good morning' },
  { when: 'morning', ar: 'صباح النور', en: 'Good morning' },
  { when: 'morning', ar: 'صباح الورد', en: 'Good morning' },
  { when: 'evening', ar: 'مساء الخير', en: 'Good evening' },
  { when: 'evening', ar: 'مساء النور', en: 'Good evening' },
  { when: 'evening', ar: 'مساء الورد', en: 'Good evening' },
  { when: 'friday', ar: 'جمعة مباركة', en: 'Jumma Mubarak' },
  { when: 'friday', ar: 'جمعتك مباركة', en: 'Jumma Mubarak' },
  { when: 'weekend', ar: 'إجازة سعيدة', en: 'Happy weekend' },
  { when: 'weekend', ar: 'استمتع بإجازتك', en: 'Enjoy your weekend' },
  { when: 'any', ar: 'هلا', en: 'Hi' },
  { when: 'any', ar: 'أهلاً', en: 'Hello' },
  { when: 'any', ar: 'هلا فيك', en: 'Hey' },
  { when: 'any', ar: 'مرحباً', en: 'Hello' },
  { when: 'any', ar: 'يا هلا', en: 'Hi there' },
  { when: 'any', ar: 'حياك', en: 'Welcome' },
];

/** Minutes ahead of UTC where the user is (the device's zone); Saudi time when the device says nothing usable. */
export function deviceOffsetMinutes(now: Date): number {
  const o = -now.getTimezoneOffset();
  return Number.isFinite(o) && Math.abs(o) <= 14 * 60 ? o : 180;
}

/** The user's local hour (0–23) and weekday (0 = Sunday … 5 = Friday, 6 = Saturday). */
export function localClock(now: Date, offsetMinutes: number = deviceOffsetMinutes(now)): { hour: number; weekday: number } {
  const r = new Date(now.getTime() + offsetMinutes * 60_000);
  return { hour: r.getUTCHours(), weekday: r.getUTCDay() };
}

/** Morning 04:00–11:59, evening 15:00–03:59 (the user's local time); midday 12:00–14:59 only the any-time hellos. */
export function greetingFits(g: Greeting, now: Date, offsetMinutes?: number): boolean {
  const { hour, weekday } = localClock(now, offsetMinutes);
  switch (g.when) {
    case 'morning': return hour >= 4 && hour < 12;
    case 'evening': return hour >= 15 || hour < 4;
    case 'friday': return weekday === 5;
    case 'weekend': return weekday === 5 || weekday === 6;
    default: return true;
  }
}

/** The greeting for THIS moment: one of those that fit, at random (the index is kept for the page load). */
export function pickGreeting(now: Date, rand: () => number = Math.random, offsetMinutes?: number): number {
  const fit = GREETINGS.map((g, i) => (greetingFits(g, now, offsetMinutes) ? i : -1)).filter((i) => i >= 0);
  return fit[Math.min(fit.length - 1, Math.floor(rand() * fit.length))];
}

/** Put the greeting into a line for the language on screen. null leaves the line untouched (no slot). */
export function fillGreeting(text: string | null, greetingIndex: number | null, locale: 'ar' | 'en'): string | null {
  if (!text) return text;
  if (!text.includes(GREETING_SLOT)) return text;
  const g = greetingIndex != null ? GREETINGS[greetingIndex] : undefined;
  if (!g) return null;
  return endWithEmoji(text.split(GREETING_SLOT).join(locale === 'ar' ? g.ar : g.en), GREETING_EMOJI[g.when]);
}

// ── the facts ──────────────────────────────────────────────────────────────────────────────────────────
export type InsightTemplate = { id: number; kind: string; personal: boolean; ar: string; en: string };
export type Insight = {
  id: number; kind: string; region: string | null; city: string | null; city_id: number | null;
  district: string | null; district2: string | null; type: string | null; a: number | string | null; b: number | string | null;
};
export type InsightPack = { day: string | null; templates: InsightTemplate[]; insights: Insight[] };

export const REGION_EN: Record<string, string> = {
  'منطقة الرياض': 'the Riyadh Region', 'منطقة مكة المكرمة': 'the Makkah Region', 'منطقة المدينة المنورة': 'the Madinah Region',
  'منطقة القصيم': 'Al-Qassim', 'المنطقة الشرقية': 'the Eastern Province', 'منطقة عسير': 'Asir', 'منطقة تبوك': 'the Tabuk Region',
  'منطقة حائل': 'the Hail Region', 'منطقة الحدود الشمالية': 'the Northern Borders', 'منطقة جازان': 'Jazan', 'منطقة نجران': 'Najran',
  'منطقة الباحة': 'Al-Baha', 'منطقة الجوف': 'Al-Jouf',
};
// Types a fact may name; a type outside this list is never put into a sentence (the fact is skipped).
export const TYPE_EN: Record<string, string> = {
  'أرض': 'land', 'أرض سكنية': 'residential land', 'أرض سكني': 'residential land', 'أرض تجارية': 'commercial land', 'أرض تجاري': 'commercial land',
  'أرض زراعية': 'farmland', 'أرض زراعي': 'farmland', 'أرض صناعية': 'industrial land', 'أرض صناعي': 'industrial land',
  'شقة': 'apartment', 'فيلا': 'villa', 'بيت': 'house', 'دور': 'floor', 'دوبلكس': 'duplex', 'عمارة': 'building', 'استراحة': 'rest house',
  'شاليه': 'chalet', 'مزرعة': 'farm', 'محل': 'shop', 'مكتب': 'office', 'مستودع': 'warehouse', 'معرض': 'showroom', 'استوديو': 'studio',
  'تاون هاوس': 'townhouse', 'مجمع سكني': 'residential compound', 'ورشة': 'workshop', 'غرفة': 'room', 'مخيم': 'camp',
};

const fmt = (v: number) => Math.trunc(v).toLocaleString('en-US');
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const stripCity = (s: string) => s.trim();
const withHay = (d: string) => (/^حي\s/.test(d.trim()) ? d.trim() : `حي ${d.trim()}`);

export type NameEn = { city: (cityId: number, cityAr: string) => string | null; district: (cityId: number, districtAr: string) => string | null };

/** One fact in one sentence, both languages, greeting and name still slotted. null when anything the
 *  sentence names is missing, not a fact we can state, or has no English (the line is never half-filled). */
export function renderInsight(t: InsightTemplate, f: Insight, en: NameEn): { ar: string; en: string } | null {
  if (t.kind !== f.kind) return null;
  const vAr: Record<string, string> = { g: GREETING_SLOT, n: NAME };
  const vEn: Record<string, string> = { g: GREETING_SLOT, n: NAME };
  const need = (key: string) => t.ar.includes(`{${key}}`) || t.en.includes(`{${key}}`);
  if (need('a')) { const a = num(f.a); if (a == null) return null; vAr.a = vEn.a = fmt(a); }
  if (need('b')) { const b = num(f.b); if (b == null) return null; vAr.b = vEn.b = fmt(b); }
  if (need('region')) {
    if (!f.region || !REGION_EN[f.region]) return null;
    vAr.region = f.region; vEn.region = REGION_EN[f.region];
  }
  if (need('city')) {
    if (!f.city) return null;
    const e = f.city_id != null ? en.city(f.city_id, f.city) : null;
    if (!e || /[؀-ۿ]/.test(e)) return null;
    vAr.city = stripCity(f.city); vEn.city = e;
  }
  for (const k of ['district', 'district2'] as const) {
    if (!need(k)) continue;
    const d = f[k];
    if (!d || f.city_id == null) return null;
    const e = en.district(f.city_id, d);
    if (!e || /[؀-ۿ]/.test(e)) return null;
    vAr[k] = withHay(d); vEn[k] = e;
  }
  if (need('type')) {
    if (!f.type || !TYPE_EN[f.type]) return null;
    vAr.type = f.type; vEn.type = TYPE_EN[f.type];
  }
  const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  // «بـ» + a place reads «بجدة» / «بالطائف», never «بـجدة» / «بـالطائف» (owner 2026-10-22, seen live).
  const ar = fill(t.ar, vAr).replace(/بـ(?=\S)/g, 'ب');
  const enS = fill(t.en, vEn);
  if (/\{\w+\}/.test(ar) || /\{\w+\}/.test(enS)) return null;
  return { ar, en: enS };
}

/** The same fact on another day keeps this key, so «never twice in a week» holds across nightly rebuilds. */
export const insightKey = (f: Insight) => [f.kind, f.region ?? '', f.city ?? '', f.district ?? '', f.district2 ?? ''].join('|');
export const SEEN_DAYS = 7;
export type Seen = Record<string, number>; // insightKey → when shown (ms)

/** The kind and city of the line this device showed last (from the seen list), so the next one differs. */
export function lastShown(seen: Seen): { kind: string; city: string } | null {
  let best: string | null = null; let at = -1;
  for (const [k, t] of Object.entries(seen)) if (t > at) { at = t; best = k; }
  if (!best) return null;
  const [kind, , city] = best.split('|');
  return { kind: kind ?? '', city: city ?? '' };
}
const sameCity = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.replace(/^مدينة\s+/, '').trim() === b.replace(/^مدينة\s+/, '').trim();

/**
 * The next line (owner 2026-10-22):
 *  • a user who searched a district gets a line about THAT district about one time in three;
 *  • otherwise about two lines in three are about the city they search, one in three about other cities;
 *  • the CITY is picked first, at random, then a fact in it — so it is never «Riyadh, Riyadh, Riyadh» just
 *    because Riyadh has the most districts and therefore the most facts;
 *  • never the same city, nor the same kind of line, twice in a row; never a fact seen in the past week.
 * Returns the template id (for the cache id) and the fact key (for the seen list).
 */
export function chooseInsightLine(
  pack: InsightPack, seen: Seen, now: number, en: NameEn,
  opts: { district?: string | null; city?: string | null; rand?: () => number } = {},
): { templateId: number; key: string; ar: string; en: string } | null {
  const rand = opts.rand ?? Math.random;
  const last = lastShown(seen);
  const fresh = (f: Insight) => { const t = seen[insightKey(f)]; return !t || now - t > SEEN_DAYS * 86_400_000; };
  const mine = (f: Insight) => !!opts.district && !!f.district && f.district.replace(/^حي\s+/, '') === opts.district.replace(/^حي\s+/, '');
  const pairsOf = (templates: InsightTemplate[], filter: (f: Insight) => boolean) => {
    const pairs: { t: InsightTemplate; f: Insight }[] = [];
    for (const t of templates) for (const f of pack.insights) if (f.kind === t.kind && filter(f) && fresh(f)) pairs.push({ t, f });
    // not the same kind of line, nor the same city, twice in a row — when there is anything else to say
    const varied = pairs.filter(({ f }) => !last || (f.kind !== last.kind && (f.city ?? '') !== last.city));
    return varied.length ? varied : pairs;
  };
  // a random pair that renders in both languages; `byCity` picks the city first so every city gets a fair turn
  const pick = (pairs: { t: InsightTemplate; f: Insight }[], byCity: boolean) => {
    const groups = new Map<string, { t: InsightTemplate; f: Insight }[]>();
    for (const p of pairs) { const k = byCity ? (p.f.city ?? '') : ''; groups.set(k, [...(groups.get(k) ?? []), p]); }
    const cities = [...groups.keys()];
    while (cities.length) {
      const ci = Math.min(cities.length - 1, Math.floor(rand() * cities.length));
      const list = groups.get(cities[ci])!;
      for (let left = list.length; left > 0; left--) {
        const i = Math.min(left - 1, Math.floor(rand() * left));
        const { t, f } = list[i];
        list[i] = list[left - 1];
        const r = renderInsight(t, f, en);
        if (r) return { templateId: t.id, key: insightKey(f), ...r };
      }
      cities.splice(ci, 1);
    }
    return null;
  };
  const personal = pack.templates.filter((t) => t.personal);
  const general = pack.templates.filter((t) => !t.personal);
  if (opts.district && rand() < 1 / 3) {
    const p = pick(pairsOf(personal, mine), false);
    if (p) return p;
  }
  if (opts.city && rand() < 2 / 3) {
    const p = pick(pairsOf(general, (f) => sameCity(f.city, opts.city)), false);
    if (p) return p;
  }
  return pick(pairsOf(general, (f) => !opts.city || !sameCity(f.city, opts.city)), true)
    ?? pick(pairsOf(general, () => true), true);
}

/** Cache ids for insight lines: 2000 + template id (WELCOME_LINES use 1–99, sign-in lines 101–105). */
export const INSIGHT_ID_BASE = 2000;
export const isInsightLineId = (id: number) => id >= INSIGHT_ID_BASE && id < INSIGHT_ID_BASE + 1000;
