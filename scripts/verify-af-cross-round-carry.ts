// ADVANCED FILTER — THE CROSS-ROUND CARRY: a question answered OR SKIPPED in an earlier round can
// NEVER be asked again in a later one. (Owner 2026-08-24, progressive rounds.)
//
// WHY THIS IS A HARD INVARIANT AND NOT A POLISH ITEM
// The interview no longer runs once: it narrows in small rounds, each opened by a manual tap on
// «تحديد أكثر» and each computed from the ALREADY-NARROWED cohort of the round before. A round is a
// fresh orchestration — fresh steps, fresh plan — so the only thing standing between round 2 and
// re-asking round 1's questions is the carried asked-set.
//
// Re-asking is not a cosmetic annoyance. The advanced applies are REPLACING, not monotone:
//   property_age  '3_5' → {ageMin:3, ageMax:5}   then  '10p' → {ageMin:10, ageMax:null}
//   furnished     'yes' → {furnishedPref:true}   then  'no'  → {furnishedPref:false}
// Re-answering does not intersect with the earlier answer — it OVERWRITES it. A re-asked question is
// therefore a hole through which the user WIDENS their own search inside a flow whose entire promise
// is that it only ever narrows, and whose card prints a live «N نتيجة» computed on the assumption
// that the count can only go down. (Compare bathrooms, which was made monotone with Math.max on
// 2026-08-19 for exactly this reason — see its comment in src/data/advancedFilters.ts.) Checks 3a/3b
// below EXECUTE the two shipped applies to prove the widening is real, not hypothetical.
//
// And the highest-risk half is the SKIP. A skip is «لا تفضيل» — it writes ZERO predicate, so it
// leaves NO facet behind (check 1). The facet list, which is what the pills and the summary are built
// from, therefore cannot record that a skipped question was ever asked. The `asked` list is the ONLY
// record of it. Carry the facets but drop `asked` and every skipped question comes straight back in
// the next round — the user says "no preference", and the app asks again.
//
// WHAT THIS BARRIER EXECUTES vs. WHAT IT PINS BY SOURCE
// The carry itself lives in src/app/agent.tsx, a React component that cannot be imported here (it
// pulls react-native-web, expo-router and the whole `@/` alias graph). So this script does not model
// the chain — it LIFTS the three shipped expressions that carry it out of the source and EVALUATES
// them with real fixtures, chained end to end:
//
//   deriveGuided (the real pure module)  →  the shipped union in syncGuidedFromSteps
//     →  the shipped seed in startAgeFlow  →  the shipped pool filter in rankQuestions
//
// so "round 1's questions are absent from round 2's plan" is an executed result, not a regex hoping
// the wiring still means what it used to. The remaining links — which callback publishes the set onto
// the results turn, which handler seeds the carry, which one must not drop it — are React wiring with
// no pure surface; those are source-pinned, and every one of them is mutation-proven at the bottom.
//
//   node --experimental-strip-types scripts/verify-af-cross-round-carry.ts   (wire into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveGuided, type GuidedStep } from '../src/lib/afSteps.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

const agentSrc = codeOnly(read('src/app/agent.tsx'));
const afSrc = codeOnly(read('src/data/advancedFilters.ts'));

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nAdvanced Filter — cross-round carry: nothing answered OR skipped is ever asked twice\n');

// ── the shipped expressions, lifted so they can be executed ─────────────────────────────────────
// Each `lift` names the file and the fix in its own failure, because a rename that quietly stops
// this barrier from finding its subject is the same defect as breaking the invariant outright.
const lift = (src: string, file: string, what: string, re: RegExp): string | null => {
  const m = src.match(re);
  if (m?.[1]) return m[1];
  failures++;
  console.error(`FAIL  ${what} could not be found in ${file}`
    + `\n      This barrier EXECUTES that expression. If it moved or was renamed, re-home it or`
    + `\n      update the pattern here — do not leave the invariant unverified.`);
  return null;
};

// Every assignment to the interview's asked-set. There must be exactly two (seed + derive-union) and
// both must build a FRESH Set, never grow one in place — see check 4.
const askedWriters = [...agentSrc.matchAll(/ageFlowAskedRef\.current\s*=\s*(new Set\([\s\S]*?\));/g)]
  .map((m) => m[1]);

