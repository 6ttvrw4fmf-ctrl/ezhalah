// THE SURFACE JUDGE MUST BE ABLE TO SAY NO — offline mutation proof of scripts/lib/afSurfaceJudge.ts.
//
// scripts/verify-af-full-surface-differential.ts sweeps every certified Advanced Filter option
// against production and hands the evidence to judgeOption() & friends. That sweep is slow and
// lives in a scheduled workflow; THIS file runs in `npm test` on every PR and proves the judgement
// itself: for each comparison the owner's definition requires, a correct case passes and every
// single-fault corruption of it FAILS. A judge that has never been seen to reject anything is the
// vacuous-pass shape this repo has been burned by (nine dark detectors, AGENTS.md).
//
//   node --experimental-strip-types scripts/verify-af-surface-judge.ts

import {
  judgeOption, judgeUnion, judgeIntersection, judgeZero, judgeUnknownCaption, boundaryReport,
  rowSatisfies, strictCols, optionWouldRender, type Pred, type OptionEvidence,
} from './lib/afSurfaceJudge.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const mustReject = (label: string, v: { ok: boolean; reasons?: string[] }, needle?: string) =>
  check(`MUTATION — ${label}`, !v.ok && (!needle || (v.reasons ?? []).some((r) => r.includes(needle))),
    v.ok ? 'judge said OK' : `reasons: ${(v.reasons ?? []).join(' | ')}`);

console.log('\nAF surface judge — offline mutation proof\n');

// ── a correct case ────────────────────────────────────────────────────────────────────────────────
const ids = ['a:1', 'a:2', 'b:3'];
const pred: Pred = { kind: 'gte', col: 'bathrooms', n: 2 };
const rows = [{ id: 'a:1', bathrooms: 2 }, { id: 'a:2', bathrooms: 3 }, { id: 'b:3', bathrooms: 5 }];
const good: OptionEvidence = { label: 'bath ≥ 2', chip: 3, applied: 3, rpcTotal: 3, rpcIds: ids, oracleIds: ids, oracleRows: rows, pred };
{
  const v = judgeOption(good);
  check('a fully agreeing case is OK with no missing/extra/dupes', v.ok && !v.missing.length && !v.extra.length && v.dupes === 0, v.reasons.join(' | '));
  check('a predicate-only case (no chip, no applied) still judges the set', judgeOption({ ...good, chip: null, applied: null }).ok);
}

// ── single-fault corruptions, each must turn the verdict red ─────────────────────────────────────
mustReject('chip off by one (Gym — 4 when the truth is 3)', judgeOption({ ...good, chip: 4 }), 'chip 4 ≠ DB truth 3');
mustReject('chip under by one (Gym — 2 when the truth is 3)', judgeOption({ ...good, chip: 2 }), 'chip 2 ≠');
mustReject('af_eligible_count disagreeing with the oracle', judgeOption({ ...good, applied: 5 }), 'af_eligible_count 5 ≠');
mustReject('search total_count disagreeing with the oracle', judgeOption({ ...good, rpcTotal: 4 }), 'total_count 4 ≠');
mustReject('a listing without the amenity returned (EXTRA)', judgeOption({ ...good, rpcIds: [...ids, 'z:9'], rpcTotal: 4, oracleRows: rows }), 'EXTRA 1');
mustReject('an eligible listing dropped (MISSING)', judgeOption({ ...good, rpcIds: ids.slice(0, 2), rpcTotal: 2 }), 'MISSING 1');
mustReject('a listing served twice (DUPLICATE)', judgeOption({ ...good, rpcIds: [...ids, 'a:1'] }), 'DUPLICATES 1');
mustReject('paged set shorter than total_count (a page silently lost)', judgeOption({ ...good, rpcIds: ids.slice(0, 2), oracleIds: ids.slice(0, 2), chip: 2, applied: 2 }), 'total_count says 3');
mustReject('a NULL in the strict column reaching the set (UNKNOWN treated as a value)',
  judgeOption({ ...good, oracleRows: [{ id: 'a:1', bathrooms: 2 }, { id: 'a:2', bathrooms: null }, { id: 'b:3', bathrooms: 5 }] }), 'NULL in a strict column');
mustReject('a row failing the predicate on its own column (bathrooms 1 under «≥ 2»)',
  judgeOption({ ...good, oracleRows: [{ id: 'a:1', bathrooms: 1 }, { id: 'a:2', bathrooms: 3 }, { id: 'b:3', bathrooms: 5 }] }), 'fail the predicate');
mustReject('a row check that covered fewer rows than the set it judged', judgeOption({ ...good, oracleRows: rows.slice(0, 2) }), 'row check covered 2 of 3');

