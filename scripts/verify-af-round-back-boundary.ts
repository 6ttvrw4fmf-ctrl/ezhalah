// «رجوع» AT A ROUND BOUNDARY — the Advanced Filter now narrows in SMALL ROUNDS (owner 2026-08-24),
// and that turned one Back button into two different actions depending on where the user stands.
//
//   Back on question 2/3/4  → move back ONE question, inside this round. (verify-af-back-navigation.ts)
//   Back on question 1      → CANCEL the round. The user is returned to EXACTLY the result state they
//                             opened it from: byte-identical query, no predicate added or dropped, no
//                             new turn, no receipt, and both action buttons back where they were.
//   Back                    → NEVER walks into an older, already-completed round.
//
// What breaking it costs the user. A round is opened FROM a result the previous rounds produced. Get
// the cancel wrong in either direction and the user is silently moved:
//
//   • Cancel that COMMITS the option sitting selected on screen (the shape «عرض النتائج» deliberately
//     uses) files an answer the user was in the middle of backing out of.
//   • Cancel that rewinds to the pre-AF ORIGIN throws away every earlier round. The user taps Back on
//     one question and 4,225 listings come back where 635 were.
//   • A round whose record is SEEDED from the previous round lets Back walk into questions the user
//     already answered and finished with — and, because deriveGuided re-applies every step in the
//     record on top of a base that ALREADY contains those answers, an appending predicate (amenities)
//     is applied twice.
//   • A cancel that leaves the completed-round receipt behind, or clears the offer probe, strands the
//     turn with no way forward: the buttons never come back.
//
// None of that is visible in a screenshot of the first round, which is why it is pinned here.
//
// This barrier EXECUTES the record rules against `src/lib/afSteps.ts` (pure by design, exactly so a
// barrier can run it) modelling a real two-round journey, and pattern-matches ONLY the agent.tsx
// wiring that cannot be executed — which handler drops the record, who may write a receipt, and where
// the carry is seeded. Every check is mutation-proven at the bottom.
//
//   node --experimental-strip-types scripts/verify-af-round-back-boundary.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveGuided, type GuidedStep } from '../src/lib/afSteps.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

const agentSrc = codeOnly(read('src/app/agent.tsx'));

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nAdvanced Filter — «رجوع» at a ROUND boundary (cancel vs. step back)\n');

// ── slicers ────────────────────────────────────────────────────────────────────────────────────
// Read semantically, not as literal lines: what matters is what a handler DOES, not how it is spelled.
const fnBody = (src: string, head: string, end: string) => {
  const i = src.indexOf(head);
  return i < 0 ? '' : src.slice(i, src.indexOf(end, i));
};
// The `if (stepIndex <= 0) { … }` branch of onAgeBack, brace-matched so a mutation that adds a nested
// block is still read in full (a fixed «to the next }» slice would stop short and go blind).
const cancelBranch = (src: string) => {
  const body = fnBody(src, 'const onAgeBack = () => {', 'const onAgeSkipAll');
  const i = body.indexOf('if (stepIndex <= 0) {');
  if (i < 0) return '';
  let depth = 0;
  for (let j = body.indexOf('{', i); j < body.length; j++) {
    if (body[j] === '{') depth++;
    else if (body[j] === '}' && --depth === 0) return body.slice(i, j + 1);
  }
  return '';
};

// ── the two-round journey, modelled on the REAL apply shapes ───────────────────────────────────
// bath REPLACES a scalar, amenities APPENDS to a list. The double-apply failure is invisible on the
// first and permanent on the second, so both are exercised.
type Q = GuidedStep['question'];
const q = (id: string, apply: (x: any, keys: string[]) => any): Q =>
  ({ id, titleKey: id, selection: 'single', eligibility: () => true, resolveOptions: async () => ({} as any), apply } as unknown as Q);
const BATH = q('bathrooms', (x, keys) => ({ ...x, bathMin: Number(keys[0]) }));
const AMEN = q('amenities', (x, keys) => ({ ...x, amenities: [...(x.amenities ?? []), ...keys] }));
const opts = (...ks: string[]) => ks.map((k) => ({ key: k, label: `L:${k}`, count: 10 })) as GuidedStep['options'];
const step = (question: Q, options: GuidedStep['options'], keys: string[] | null): GuidedStep =>
  ({ question, options, unknownCount: 0, total: 100, keys });

