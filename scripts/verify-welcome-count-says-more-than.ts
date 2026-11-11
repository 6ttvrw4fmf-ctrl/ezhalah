// A CITY COUNT SAYS «أكثر من N», NEVER AN EXACT NUMBER (owner 2026-11-09: «More than»). The welcome facts are built every
// 3 hours and cached on the phone for the day; an exact «14,083» was a few ads off by evening. Lines with an exact count
// now read «أكثر من {a_more}» / "more than {a_more}", and the app writes moreThan(a): a round number STRICTLY below the
// count with room to spare. EXECUTED: the real moreThan / renderInsight run on numbers and on every committed sentence,
// plus mutations of the source.
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : ` — ${detail}`}`); if (!ok) failed++; };
const mustCatch = (name: string, caught: boolean) => { console.log(`${caught ? '✓' : '✗'} mutation caught: ${name}`); if (!caught) failed++; };

const SRC = new URL('../src/lib/insightWelcome.ts', import.meta.url);
const src = readFileSync(SRC, 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'more-than-'));
let n = 0;
const load = async (code: string) => { const f = join(dir, `insightWelcome-${n++}.ts`); writeFileSync(f, code); return import(pathToFileURL(f).href); };

type Mod = { moreThan: (v: number) => number | null; atLeast: (v: number) => number | null; renderInsight: (t: unknown, f: unknown, en: unknown) => { ar: string; en: string } | null };
const en = { city: () => 'Riyadh', district: () => 'Al Malqa' };
const tpl = { id: 32, kind: 'city_land', personal: false, ar: 'في {city} أكثر من {a_more}، وأكثر حي فيها {district}؟', en: '{city} has more than {a_more} listings, the most in {district}?' };
const fact = (a: number) => ({ id: 1, kind: 'city_land', region: null, city: 'الرياض', city_id: 3, district: 'الملقا', district2: null, type: null, a, b: null });

function verdicts(m: Mod) {
  // every count from 11 to 200,000: strictly below, with at least 0.5% (or 1) of room, and a round number
  let strict = true, room = true, round = true;
  for (let v = 11; v <= 200_000; v += v < 2000 ? 1 : 37) {
    const r = m.moreThan(v);
    if (r == null || r >= v) { strict = false; continue; }
    if (v - r < Math.max(1, Math.ceil(v * 0.005))) room = false;
    const digits = String(r).replace(/0+$/, '').length;
    if (digits > 2) round = false;
  }
  // «at least»: at or below the count, with the same room, round from 20 up
  let leastOk = true;
  for (let v = 3; v <= 200_000; v += v < 2000 ? 1 : 37) {
    const r = m.atLeast(v);
    if (r == null || r > v - Math.max(1, Math.ceil(v * 0.005))) { leastOk = false; continue; }
    if (r >= 20 && String(r).replace(/0+$/, '').length > 2) leastOk = false;
  }
  const yTpl = { id: 23, kind: 'yesterday', personal: false, ar: 'ما لا يقل عن {a_least}، منها ما لا يقل عن {b_least} في {city}؟', en: 'at least {a_least}, at least {b_least} of them in {city}?' };
  const y = m.renderInsight(yTpl, { ...fact(4312), kind: 'yesterday', b: 120 }, en);
  const line = m.renderInsight(tpl, fact(14083), en);
  return {
    example: m.moreThan(14083) === 14000 && m.moreThan(163) === 160 && m.moreThan(37) === 30,
    strict, room, round,
    tiny: m.moreThan(10) === null && m.moreThan(3) === null,
    rendered: !!line && line.ar.includes('أكثر من 14,000') && line.en.includes('more than 14,000') && !line.ar.includes('14,083'),
    tinySkipped: m.renderInsight(tpl, fact(9), en) === null,
    leastExample: m.atLeast(120) === 110 && m.atLeast(4312) === 4200 && m.atLeast(7) === 6 && m.atLeast(2) === null,
    leastOk,
    leastRendered: !!y && y.ar.includes('4,200') && y.ar.includes('110') && !y.ar.includes('4,312') && !y.ar.includes('120'),
  };
}
const allOk = (v: Record<string, boolean>) => Object.values(v).every(Boolean);

const real = verdicts(await load(src) as Mod);
check('14,083 → «أكثر من 14,000»; 163 → 160; 37 → 30', real.example);
check('every count 11…200,000 is said as a number strictly below it', real.strict);
check('with at least 0.5% (or 1 ad) of room for the day\'s drift', real.room);
check('and the number is round (two leading digits)', real.round);
check('a count of 10 or less says nothing (no round number worth saying)', real.tiny);
check('the sentence renders «أكثر من 14,000» / "more than 14,000", never the exact count', real.rendered);
check('a fact too small for a round number is skipped, never half-filled', real.tinySkipped);
check('«at least»: 120 → 110, 4,312 → 4,200, 7 → 6, 2 → nothing', real.leastExample);
check('«at least» is always at or below the count with ≥0.5% (or 1) of room, round from 20 up', real.leastOk);
check('«ما لا يقل عن» renders the rounded numbers for {a_least} and {b_least}, never the exact counts', real.leastRendered);

const mutate = async (label: string, from: string, to: string) => {
  if (!src.includes(from)) { check(`mutation target present: ${label}`, false); return; }
  mustCatch(label, !allOk(verdicts(await load(src.replace(from, to)) as Mod)));
};
await mutate('no room for drift', 'Math.trunc(v) - Math.max(1, Math.ceil(v * 0.005))', 'Math.trunc(v)');
await mutate('rounded to the nearest instead of down', 'return Math.floor(lim / mag) * mag;', 'return Math.round(lim / mag) * mag;');
await mutate('«at least» with no room', 'if (lim < 2) return null;', 'if (lim < 2) return null; if (v > 0) return Math.trunc(v);');
await mutate('the exact count written into {b_least}', 'vAr.b_least = vEn.b_least = fmt(m);', 'vAr.b_least = vEn.b_least = fmt(b as number);');
await mutate('the exact count written into {a_more}', 'vAr.a_more = vEn.a_more = fmt(m);', 'vAr.a_more = vEn.a_more = fmt(a as number);');

// the committed sentences, latest first wins: no exact-count line states the bare count
const MIG = new URL('../supabase/migrations/', import.meta.url);
const migs = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(new URL(f, MIG), 'utf8'));
const lines = new Map<number, { ar: string; en: string }>();
for (const sql of migs) {
  for (const m of sql.matchAll(/^\s*\((\d+),\s*'[^']+',\s*(?:true|false),\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)'\)/gm)) lines.set(Number(m[1]), { ar: m[2], en: m[3] });
  for (const m of sql.matchAll(/update public\.welcome_template set\s+ar = '((?:[^']|'')*)'(?:,\s*en = '((?:[^']|'')*)')?\s+where id = (\d+);/g)) {
    const old = lines.get(Number(m[3])); lines.set(Number(m[3]), { ar: m[1], en: m[2] ?? old?.en ?? '' });
  }
}
for (const id of [32, 55]) {
  const l = lines.get(id);
  check(`line ${id} (an exact city count) says «أكثر من {a_more}» / "more than {a_more}"`,
    !!l && l.ar.includes('أكثر من {a_more}') && l.en.includes('more than {a_more}') && !l.ar.includes('{a}') && !l.en.includes('{a}'), l?.ar);
}

for (const id of [3, 22, 23, 28, 33, 42, 48]) {
  const l = lines.get(id);
  check(`line ${id} (an «at least» count) carries {a_least} and no bare count`,
    !!l && l.ar.includes('{a_least}') && /at least \{a_least\}/.test(l.en) && !/\{[ab]\}/.test(l.ar) && !/\{[ab]\}/.test(l.en), l?.ar);
}
if (failed) { console.error(`\n❌ verify-welcome-count-says-more-than: ${failed} failure(s)`); process.exit(1); }
console.log('\n✅ verify-welcome-count-says-more-than: a city count says «أكثر من N», a round number strictly below it');