// Evaluate one of those assignments against a fixture carry + a fixture derivation.
const runWriter = (expr: string, carriedAsked: string[] | null, derivedAskedIds: string[]): Set<string> => {
  const afCarryRef = { current: carriedAsked ? { asked: carriedAsked } : null };
  return new Function('afCarryRef', 'd', `return ${expr};`)(afCarryRef, { askedIds: derivedAskedIds });
};

// ── 1. a SKIP is recorded as ASKED but leaves no facet — the reason `asked` must be carried ──────
// Executed against the real record module. If facets could encode a skip, carrying facets alone
// would be enough and the whole `asked` list would be redundant. They cannot.
type Q = GuidedStep['question'];
const fakeQ = (id: string, apply: (x: any, keys: string[]) => any): Q =>
  ({ id, titleKey: id, selection: 'single', eligibility: () => true, resolveOptions: async () => ({} as any), apply } as unknown as Q);
const opts = (...ks: string[]) => ks.map((k) => ({ key: k, label: `L:${k}`, count: 10 })) as GuidedStep['options'];
const step = (question: Q, options: GuidedStep['options'], keys: string[] | null): GuidedStep =>
  ({ question, options, unknownCount: 0, total: 100, keys });

const AGE = fakeQ('property_age', (x, keys) => ({ ...x, ageBucket: keys[0] }));
const FURN = fakeQ('furnished', (x, keys) => ({ ...x, furnishedPref: keys[0] === 'yes' }));
const BATH = fakeQ('bathrooms', (x, keys) => ({ ...x, bathMin: Number(keys[0]) }));

// Round 1 as the owner's own live run had it: age ANSWERED, furnished SKIPPED, bathrooms ANSWERED.
const round1 = [step(AGE, opts('3_5', '10p'), ['3_5']), step(FURN, opts('yes', 'no'), []), step(BATH, opts('3', '4'), ['4'])];
const d1 = deriveGuided({ city: 'الرياض' } as any, round1, round1.length);

check('a SKIPPED question is recorded in askedIds',
  d1.askedIds.includes('furnished'),
  'deriveGuided must count a skip as asked, or nothing downstream can know it happened');
check('a SKIPPED question produces NO facet — so facets alone can never record it',
  !d1.facets.some((f) => f.id === 'furnished') && d1.facets.length === 2,
  'this is exactly why the carry needs `asked` in addition to `facets`');
check('an ANSWERED question is both asked and committed',
  d1.askedIds.includes('property_age') && d1.facets.some((f) => f.id === 'property_age'));

// ── 2. the union writer: carry ∪ this round's derivation ────────────────────────────────────────
const syncExpr = askedWriters.find((e) => /d\.askedIds/.test(e));
if (!syncExpr) {
  failures++;
  console.error('FAIL  syncGuidedFromSteps no longer builds the asked-set from d.askedIds + the carry'
    + '\n      src/app/agent.tsx — the set must stay DERIVED and must union afCarryRef.current.asked.');
} else {
  // Round 2 opened from the round-1 turn: the carry brings all three ids, this round has derived
  // one of its own so far.
  const merged = runWriter(syncExpr, d1.askedIds, ['street_width']);
  check('the carried round-1 ANSWERS survive into round 2\'s asked-set',
    merged.has('property_age') && merged.has('bathrooms'));
  check('the carried round-1 SKIP survives into round 2\'s asked-set',
    merged.has('furnished'),
    'a skip leaves no facet — drop it from the carry and round 2 asks it again');
  check('round 2\'s OWN derived questions are still in the set (the union goes both ways)',
    merged.has('street_width'));
  check('round 1 with NO carry (the first round) starts from its own derivation alone',
    (() => { const s = runWriter(syncExpr, null, ['property_age']); return s.size === 1 && s.has('property_age'); })(),
    'a null carry must not throw and must not invent history');
}

