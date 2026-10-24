// HOME HEADLINE: THE WORDS SAY EXACTLY WHAT THE NUMBER IS, AND THE NUMBER IS FRESH (owner 2026-10-24: «we can get sued»).
//
// Seen live: «متوسط السعر المعروض للعمائر في حي العارض بالرياض 14,000,000 ريال» — the number was the MEDIAN (99 buildings,
// mean 17,098,956). Every «متوسط» line was a median. Migrations *_welcome_facts_exact_and_fresh.sql (math: registry
// welcome_kind_stat, medians rounded UP, the checker tests each median line's literal claim, P1 alarms, rebuilt every 3
// hours) and *_welcome_lines_say_what_the_number_is.sql (the words + a trigger + a P1 detector) fixed it in the database.
// This file re-applies the same wording rule, in TypeScript, to the lines those migrations commit, so a later PR that
// rewrites a line or a kind's statistic is judged before it is applied — and checks the math and the schedule shapes.
//   node --experimental-strip-types scripts/verify-welcome-wording-matches-math.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();
const pick = (re: RegExp) => { const f = files.filter((x) => re.test(x)).at(-1); return f ? readFileSync(join(dir, f), 'utf8') : ''; };
const math = pick(/_welcome_facts_exact_and_fresh\.sql$/);
const words = pick(/_welcome_lines_say_what_the_number_is\.sql$/);

