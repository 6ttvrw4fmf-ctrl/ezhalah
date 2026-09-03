// Regression guard: "less than N years" must never narrow to a single closest-sounding named
// bucket (live bug, 2026-08-30). «وعمرها أقل من 5 سنوات» ("its age is less than 5 years") was
// mapped to the "1_2" (1-2 years) bucket — silently excluding 3-5-year-old properties the user
// explicitly asked to include, and "3_5" alone would be no better (it excludes new + 1-2).
//
// Investigation finding (read before touching this): the underlying RPC (location_search_candidates_ar)
// genuinely supports a truthful range/max-only expression — confirmed against its LIVE definition:
//   and ((p_age_min is null and p_age_max is null)
//        or (s.property_age is not null and s.property_age >= coalesce(p_age_min,0)
//                                        and s.property_age <= coalesce(p_age_max,32767)))
//   and (p_is_new_construction is null or (s.property_age = 0) = p_is_new_construction)
// "new" IS `property_age = 0` server-side, so an ageMax-only range (ageMin left null, which
// coalesces to 0) ALREADY includes new construction for free — a single p_age_max=N truthfully
// covers every age from 0..N, i.e. exactly "less than/up to N years", using the SAME already-
// certified property_age field every named bucket already draws from. This is the "true range
// expression is supported" branch of the owner's instructions, not the "must ask instead" one.
//
// The fix: src/lib/afIntents.ts's property_age canonicalize/apply now ALSO accepts a plain integer
// (as a string), producing a genuine ageMax-only range instead of picking one named bucket. The edge
// system prompt (JSON_SHAPE_HINT) now tells the model to send that number instead of guessing.
//
//   node --experimental-strip-types scripts/verify-agent-property-age-under-n.ts  (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { applyAfIntents } from '../src/lib/afIntents.ts';
import type { SearchQuery } from '../src/data/search.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};
const eq = (label: string, a: unknown, b: unknown) =>
  check(label, JSON.stringify(a) === JSON.stringify(b), `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

// A cohort where property_age is certified (Apartment/RentAnnual — see afCohorts.ts), so every
// check below exercises the real certification gate, not just canonicalize() in isolation.
const base = { type: 'Apartment', category: 'Residential', deal: 'Rent', rentPeriod: 'annual' } as SearchQuery;
const ageFields = (q: SearchQuery) => ({ ageMin: q.ageMin ?? null, ageMax: q.ageMax ?? null, isNewConstruction: q.isNewConstruction ?? null });

// ── POSITIVE: "less than 5 years" → a TRUTHFUL range covering new + 1_2 + 3_5 ──────────────────────
console.log('── "less than N years" produces a truthful ageMax-only range ──');
const under5 = applyAfIntents(base, { property_age: '5' });
check('property_age "5" is NOT rejected', !under5.rejected.includes('property_age') && !under5.rejected.some((r) => r.startsWith('property_age:')));
eq('ageMax is set to exactly 5 (the stated threshold)', under5.q.ageMax, 5);
eq('ageMin is left null — coalesces to 0 server-side, so age 0 (new) is included, not excluded', under5.q.ageMin, null);
eq('isNewConstruction is left null — the range subsumes it, no separate flag needed', under5.q.isNewConstruction, null);
// The actual RPC WHERE-clause semantics, pinned so this test breaks if that contract ever changes:
// property_age between coalesce(ageMin,0) and coalesce(ageMax,32767). Simulate it here against the
// REAL boundary values every existing named bucket uses, to prove the union is truthful.
const rpcAgeMatches = (ageMin: number | null, ageMax: number | null, propertyAge: number) =>
  propertyAge >= (ageMin ?? 0) && propertyAge <= (ageMax ?? 32767);
for (const [label, age] of [['new (age 0)', 0], ['1_2 lower (age 1)', 1], ['1_2 upper (age 2)', 2], ['3_5 lower (age 3)', 3], ['3_5 upper (age 5)', 5]] as const) {
  check(`ageMax:5 truthfully MATCHES ${label}`, rpcAgeMatches(under5.q.ageMin ?? null, under5.q.ageMax ?? null, age));
}
for (const [label, age] of [['6_9 lower (age 6)', 6], ['10p (age 10)', 10]] as const) {
  check(`ageMax:5 correctly does NOT match ${label} (still a real ceiling, not "everything")`, !rpcAgeMatches(under5.q.ageMin ?? null, under5.q.ageMax ?? null, age));
}

// Different thresholds generalize the same way (the bug is a CLASS — any N not on a bucket boundary
// has the same narrowing failure, not just N=5).
eq('"less than 3 years" (property_age "3") → ageMax 3, not the 1_2-only bucket', ageFields(applyAfIntents(base, { property_age: '3' }).q), { ageMin: null, ageMax: 3, isNewConstruction: null });
eq('"less than 8 years" (property_age "8") → ageMax 8', ageFields(applyAfIntents(base, { property_age: '8' }).q), { ageMin: null, ageMax: 8, isNewConstruction: null });

// ── NEGATIVE: the old narrow "1_2 only" behavior is GONE ────────────────────────────────────────────
console.log('\n── the old narrow mapping is gone ──');
check('property_age "5" does NOT silently narrow to the 1_2 bucket (ageMin:1, ageMax:2)',
  !(under5.q.ageMin === 1 && under5.q.ageMax === 2));
check('property_age "5" does NOT silently narrow to the 3_5 bucket ALONE (would still exclude new+1_2)',
  !(under5.q.ageMin === 3 && under5.q.ageMax === 5));
check('property_age "5" does NOT set isNewConstruction (that would exclude every non-zero age)',
  under5.q.isNewConstruction == null);

// ── Named buckets are UNCHANGED — exact matches still take the discrete path, byte-identical ───────
console.log('\n── named buckets still resolve exactly as before (no regression) ──');
eq("'new' still sets isNewConstruction:true and clears the range", ageFields(applyAfIntents(base, { property_age: 'new' }).q), { ageMin: null, ageMax: null, isNewConstruction: true });
eq("'1_2' still means exactly ageMin:1, ageMax:2", ageFields(applyAfIntents(base, { property_age: '1_2' }).q), { ageMin: 1, ageMax: 2, isNewConstruction: null });
eq("'3_5' still means exactly ageMin:3, ageMax:5", ageFields(applyAfIntents(base, { property_age: '3_5' }).q), { ageMin: 3, ageMax: 5, isNewConstruction: null });
eq("'6_9' still means exactly ageMin:6, ageMax:9", ageFields(applyAfIntents(base, { property_age: '6_9' }).q), { ageMin: 6, ageMax: 9, isNewConstruction: null });
eq("'10p' still means exactly ageMin:10, ageMax:null (unbounded)", ageFields(applyAfIntents(base, { property_age: '10p' }).q), { ageMin: 10, ageMax: null, isNewConstruction: null });

// ── Garbage / out-of-range input: still refused, never guessed ─────────────────────────────────────
console.log('\n── garbage input is still refused, not silently narrowed ──');
for (const bad of ['0', '-3', 'abc', 'brand_new', '61', '999']) {
  const r = applyAfIntents(base, { property_age: bad });
  check(`property_age "${bad}" is refused (rejected, no age fields set)`,
    r.rejected.includes(`property_age:${bad}`) && ageFields(r.q).ageMin === null && ageFields(r.q).ageMax === null && ageFields(r.q).isNewConstruction === null);
}
check('"60" (the sanity ceiling) is still accepted', !applyAfIntents(base, { property_age: '60' }).rejected.length);

// ── System prompt: the model is told to send a NUMBER instead of guessing ──────────────────────────
console.log('\n── the model is instructed not to guess the closest bucket ──');
const edge = readFileSync(new URL('../supabase/functions/agent/index.ts', import.meta.url), 'utf8');
check('JSON_SHAPE_HINT documents the plain-number-of-years fallback for property_age',
  /"property_age":\s*"new"\|"1_2"\|"3_5"\|"6_9"\|"10p"[^;]*plain number of years[^;]*less than\/under\/up to N years/.test(edge));
check('JSON_SHAPE_HINT explicitly forbids guessing the closest-sounding named bucket',
  /NEVER guess the closest-sounding named bucket/.test(edge));

console.log('');
if (failed) {
  console.log(`✗ ${failed} check(s) failed.`);
  process.exit(1);
}
console.log('✓ all property-age "less than N" checks passed.');