// ── 3. seeding: the OPENING rank of a round must already know the carry ─────────────────────────
// startAgeFlow ranks the plan BEFORE the first syncGuidedFromSteps runs, so the union above is too
// late to protect the first question of a round. Caught live 2026-08-24: round 2 re-opened on «كم
// عمر العقار؟» with «جديد» at 100% of the set — an option that could not move anything, because the
// answer was already applied.
const seedExpr = askedWriters.find((e) => !/d\.askedIds/.test(e));
if (!seedExpr) {
  failures++;
  console.error('FAIL  startAgeFlow no longer seeds the asked-set from the carry'
    + '\n      src/app/agent.tsx — `new Set()` there re-asks round 1\'s first question in round 2.');
} else {
  const seeded = runWriter(seedExpr, d1.askedIds, []);
  check('a round OPENS with every earlier-round question already marked asked',
    d1.askedIds.every((id) => seeded.has(id)),
    'the opening rankQuestions runs before the first derivation — an empty seed re-asks round 1');
  check('the very first round opens with an EMPTY asked-set (no carry, no invented history)',
    runWriter(seedExpr, null, []).size === 0);
}

// ── 4. the asked-set stays DERIVED — never grown incrementally ──────────────────────────────────
// Rebuild-not-inverse is the interview's founding rule (src/lib/afSteps.ts). An `.add()` on the
// asked-set would be a second source of truth that Back cannot un-do: walk back over a question and
// the derivation forgets it, while the incrementally-grown set still claims it was asked.
check('exactly TWO writers assign the asked-set (the round seed and the derived union)',
  askedWriters.length === 2,
  `found ${askedWriters.length} — src/app/agent.tsx: any third writer is a second source of truth`);
check('every writer builds a FRESH Set — the asked-set is never mutated in place',
  askedWriters.every((e) => e.startsWith('new Set(')));