type Stat = { stat: string; window: string | null; plurality: boolean; steady: boolean; knownAge: boolean; scope: string | null };
const q = (s: string) => (s === 'null' ? null : s.replace(/^'|'$/g, ''));
/** The registry rows the math migration inserts. */
function registry(sql: string): Map<string, Stat> {
  const m = new Map<string, Stat>();
  const re = /\(\s*'([a-z_]+)',\s*'(median|mean|count|share|pct_change)',\s*('[^']*'|null),\s*(true|false),\s*(true|false),\s*(true|false),\s*('[^']*'|null)/g;
  for (const x of sql.matchAll(re)) m.set(x[1], { stat: x[2], window: q(x[3]), plurality: x[4] === 'true', steady: x[5] === 'true', knownAge: x[6] === 'true', scope: q(x[7]) });
  return m;
}
/** The lines the wording migration writes: (id, kind, ar, en). */
function lines(sql: string): { id: number; kind: string; ar: string; en: string }[] {
  const out: { id: number; kind: string; ar: string; en: string }[] = [];
  for (const x of sql.matchAll(/^\s*\((\d+), '([a-z_]+)', (?:true|false), '((?:[^']|'')*)',\s*\n\s*'((?:[^']|'')*)'\)/gm)) {
    out.push({ id: Number(x[1]), kind: x[2], ar: x[3].replace(/''/g, "'"), en: x[4].replace(/''/g, "'") });
  }
  return out;
}
/** The SAME rule as public.welcome_template_problem() (null = fine). */
export function problem(s: Stat | undefined, ar: string, en: string): string | null {
  if (!s) return 'kind has no declared statistic';
  if (s.stat !== 'mean' && (/متوسط/.test(ar) || /\b(average|mean)\b/i.test(en))) return `says «متوسط/average» over a ${s.stat}`;
  if (s.stat === 'mean' && !(/متوسط/.test(ar) && /\baverage\b/i.test(en))) return 'a mean must say «متوسط» / "average"';
  if (/\bmedian\b/i.test(en)) return 'say what a median means, not the word';
  if (s.stat === 'median' && !(/نص/.test(ar) && /أو أقل/.test(ar) && /\bhalf\b/i.test(en) && /or (less|smaller)/i.test(en))) return 'a median must read «نص … أو أقل» / "half … or less"';
  if (s.stat !== 'median' && /أو أقل/.test(ar)) return '«أو أقل» belongs to a median line';
  if (/(هذا الأسبوع|هذا الشهر|الشهر الماضي|الأسبوع الماضي)/.test(ar) || /\b(this|last) (week|month)\b/i.test(en)) return 'a calendar word over a rolling window';
  if (s.window === '7d' && !(/آخر 7 أيام/.test(ar) && /last 7 days/i.test(en))) return 'a 7-day line must say «آخر 7 أيام» / "last 7 days"';
  if (s.window === '30d' && !(/آخر 30 يوم/.test(ar) && /last 30 days/i.test(en))) return 'a 30-day line must say «آخر 30 يوم» / "last 30 days"';
  if (s.window === 'yesterday' && !(/أمس/.test(ar) && /yesterday/i.test(en))) return 'a yesterday line must say «أمس» / "yesterday"';
  if (/أكثرها/.test(ar) || /most of them/i.test(en)) return '«أكثرها» / "most of them" reads as a majority';
  if (s.plurality && !(/أكثر حي/.test(ar) && /the most/i.test(en))) return 'name the district with the most';
  if (s.steady && !(/بانتظام/.test(ar) && /steadily/i.test(en))) return 'say the change is on steadily-read sites';
  if (s.knownAge && !(/عمرها/.test(ar) && /\bage\b/i.test(en))) return 'say the share is among listings that state their age';
  return null;
}
function mathProblems(sql: string): string[] {
  const f: string[] = [];
  if (!sql) return ['migration *_welcome_facts_exact_and_fresh.sql is missing'];
  if (!/then ceil\(p_v\) else round\(p_v\)/.test(sql)) f.push('welcome_shown no longer rounds a median UP');
  for (const n of ["'round(percentile_cont(0.5)', 'ceil(percentile_cont(0.5)', '4'", "'round(m1::numeric), round(m0::numeric)', 'ceil(m1::numeric), ceil(m0::numeric)'"]) {
    if (!sql.includes(n)) f.push(`the builder edit «${n.slice(0, 40)}…» is gone`);
  }
  if (!/why := 'claim_false'/.test(sql)) f.push('the checker no longer tests each median line\'s literal claim');
  if (!/schedule := '45 \*\/3 \* \* \*'/.test(sql)) f.push('the facts are not rebuilt every 3 hours at :45 (after the :22 sync)');
  if (!/\$r\$'P1'\$r\$, '1'\]/.test(sql)) f.push('a checker disagreement is not P1');
  if (!/interval '3 hours 30 minutes'/.test(sql)) f.push('no alarm when a 3-hourly build is missed');
  if (!/missed nearest-rounding/.test(sql)) f.push('no apply-time proof that nearest rounding is caught');
  return f;
}
function wordProblems(reg: Map<string, Stat>, ls: { id: number; kind: string; ar: string; en: string }[], sql: string): string[] {
  const f: string[] = [];
  if (ls.length < 31) f.push(`only ${ls.length} lines parsed from the wording migration (expected 31)`);
  for (const l of ls) { const p = problem(reg.get(l.kind), l.ar, l.en); if (p) f.push(`template ${l.id} (${l.kind}): ${p}`); }
  for (const k of ['land_ppm_city', 'land_gap', 'rent_apt', 'rent_gap', 'villa_area', 'shop_rent', 'apt_sale_ppm', 'villa_price', 'bld_price', 'month_apt_ppm', 'month_land_ppm', 'month_bld_ppm']) {
    if (reg.get(k)?.stat !== 'median') f.push(`${k} is not declared a median`);
  }
  if (!/create trigger welcome_template_wording_matches_math before insert or update on public\.welcome_template/.test(sql)) f.push('no trigger guards the lines');
  if (!/mon_raise\('P1', 'welcome_insights_audit', 'fleet', 'welcome_insights_audit:wording:'/.test(sql)) f.push('no P1 alarm for a line that slips through');
  return f;
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const reg = registry(math);
const ls = lines(words);
check(`the registry declares every line's statistic (${reg.size} kinds)`, reg.size >= 29, `${reg.size}`);
const mp = mathProblems(math);
check('medians rounded up, each median claim tested, P1 on any disagreement, rebuilt every 3 hours', mp.length === 0, mp.join('; '));
const wp = wordProblems(reg, ls, words);
check('every committed line says exactly what its number is (ar + en)', wp.length === 0, wp.join('; '));

const villa = ls.find((l) => l.kind === 'villa_area');
const hot = ls.find((l) => l.kind === 'hot_district');
mustCatch('«متوسط» over a median (the live bug)', !!villa && problem(reg.get('villa_area'), villa.ar.replace('نص الفلل', 'متوسط مساحة الفلل'), villa.en) !== null);
mustCatch('"average" over a median in English', !!villa && problem(reg.get('villa_area'), villa.ar, villa.en.replace('half of the villas', 'the average villa')) !== null);
mustCatch('«أقل من» without «أو أقل» (false for odd counts)', !!villa && problem(reg.get('villa_area'), villa.ar.replace('{a} م² أو أقل', 'أقل من {a} م²'), villa.en) !== null);
mustCatch('«هذا الأسبوع» over a rolling 7 days', !!hot && problem(reg.get('hot_district'), hot.ar.replace('خلال آخر 7 أيام', 'هذا الأسبوع'), hot.en) !== null);
const land = ls.find((l) => l.kind === 'city_land');
mustCatch('«أكثرها في» / "most of them" (reads as a majority; it is the district with the most)', !!land && problem(reg.get('city_land'), land.ar.replace('وأكثر حي فيه منها', 'أكثرها في'), land.en.replace('with the most in', 'most of them in')) !== null);
mustCatch('a kind with no declared statistic', problem(undefined, 'x', 'y') !== null);
mustCatch('nearest rounding back', mathProblems(math.replace('then ceil(p_v) else round(p_v)', 'then round(p_v) else round(p_v)')).length > 0);
mustCatch('back to one nightly build', mathProblems(math.replace("schedule := '45 */3 * * *'", "schedule := '40 21 * * *'")).length > 0);
mustCatch('the trigger dropped', wordProblems(reg, ls, words.replace('create trigger welcome_template_wording_matches_math', 'create trigger x')).length > 0);

if (failed) { console.error(`\n❌ verify-welcome-wording-matches-math: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-welcome-wording-matches-math: the home headline says exactly what its numbers are, and they are fresh.');