// ── rowSatisfies: UNKNOWN is never yes and never no, boundaries are inclusive ────────────────────
{
  check('NULL fails every leaf kind (true/false/gte/between/eq/in)', [
    { kind: 'true', col: 'c' }, { kind: 'false', col: 'c' }, { kind: 'gte', col: 'c', n: 0 },
    { kind: 'between', col: 'c', lo: 0, hi: 9 }, { kind: 'eq', col: 'c', v: null }, { kind: 'in', col: 'c', vs: [null] },
  ].every((p) => !rowSatisfies({ c: null }, p as Pred) && !rowSatisfies({}, p as Pred)));
  check('«false» requires an explicit false — never NULL', rowSatisfies({ c: false }, { kind: 'false', col: 'c' }) && !rowSatisfies({ c: null }, { kind: 'false', col: 'c' }));
  check('≥ N includes N exactly (boundary inclusive)', rowSatisfies({ c: 2 }, { kind: 'gte', col: 'c', n: 2 }) && !rowSatisfies({ c: 1 }, { kind: 'gte', col: 'c', n: 2 }));
  check('between lo..hi includes both ends and excludes both neighbours',
    rowSatisfies({ c: 1 }, { kind: 'between', col: 'c', lo: 1, hi: 2 }) && rowSatisfies({ c: 2 }, { kind: 'between', col: 'c', lo: 1, hi: 2 })
    && !rowSatisfies({ c: 0 }, { kind: 'between', col: 'c', lo: 1, hi: 2 }) && !rowSatisfies({ c: 3 }, { kind: 'between', col: 'c', lo: 1, hi: 2 }));
  check('«new construction» is age = 0 exactly, not "age ≤ 0 or unknown"', rowSatisfies({ property_age: 0 }, { kind: 'eq', col: 'property_age', v: 0 }) && !rowSatisfies({ property_age: null }, { kind: 'eq', col: 'property_age', v: 0 }));
  check('AND fails if any conjunct fails', !rowSatisfies({ a: true, b: false }, { kind: 'and', preds: [{ kind: 'true', col: 'a' }, { kind: 'true', col: 'b' }] })
    && rowSatisfies({ a: true, b: true }, { kind: 'and', preds: [{ kind: 'true', col: 'a' }, { kind: 'true', col: 'b' }] }));
  check('IN matches any listed spelling (a «…ي» direction variant)', rowSatisfies({ d: 'شمال شرقي' }, { kind: 'in', col: 'd', vs: ['شمال شرق', 'شمال شرقي'] }));
  check('strictCols lists every column an AND reads, once', JSON.stringify(strictCols({ kind: 'and', preds: [{ kind: 'true', col: 'a' }, { kind: 'true', col: 'a' }, { kind: 'gte', col: 'b', n: 1 }] })) === '["a","b"]');
}

// ── OR / AND set arithmetic (R7.2.2) ─────────────────────────────────────────────────────────────
{
  const A = ['1', '2', '3'], B = ['3', '4'];
  check('union: exactly A ∪ B passes', judgeUnion(A, B, ['1', '2', '3', '4']).ok);
  check('MUTATION — union missing a member of B fails', !judgeUnion(A, B, ['1', '2', '3']).ok);
  check('MUTATION — union carrying a stranger fails', !judgeUnion(A, B, ['1', '2', '3', '4', '9']).ok);
  check('MUTATION — an OR implemented as AND (only the overlap) fails the union judge', !judgeUnion(A, B, ['3']).ok);
  check('intersection: exactly A ∩ B passes', judgeIntersection(A, B, ['3']).ok);
  check('MUTATION — an AND implemented as OR (the whole union) fails the intersection judge', !judgeIntersection(A, B, ['1', '2', '3', '4']).ok);
  check('MUTATION — intersection dropping the only member fails', !judgeIntersection(A, B, []).ok);
}

// ── zero-result options, unknown caption, boundaries, render gate ────────────────────────────────
{
  check('a zero option is zero everywhere', judgeZero(0, 0, 0, []));
  check('MUTATION — chip 0 but the click returns rows fails', !judgeZero(0, 2, 2, ['x', 'y']));
  check('MUTATION — chip 0 but DB truth is 1 fails', !judgeZero(0, 0, 1, []));
  check('unknown caption equal to the oracle NULL count passes; absent caption passes', judgeUnknownCaption(382, 382) && judgeUnknownCaption(null, 382));
  check('MUTATION — a fabricated unknown caption fails', !judgeUnknownCaption(0, 382) && !judgeUnknownCaption(381, 382));
  const b = boundaryReport([{ c: 2 }, { c: 4 }], { kind: 'gte', col: 'c', n: 2 });
  check('boundary report: a row ON the threshold marks the boundary exercised, no violations', b.exercised && b.violations === 0);
  check('boundary report: no row on the threshold is reported as NOT exercised (never counted as a pass)', !boundaryReport([{ c: 4 }], { kind: 'gte', col: 'c', n: 2 }).exercised);
  check('MUTATION — a row below the threshold is a violation', boundaryReport([{ c: 1 }], { kind: 'gte', col: 'c', n: 2 }).violations === 1);
  check('render gate: below the 5-listing floor never renders', !optionWouldRender(4, 1000) && optionWouldRender(5, 1000));
  check('render gate: an option that removes < 10% and leaves > 25 does not render (I: 47 of 50)', !optionWouldRender(47, 50) && optionWouldRender(45, 50));
  check('render gate: an option that reaches ≤ 25 renders regardless of the 10% rule (H: 26 → 25)', optionWouldRender(25, 26));
}

console.log(failures ? `\n✗ ${failures} check(s) FAILED\n` : '\n✓ the AF surface judge rejects every single-fault corruption of a correct case\n');
process.exit(failures ? 1 : 0);
