// AN AREA CONSTRAINT FROM THE AI CHAT MUST ACTUALLY FILTER — «فوق 1000 متر» can't return 300 m².
//
// THE DEFECT (owner-found live 2026-09-06). "ابي فيلا في عرعر مساحتها فوق 1000 متر" returned villas
// of 819 / 362 / 630 m² and the summary showed no size line at all. Root cause: the agent path put
// the size into `detail` for DISPLAY + price-per-m² math only; it was NEVER converted to
// areaMin/areaMax, and the results RPC filters area SOLELY from those (remote.ts p_area_min/max). So
// every area/size constraint from the AI chat was silently dropped.
//
// THE FIX. queryFromBackend now runs parseAreaConstraint(userText) and sets q.areaMin/q.areaMax for
// an EXPLICIT ≥ / ≤ / range (a size unit must be adjacent, so a budget «فوق مليون ريال» is never
// read as an area). A bare exact size with no operator stays display-only ("around N") — it must NOT
// become a hard filter and over-restrict.
//
// This EXECUTES the real lifted parseAreaConstraint (never a copy) across a table of real phrases,
// and pins the wiring in queryFromBackend + the RPC's area param.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = join(import.meta.dirname, '..');
const src = readFileSync(join(ROOT, 'src/data/agent.ts'), 'utf8');

const lifted = await liftSymbols(
  join(ROOT, 'src/data/agent.ts'),
  [{ header: 'export function parseAreaConstraint', endsWith: /^\}$/ }],
  ['parseAreaConstraint'],
  // the two trivial helpers parseAreaConstraint closes over — no logic under test, so shimmed:
  "const _AR_DIGITS = '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669'; const _n = (x) => parseInt(String(x).replace(/[,\u060C\s]/g, ''), 10) || 0;",
);
const parseAreaConstraint = lifted.parseAreaConstraint as (t: string) => { areaMin?: number; areaMax?: number };

let failed = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failed++;
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── the phrase table — Arabic + English, digits Arabic + Latin ───────────────────────────────────
const CASES: Array<[string, { areaMin?: number; areaMax?: number }]> = [
  ['ابي فيلا في عرعر مساحتها فوق 1000 متر', { areaMin: 1000 }],   // THE reported bug
  ['فيلا مساحتها أكثر من 500 متر', { areaMin: 500 }],
  ['فيلا مساحتها اكبر من ٧٥٠ م²', { areaMin: 750 }],
  ['بيت مساحته ١٠٠٠ متر فأكثر', { areaMin: 1000 }],
  ['ارض 2000 متر وفوق', { areaMin: 2000 }],
  ['شقة مساحتها تحت 200 م²', { areaMax: 200 }],
  ['فيلا اقل من 400 متر', { areaMax: 400 }],
  ['ارض من 500 الى 800 متر', { areaMin: 500, areaMax: 800 }],
  ['ارض بين 600 و 900 متر', { areaMin: 600, areaMax: 900 }],
  ['villa area over 1000 sqm', { areaMin: 1000 }],
  ['land 300-600 m2', { areaMin: 300, areaMax: 600 }],
  ['apartment up to 150 sqm', { areaMax: 150 }],
  // NEGATIVES — a budget must never be read as an area, a bare size must not become a hard filter:
  ['فيلا بسعر فوق مليون ريال', {}],
  ['فيلا للبيع فوق 500 الف', {}],
  ['فيلا 300 متر', {}],
  ['شقة 3 غرف في الرياض', {}],
  ['فيلا في الرياض', {}],
];
for (const [q, exp] of CASES) {
  const got = parseAreaConstraint(q);
  check(`«${q}» → ${JSON.stringify(exp)}`, eq(got, exp), `got ${JSON.stringify(got)}`);
}

// ── wiring: queryFromBackend must apply the parse to areaMin/areaMax and drop the duplicate size ──
const strip = (t: string) => t;
check('queryFromBackend calls parseAreaConstraint over the attempt texts',
  /parseAreaConstraint\(_tx\)/.test(strip(src)) && /_areaTexts = \(proximityTexts/.test(strip(src)));
check('a parsed min/max is written to q.areaMin / q.areaMax',
  /q\.areaMin = String\(_area\.areaMin\)/.test(strip(src)) && /q\.areaMax = String\(_area\.areaMax\)/.test(strip(src)));
check('the cosmetic size `detail` is dropped once the area becomes a real filter (no double Size line)',
  /q\.detail = null;/.test(strip(src)) && /!\/\^\(\[1-4\]\|5\\\+\?\)\$\/\.test\(q\.detail\)/.test(strip(src)));
// the RPC still reads area only from areaMin/areaMax — the reason this fix works
check('the results RPC filters area from q.areaMin / q.areaMax (remote.ts)',
  /p_area_min: pnum\(q\.areaMin\)/.test(readFileSync(join(ROOT, 'src/data/remote.ts'), 'utf8'))
  && /p_area_max: pnum\(q\.areaMax\)/.test(readFileSync(join(ROOT, 'src/data/remote.ts'), 'utf8')));

// ── executable mutation proofs — the invariants on deliberately broken inputs must come out wrong ──
const mustCatch = (label: string, invariantHeldOnBrokenInput: boolean) =>
  check(`MUTATION ${label} — caught`, invariantHeldOnBrokenInput === false,
    'the invariant held on a broken input, so the check cannot catch this bug');
// If parse ignored «فوق», the min would be missing → «فوق 1000 متر» would yield {} like a bare size.
mustCatch('«فوق N متر» must not parse as empty', eq(parseAreaConstraint('مساحتها فوق 1000 متر'), {}));
// If a budget were read as area, «فوق مليون ريال» would yield a min → it must stay empty.
mustCatch('a riyal budget must not become an area', parseAreaConstraint('فوق 900 ريال').areaMin != null);

console.log(failed
  ? `\n✗ verify-agent-area-constraint: ${failed} check(s) failed.\n`
  : '\n✅ verify-agent-area-constraint: AI-chat area constraints become real areaMin/areaMax filters.\n');
process.exit(failed ? 1 : 0);