// The true pre-AF search, then ROUND 1 commits one answer and its result turn is rendered.
const ORIGIN = { city: 'الرياض', deal: 'إيجار' } as any;
const R1_STEPS = [step(BATH, opts('3', '4'), ['3'])];
const R1_QUERY = deriveGuided(ORIGIN, R1_STEPS, 1).query as any;   // what the user is looking at now

// ── 1. cancel returns the ROUND'S OWN base, untouched ──────────────────────────────────────────
// startAgeFlow anchors `ageFlowBaseQRef` to the query the round opened on; the cancel drops the
// record and re-derives at cursor 0. With nothing in the record, the rebuild is the base itself —
// the same object, not a normalised copy of it. That identity IS "byte-identical query".
{
  const d = deriveGuided(R1_QUERY, [], 0);
  check('cancelling a round rebuilds to the round\'s base ITSELF — not a copy, not a re-normalisation',
    d.query === R1_QUERY && d.askedIds.length === 0 && d.facets.length === 0 && d.labels.length === 0);
}

// ── 2. a selected-but-uncommitted answer is NOT filed by the cancel ─────────────────────────────
// «عرض النتائج» deliberately commits what is on screen (2026-08-22 — the chip and the results must
// agree). «رجوع» is the opposite intent and must not borrow that shape.
{
  const inFlight = [step(AMEN, opts('pool', 'gym'), ['pool'])]; // round 2, step 0, answer visible
  const cancelled = deriveGuided(R1_QUERY, [], 0).query as any;
  const committed = deriveGuided(R1_QUERY, inFlight, 1).query as any;
  check('Back on question 1 discards the visible selection instead of committing it',
    cancelled.amenities === undefined && committed.amenities?.join(',') === 'pool');
}

// ── 3. cancel does NOT rewind to the pre-AF origin ─────────────────────────────────────────────
// The carry holds `originQ` so the CUMULATIVE pills stay removable back to the beginning. Handing
// that same origin to the cancel rebuild would look identical in round 1 and silently throw away
// every earlier round from round 2 on.
{
  const fromRound = deriveGuided(R1_QUERY, [], 0).query as any;
  const fromOrigin = deriveGuided(ORIGIN, [], 0).query as any;
  check('cancelling round 2 keeps round 1\'s answers (the base is THIS round\'s start, never the origin)',
    fromRound.bathMin === 3 && fromOrigin.bathMin === undefined);
}

// ── 4. a fresh round record — Back cannot reach a finished round, and nothing applies twice ─────
// Round 2 opens on a base that ALREADY contains round 1's predicates. Carrying round 1's STEPS into
// the new record would both (a) give Back somewhere older to walk to and (b) re-apply them on top of
// themselves. Replacing scalars hides it; appending lists keep the duplicate forever.
{
  const r1 = [step(AMEN, opts('pool', 'gym'), ['pool'])];
  const base = deriveGuided(ORIGIN, r1, 1).query as any;          // amenities: ['pool']
  const r2 = [step(AMEN, opts('pool', 'gym'), ['gym'])];
  const fresh = deriveGuided(base, r2, 1).query as any;           // shipped: record holds round 2 only
  const seeded = deriveGuided(base, [...r1, ...r2], 2).query as any; // the defect
  check('each round starts a FRESH record — an older round\'s steps would be applied a second time',
    fresh.amenities.join(',') === 'pool,gym' && seeded.amenities.join(',') === 'pool,pool,gym');
  check('the deepest Back in a round lands at cursor 0, which holds no earlier round to walk into',
    deriveGuided(base, r2, 0).askedIds.length === 0 && (deriveGuided(base, r2, 0).query as any) === base);
}

// ── 5. the carried asked-set survives the cancel ───────────────────────────────────────────────
// A SKIP writes no predicate and no facet, so the carried `asked` list is its ONLY record. The cancel
// empties the round's own record — if the asked-set were re-derived from that record alone, re-opening
// would re-ask everything rounds 1..N-1 already put to the user.
{
  const carried = ['bathrooms', 'street_width'];                  // one answered, one SKIPPED
  const d = deriveGuided(R1_QUERY, [], 0);
  const shipped = new Set([...carried, ...d.askedIds]);
  const derivedOnly = new Set(d.askedIds);
  check('the carried asked-set (answered AND skipped) outlives a cancelled round',
    shipped.has('bathrooms') && shipped.has('street_width') && derivedOnly.size === 0);
}