check('nothing ever grows the asked-set incrementally (no .add / .delete / .clear)',
  !/ageFlowAskedRef\.current\.(add|delete|clear)\(/.test(agentSrc),
  'src/app/agent.tsx — rebuild from the steps + the carry instead; Back cannot un-do an .add()');

// ── 5. the endpoint: round 2\'s PLAN. The shipped pool filter, executed. ─────────────────────────
// This is the actual claim of R1 — not "the set is right" but "the question cannot appear in the
// next plan". rankQuestions is the single funnel every round's plan comes through.
const poolExpr = lift(afSrc, 'src/data/advancedFilters.ts', 'the rankQuestions pool filter',
  /export async function rankQuestions\([\s\S]*?const pool = ([^;]+);/);
if (poolExpr && syncExpr) {
  const POOL = [{ id: 'property_age' }, { id: 'furnished' }, { id: 'bathrooms' }, { id: 'street_width' }];
  const asked = runWriter(syncExpr, d1.askedIds, []);
  const plan: Array<{ id: string }> =
    new Function('eligibleQuestions', 'q', 'askedIds', `return ${poolExpr};`)(() => POOL, {}, asked);
  const ids = plan.map((p) => p.id);
  check('round 2\'s plan excludes every question round 1 ANSWERED',
    !ids.includes('property_age') && !ids.includes('bathrooms'),
    `plan was [${ids}] — a re-asked replacing question lets the user WIDEN their own search`);
  check('round 2\'s plan excludes the question round 1 SKIPPED',
    !ids.includes('furnished'),
    `plan was [${ids}] — «لا تفضيل» must not be re-asked next round`);
  check('round 2\'s plan still offers what has NOT been asked',
    ids.length === 1 && ids[0] === 'street_width',
    `plan was [${ids}] — the carry must exclude, never empty, the pool`);
}

// ── 6. THE COST, executed against the two real REPLACING applies ────────────────────────────────
// Lifted from src/data/advancedFilters.ts so this cannot go stale against a hand-copied fixture.
const ageApply = lift(afSrc, 'src/data/advancedFilters.ts', "AGE_QUESTION's apply body",
  /id: 'property_age',[\s\S]*?apply\(q, keys\) \{([\s\S]*?)\n {2}\},/);
if (ageApply) {
  const apply = new Function('q', 'keys', ageApply) as (q: any, k: string[]) => any;
  const r1 = apply({ city: 'الرياض' }, ['3_5']);          // round 1: «٣-٥ سنوات»
  const r2 = apply(r1, ['10p']);                          // round 2 re-asks: «١٠+ سنوات»
  check('property_age.apply REPLACES — a re-ask discards the earlier answer and WIDENS',
    r1.ageMin === 3 && r1.ageMax === 5 && r2.ageMin === 10 && r2.ageMax === null,
    'if this ever becomes monotone the carry is still required — but revisit this check\'s wording');
  check('property_age can even be re-answered back to «جديد», dropping the age window entirely',
    (() => { const back = apply(r1, ['new']); return back.ageMin === null && back.ageMax === null && back.isNewConstruction === true; })());
}
const furnApply = lift(afSrc, 'src/data/advancedFilters.ts', "FURNISHED_QUESTION's apply expression",
  /id: 'furnished',[\s\S]*?apply: \(q, keys\) =>([\s\S]*?),\n\};/);
if (furnApply) {
  const apply = new Function('q', 'keys', `return (${furnApply});`) as (q: any, k: string[]) => any;
  check('furnished.apply REPLACES — a re-ask FLIPS the user\'s committed preference',
    apply(apply({}, ['yes']), ['no']).furnishedPref === false,
    'the round-1 answer is not intersected, it is overwritten');
}

// ── 7. the React wiring that carries the set between rounds (source-pinned) ─────────────────────
// finishGuided → the results turn → the CTA → the next round. Each link is one line; each is
// mutation-proven below.
const has = (re: RegExp) => re.test(agentSrc);

check('finishGuided publishes the asked-set onto the results turn it produced',
  has(/asked: \[\.\.\.ageFlowAskedRef\.current\]/),
  'src/app/agent.tsx — without it the completed round leaves no record for the next tap to carry');
check('the results turn\'s guided record carries `asked` all the way through runRefine',
  has(/guided\?: \{ baseQ: SearchQuery; facets: GuidedFacet\[\]; asked: string\[\] \}/)
  && has(/setGuidedPills\(\{[^)]*asked: opts\.guided\.asked/),
  'src/app/agent.tsx — a record without `asked` silently forgets every skip');
check('«تحديد أكثر» seeds the carry from THAT turn\'s record, including `asked`',
  has(/afCarryRef\.current = q\s*\n?\s*\? \{ msgId: m\.id, originQ: carried\?\.baseQ \?\? q, facets: carried\?\.facets \?\? \[\], asked: carried\?\.asked \?\? \[\] \}/),
  'src/app/agent.tsx — the CTA is the only place a round learns what came before it');

// The seed must be written BEFORE the round opens: startAgeFlow reads afCarryRef synchronously.
{
  const body = agentSrc.match(/testID="results-narrow"[\s\S]*?<\/Pressable>/)?.[0] ?? '';
  check('the carry is written BEFORE startAgeFlow is called (it is read synchronously)',
    body.indexOf('afCarryRef.current =') >= 0
    && body.indexOf('afCarryRef.current =') < body.indexOf('startAgeFlow(q)'),
    'src/app/agent.tsx — seeding after the call hands the new round the PREVIOUS tap\'s carry');
}

// UPDATED 2026-08-25 (review), deliberately STRENGTHENED, not relaxed. The original pin required the
// record to survive a pill removal — correct, and still required below. But it pinned the asked-set as
// `guidedPills.asked` VERBATIM, which also froze a real defect: the removed facet's own id stayed in
// the carry, so un-answering a question permanently un-askable it. Removing «عمر ٣-٥ سنوات» to pick a
// different bucket burned property_age for the rest of the chat, and once the pool was spent that way
// «تحديد أكثر» stopped rendering at all. The carry's purpose is to stop re-asking what the user
// RESOLVED; a facet the user just deleted is unresolved again. Both halves are now pinned: the record
// still survives, AND exactly the removed id is dropped from it.
check('removing the LAST pill still passes the guided record, so the asked-set survives',
  has(/\{ guided: \{ baseQ: guidedPills\.baseQ, facets: remaining, asked: guidedPills\.asked/),
  'src/app/agent.tsx removeGuidedFacet — a conditional `remaining.length ? … : undefined` here '
  + 'resurrects every question earlier rounds asked or skipped');
check('a REMOVED facet is un-asked: its id is dropped from the carried asked-set',
  has(/asked: guidedPills\.asked\.filter\(\(id\) => id !== removed\.id\)/),
  'src/app/agent.tsx removeGuidedFacet — carrying the removed question forward makes pill removal a '
  + 'one-way door: that dimension can never be answered again, and an exhausted pool hides the CTA');
check('the guided record is never dropped wholesale (no setGuidedPills(null))',
  !has(/setGuidedPills\(null\)/),
  'src/app/agent.tsx — clearing the record throws away the asked-set with it. If a future flow '
  + 'genuinely must clear it, re-home `asked` first and update this check with the reason.');
check('the offer probe asks with the SAME carried asked-set the round will use',
  has(/const asked = guidedPills\?\.msgId === m\.id \? guidedPills\.asked : \[\];/)
  && has(/rankQuestions\(q, new Set\(asked\)\)/),
  'src/app/agent.tsx — probing with an empty set offers a round whose only question is a repeat');
check('the round\'s own plan is ranked against the carried set, not a fresh one',
  (agentSrc.match(/rankQuestions\(q, ageFlowAskedRef\.current\)/g) ?? []).length === 2,
  'src/app/agent.tsx — both the opening rank and the per-answer re-rank must pass the carried set');

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
// Every check above is re-run against a deliberately broken variant of its own subject and must go
// RED. A check no mutation can break is decoration.
let mutFail = 0;
const mustCatch = (what: string, caught: boolean) => {
  if (caught) { console.log(`  ✓ catches: ${what}`); return; }
  mutFail++;
  console.error(`  ✗ BLIND to: ${what}`);
};
console.log('\nmutation proof — each guard must catch its own defect\n');

const mut = (src: string, from: string | RegExp, to: string) => src.replace(from, to);
const writersOf = (src: string) =>
  [...src.matchAll(/ageFlowAskedRef\.current\s*=\s*(new Set\([\s\S]*?\));/g)].map((m) => m[1]);

// (a) the union writer stops carrying — the origin/main shape, which is the bug
{
  const broken = writersOf(mut(agentSrc,
    'new Set([...(afCarryRef.current?.asked ?? []), ...d.askedIds])', 'new Set(d.askedIds)'))
    .find((e) => /d\.askedIds/.test(e))!;
  const merged = runWriter(broken, d1.askedIds, ['street_width']);
  mustCatch('syncGuidedFromSteps reverting to the derivation alone (round 1 vanishes)',
    !merged.has('property_age') || !merged.has('furnished'));
}
// (b) the union carries facets-derived ids only — i.e. someone rebuilds `asked` from the facets
{
  const facetIds = d1.facets.map((f) => f.id);
  mustCatch('the carry being reconstructed from FACETS (which cannot record a skip)',
    !new Set([...facetIds, ...d1.askedIds.filter(() => false)]).has('furnished'));
}
// (c) the seed goes back to empty — the live round-2 re-ask defect
{
  const broken = writersOf(mut(agentSrc,
    'ageFlowAskedRef.current = new Set(afCarryRef.current?.asked ?? []);',
    'ageFlowAskedRef.current = new Set();'))
    .find((e) => !/d\.askedIds/.test(e))!;
  mustCatch('startAgeFlow re-emptying the asked-set (round 2 re-opens on round 1\'s question)',
    !d1.askedIds.every((id) => runWriter(broken, d1.askedIds, []).has(id)));
}
// (d) a third writer appears
mustCatch('a third assignment to the asked-set (a second source of truth)',
  writersOf(mut(agentSrc, 'ageFlowLabelsRef.current = d.labels;',
    'ageFlowAskedRef.current = new Set(d.askedIds); ageFlowLabelsRef.current = d.labels;')).length !== 2);
// (e) incremental growth creeps back
mustCatch('the asked-set being grown with .add() instead of derived',
  /ageFlowAskedRef\.current\.(add|delete|clear)\(/.test(
    mut(agentSrc, 'const ranked = await rankQuestions(q, ageFlowAskedRef.current);',
      'ageFlowAskedRef.current.add(question.id);\n    const ranked = await rankQuestions(q, ageFlowAskedRef.current);')));
// (f) the pool filter stops honouring the asked-set
{
  const broken = mut(afSrc, /const pool = ([^;]+);/, 'const pool = eligibleQuestions(q);')
    .match(/export async function rankQuestions\([\s\S]*?const pool = ([^;]+);/)![1];
  const POOL = [{ id: 'property_age' }, { id: 'furnished' }, { id: 'bathrooms' }, { id: 'street_width' }];
  const plan = new Function('eligibleQuestions', 'q', 'askedIds', `return ${broken};`)(
    () => POOL, {}, runWriter(syncExpr!, d1.askedIds, []));
  mustCatch('rankQuestions dropping its asked-set filter (every round asks everything)',
    plan.some((p: any) => p.id === 'property_age'));
}
// (g) the applies really are replacing — a monotone fixture would make check 6 meaningless
mustCatch('a fixture that pretended the applies were monotone',
  ((q: any, k: string[]) => ({ ...q, ageMin: Math.max(q.ageMin ?? 0, Number(k[0])) }))({ ageMin: 3 }, ['10']).ageMin === 10
  && new Function('q', 'keys', ageApply ?? 'return q;')({ ageMin: 3, ageMax: 5 }, ['10p']).ageMax === null);
// (h)-(m) the React wiring
mustCatch('finishGuided no longer publishing the asked-set onto its results turn',
  !/asked: \[\.\.\.ageFlowAskedRef\.current\]/.test(
    mut(agentSrc, 'asked: [...ageFlowAskedRef.current],', 'facets: [],')));
mustCatch('the guided record losing `asked` on the way through runRefine',
  !/setGuidedPills\(\{[^)]*asked: opts\.guided\.asked/.test(
    mut(agentSrc, 'asked: opts.guided.asked, ', '')));
mustCatch('the CTA seeding a carry with no history',
  !/afCarryRef\.current = q\s*\n?\s*\? \{ msgId: m\.id, originQ: carried\?\.baseQ \?\? q, facets: carried\?\.facets \?\? \[\], asked: carried\?\.asked \?\? \[\] \}/.test(
    mut(agentSrc, 'asked: carried?.asked ?? [] }', 'asked: [] }')));
{
  const broken = mut(agentSrc,
    /const carried = guidedPills\?\.msgId === m\.id \? guidedPills : null;([\s\S]*?): null;\n(\s*)if \(q && anyGuidedEligible\(q\)\) void startAgeFlow\(q\);/,
    'const carried = guidedPills?.msgId === m.id ? guidedPills : null;\n'
    + '  if (q && anyGuidedEligible(q)) void startAgeFlow(q);\n'
    + '  afCarryRef.current = q ? { msgId: m.id, originQ: q, facets: [], asked: [] } : null;');
  const body = broken.match(/testID="results-narrow"[\s\S]*?<\/Pressable>/)?.[0] ?? '';
  mustCatch('the carry being seeded AFTER the round opens (startAgeFlow reads it synchronously)',
    !(body.indexOf('afCarryRef.current =') >= 0
      && body.indexOf('afCarryRef.current =') < body.indexOf('startAgeFlow(q)')));
}
mustCatch('removeGuidedFacet dropping the record when the last pill goes',
  !/\{ guided: \{ baseQ: guidedPills\.baseQ, facets: remaining, asked: guidedPills\.asked/.test(
    mut(agentSrc, '{ guided: { baseQ: guidedPills.baseQ, facets: remaining, asked: guidedPills.asked.filter((id) => id !== removed.id) } })',
      'remaining.length ? { guided: { baseQ: guidedPills.baseQ, facets: remaining } } : undefined)')));
mustCatch('removeGuidedFacet carrying the REMOVED question forward (pill removal as a one-way door)',
  !/asked: guidedPills\.asked\.filter\(\(id\) => id !== removed\.id\)/.test(
    mut(agentSrc, 'asked: guidedPills.asked.filter((id) => id !== removed.id)', 'asked: guidedPills.asked')));
mustCatch('setGuidedPills(null) coming back (the asked-set goes with it)',
  /setGuidedPills\(null\)/.test(mut(agentSrc, 'if (!guidedPills || busy) return;',
    'if (!guidedPills || busy) { setGuidedPills(null); return; }')));
mustCatch('the offer probe going back to an empty asked-set',
  !/rankQuestions\(q, new Set\(asked\)\)/.test(
    mut(agentSrc, 'rankQuestions(q, new Set(asked))', 'rankQuestions(q, new Set())')));
mustCatch('a round ranking its plan against a fresh set instead of the carried one',
  (mut(agentSrc, 'const ranked = await rankQuestions(q, ageFlowAskedRef.current);',
    'const ranked = await rankQuestions(q, new Set());')
    .match(/rankQuestions\(q, ageFlowAskedRef\.current\)/g) ?? []).length !== 2);
// (n) the lifts themselves must notice when their subject disappears
mustCatch('a rename that would leave the union expression unverified',
  writersOf(mut(agentSrc, /ageFlowAskedRef\.current = new Set\(\[\.\.\.\(afCarryRef/g, 'askedSet = new Set([...(afCarryRef'))
    .length !== 2);

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ a question answered OR skipped in an earlier round can never be asked again\n');