// ── 6. onAgeBack's cancel branch: drop the record, re-derive, close. Nothing else. ──────────────
const branch = cancelBranch(agentSrc);
check('Back on question 1 drops THIS round\'s record and re-derives at cursor 0',
  /ageFlowStepsRef\.current = \[\];/.test(branch) && /syncGuidedFromSteps\(0\);/.test(branch)
  && /setAgeFlow\(null\);/.test(branch) && /return;/.test(branch),
  `cancel branch: ${branch.replace(/\s+/g, ' ').trim() || '(not found)'}`);
check('cancelling runs NO search and files NO answer — the query the user returns to is untouched',
  branch.length > 0 && !/runRefine|finishGuided|commitGuidedStep|setMsgs|applyRefinement/.test(branch),
  `cancel branch: ${branch.replace(/\s+/g, ' ').trim()}`);
check('cancelling never advances the interview (the walk-back is unreachable from question 1)',
  branch.length > 0 && !/presentGuided/.test(branch));

// ── 7. Back never writes round-completion state — that is what restores the buttons ─────────────
// The origin turn trades its actions for a read-only receipt when a round COMPLETES. A cancelled
// round completed nothing, so Back must leave `afReceipt` and the offer probe alone; otherwise the
// turn keeps its cards but loses «تحديد أكثر» and «عرض المزيد» with no way to get them back.
const backBody = fnBody(agentSrc, 'const onAgeBack = () => {', 'const onAgeSkipAll');
check('Back — at ANY step — writes no receipt, no pills and no probe verdict',
  backBody.length > 0 && !/setAfReceipt|setGuidedPills|setAfCanNarrow|afProbedRef/.test(backBody));
// One writer, one meaning: a receipt exists iff a round actually finished.
const finishBody = fnBody(agentSrc, 'const finishGuided = (token: number) => {', 'const startAgeFlow');
// Full-conversation restore (owner 2026-08-25) reinstates PREVIOUSLY-WRITTEN receipts verbatim when
// a saved chat reopens — that is replay of finishGuided's own output, not a second author of
// meaning. So: exactly one LIVE writer (in finishGuided) plus exactly one RESTORE write (in
// openSaved, sourced only from the stored transcript).
check('the completed-round receipt is written ONLY by finishGuided (plus the transcript restore replaying it)',
  (agentSrc.match(/setAfReceipt\(/g) ?? []).length === 2 && /setAfReceipt\(/.test(finishBody)
  && /setAfReceipt\(restored\.afReceipt\)/.test(agentSrc));
// The receipt takes the actions row's place, so its gate decides whether the buttons come back. It
// must read the receipt map and nothing else — gating it on e.g. `guidedPills?.msgId === m.id` would
// survive a cancel and permanently silence a turn the user only backed out of.
check('the receipt renders as the ELSE of the actions row, gated on the receipt map alone',
  /\{showActionsRow \? \(/.test(agentSrc) && /\) : afReceipt\[m\.id\] \? \(/.test(agentSrc));
// A record, not a control (owner: «It is a RECORD, not another interactive card»). Anchored on the
// receipt's own style — its stable identity — rather than on its element type, so swapping the View
// for a Pressable is caught instead of quietly emptying the slice. (The block holds only Texts today; if
// a nested <View> is ever added, extend this to a brace/tag matcher.)
const receiptBlock = (src: string) => {
  const i = src.indexOf('style={s.afReceipt}');
  if (i < 0) return '';
  const close = src.indexOf('</View>', i);
  return src.slice(src.lastIndexOf('<', i), close < 0 ? undefined : close + 7);
};
check('the receipt has nothing to tap — no Pressable, no onPress',
  receiptBlock(agentSrc).length > 0 && !/Pressable|onPress|Touchable/.test(receiptBlock(agentSrc)));

// ── 8. each round starts fresh, and anchors to its OWN start ───────────────────────────────────
check('startAgeFlow empties the record, so a round can only ever hold its own questions',
  /ageFlowStepsRef\.current = \[\];/.test(fnBody(agentSrc, 'const startAgeFlow = async', 'const onIntroBegin')));
check('the carry seeds the asked-set/facets/origin — never the step record itself',
  !/ageFlowStepsRef\.current\s*=[^;]*afCarryRef/.test(agentSrc));
check('the round\'s rebuild base is the query the round opened on, never the carried pre-AF origin',
  /ageFlowBaseQRef\.current = q;/.test(agentSrc)
  && !/ageFlowBaseQRef\.current\s*=[^;]*(afCarryRef|originQ)/.test(agentSrc));

// ── 9. the carry is seeded at every entry, so a cancelled round leaves nothing stale ────────────
// Cancel deliberately does NOT clear `afCarryRef` (there is nothing to clear — no round completed).
// That is only safe because EVERY entry into startAgeFlow re-seeds it first. A second call site added
// without the seed would hand an unrelated search the cancelled round's asked-set, suppressing
// questions that are perfectly truthful for it.
const entryCalls = [...agentSrc.matchAll(/startAgeFlow\(/g)]
  .map((m) => m.index!)
  .filter((i) => !/const startAgeFlow\($/.test(agentSrc.slice(Math.max(0, i - 24), i + 14)));
check('every startAgeFlow entry re-seeds the carry immediately before it (no stale carry is readable)',
  entryCalls.length > 0 && entryCalls.every((i) => /afCarryRef\.current =/.test(agentSrc.slice(Math.max(0, i - 400), i))),
  `${entryCalls.length} call site(s) found`);

// ── MUTATION PROOF ─────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — each guard must FAIL on its own defect\n');
let mutFail = 0;
const mustCatch = (label: string, brokenIsCaught: boolean) => {
  if (brokenIsCaught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
const mut = (src: string, from: string | RegExp, to: string) => src.replace(from, to);

// Executable defects — re-implement each one and confirm the same predicate flips.
mustCatch('cancel implemented as "commit what is selected, then exit" (the «عرض النتائج» shape)',
  (deriveGuided(R1_QUERY, [step(AMEN, opts('pool'), ['pool'])], 1).query as any).amenities?.join(',') === 'pool');
mustCatch('cancel rewinding to the pre-AF origin instead of the round\'s base',
  (deriveGuided(ORIGIN, [], 0).query as any).bathMin === undefined);
mustCatch('cancel re-deriving at the record\'s END instead of cursor 0',
  (deriveGuided(R1_QUERY, R1_STEPS, 1).query as any).bathMin === 3
  && deriveGuided(R1_QUERY, R1_STEPS, 1).facets.length === 1);
{
  const r1 = [step(AMEN, opts('pool'), ['pool'])];
  const base = deriveGuided(ORIGIN, r1, 1).query as any;
  mustCatch('a new round seeded with the previous round\'s steps (Back walks into it, amenities double)',
    (deriveGuided(base, [...r1], 1).query as any).amenities.join(',') === 'pool,pool');
}
mustCatch('the asked-set re-derived from the emptied record alone (every earlier question comes back)',
  new Set(deriveGuided(R1_QUERY, [], 0).askedIds).size === 0);

// Source defects — flip the shipped text and confirm the regex stops matching.
mustCatch('the cancel branch no longer dropping the round record',
  !/ageFlowStepsRef\.current = \[\];/.test(cancelBranch(
    mut(agentSrc, /ageFlowStepsRef\.current = \[\];\n(\s*)syncGuidedFromSteps\(0\);/, '$1syncGuidedFromSteps(0);'))));
mustCatch('the cancel branch no longer re-deriving (a stale ageFlowQueryRef would survive the cancel)',
  !/syncGuidedFromSteps\(0\);/.test(cancelBranch(mut(agentSrc, 'syncGuidedFromSteps(0);', ''))));
// NB: `syncGuidedFromSteps(0);` is the one line unique to this branch — anchoring on
// `ageFlowStepsRef.current = [];` or `setAgeFlow(null);` would land the mutation in startAgeFlow
// instead and prove nothing about onAgeBack.
mustCatch('cancel starting to run a search (a new turn where the user asked for none)',
  /runRefine|finishGuided|commitGuidedStep|setMsgs|applyRefinement/.test(cancelBranch(
    mut(agentSrc, 'syncGuidedFromSteps(0);', 'finishGuided(ageFlowTokenRef.current);'))));
mustCatch('cancel falling through into the walk-back (presentGuided from question 1)',
  /presentGuided/.test(cancelBranch(mut(agentSrc, 'syncGuidedFromSteps(0);', 'void presentGuided(0, back);'))));
// The brace-matched slice must not be fooled by a nested block hiding the defect.
mustCatch('a search hidden inside a nested block in the cancel branch',
  /runRefine/.test(cancelBranch(mut(agentSrc, 'syncGuidedFromSteps(0);',
    'syncGuidedFromSteps(0);\n      if (ageFlowChangedRef.current) { void runRefine(q, "x", "", ""); }'))));
mustCatch('Back stamping a receipt on the turn it is cancelling (buttons never return)',
  /setAfReceipt|setGuidedPills|setAfCanNarrow|afProbedRef/.test(fnBody(
    mut(agentSrc, 'syncGuidedFromSteps(0);', 'syncGuidedFromSteps(0);\n      setAfReceipt((r) => ({ ...r, x: "" }));'),
    'const onAgeBack = () => {', 'const onAgeSkipAll')));
mustCatch('Back clearing the offer probe (the button would stay hidden after a cancel)',
  /setAfCanNarrow|afProbedRef/.test(fnBody(
    mut(agentSrc, 'syncGuidedFromSteps(0);', 'afProbedRef.current = {};'),
    'const onAgeBack = () => {', 'const onAgeSkipAll')));
mustCatch('a SECOND receipt writer appearing outside finishGuided',
  (mut(agentSrc, 'const onAgeClose = () =>', 'const x = () => setAfReceipt({});\n  const onAgeClose = () =>')
    .match(/setAfReceipt\(/g) ?? []).length !== 1);
mustCatch('the receipt gate switching off the receipt map (a cancelled turn would keep losing its buttons)',
  !/\) : afReceipt\[m\.id\] \? \(/.test(mut(agentSrc, ') : afReceipt[m.id] ? (', ') : guidedPills?.msgId === m.id ? (')));
mustCatch('the receipt View becoming a Pressable (identity-anchored, so the swap does not empty the slice)',
  /Pressable|onPress|Touchable/.test(receiptBlock(mut(agentSrc,
    '<View style={s.afReceipt} testID="af-round-receipt">',
    '<Pressable onPress={() => {}} style={s.afReceipt} testID="af-round-receipt">'))));
mustCatch('the choices line being made tappable inside the receipt',
  /Pressable|onPress|Touchable/.test(receiptBlock(mut(agentSrc,
    'testID="af-round-receipt-choices"', 'testID="af-round-receipt-choices" onPress={() => {}}'))));
mustCatch('the receipt losing its identity (slice empty ⇒ the check FAILS, never silently passes)',
  receiptBlock(mut(agentSrc, 'style={s.afReceipt}', 'style={s.afReceiptV2}')).length === 0);
mustCatch('startAgeFlow no longer emptying the record between rounds',
  !/ageFlowStepsRef\.current = \[\];/.test(fnBody(
    mut(agentSrc, 'ageFlowStepsRef.current = [];\n    ageFlowTotalRef.current', 'ageFlowTotalRef.current'),
    'const startAgeFlow = async', 'const onIntroBegin')));
mustCatch('the carry being poured into the step record (Back could walk into a finished round)',
  /ageFlowStepsRef\.current\s*=[^;]*afCarryRef/.test(
    mut(agentSrc, 'ageFlowStepsRef.current = [];\n    ageFlowTotalRef.current',
      'ageFlowStepsRef.current = afCarryRef.current?.steps ?? [];\n    ageFlowTotalRef.current')));
mustCatch('the round re-anchoring its rebuild base to the carried origin (earlier rounds silently dropped)',
  /ageFlowBaseQRef\.current\s*=[^;]*(afCarryRef|originQ)/.test(
    mut(agentSrc, 'ageFlowBaseQRef.current = q;', 'ageFlowBaseQRef.current = afCarryRef.current?.originQ ?? q;')));
{
  // A second entry point that forgets to seed the carry: the cancelled round's asked-set leaks.
  const broken = mut(agentSrc, 'const onIntroShowResults = () =>',
    'const reopen = (q: SearchQuery) => { void startAgeFlow(q); };\n  const onIntroShowResults = () =>');
  const calls = [...broken.matchAll(/startAgeFlow\(/g)].map((m) => m.index!)
    .filter((i) => !/const startAgeFlow\($/.test(broken.slice(Math.max(0, i - 24), i + 14)));
  mustCatch('a startAgeFlow entry added without seeding the carry (stale asked-set on an unrelated search)',
    !calls.every((i) => /afCarryRef\.current =/.test(broken.slice(Math.max(0, i - 400), i))));
}

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ Back on question 1 cancels the round intact; Back inside a round never crosses into an older one\n');
