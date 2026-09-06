// LIVE FRONTEND BUNDLE ⟷ SOURCE PARITY (item 8a, owner bug-class fix 2026-09-01).
//
// THE INCIDENT THIS GUARDS: commit 618875e certified 8 new amenity tokens (gym, pool, garden,
// balcony, laundry_room, optical_fibers, separate_electricity_meter, separate_water_meter) in
// src/lib/afCohorts.ts and merged to main — but `deploy-frontend.yml` is workflow_dispatch-only (a
// DELIBERATE choice, see that file's header: "must never become auto-deploy-on-push"), so a merge to
// main does NOT ship anything on its own. The certification sat live in git, invisible to every real
// user, until someone remembered to run the deploy. No existing check caught this: `npm test` proves
// the SOURCE is correct; `deploy-frontend.yml`'s own post-deploy checks (alias assertion, hydration
// gate) only run DURING a deploy and by construction pass once one happens — neither one notices that
// NO deploy happened for days despite main moving.
//
// WHAT THIS CHECKS, and why it must run on a SCHEDULE, not just post-deploy: this compares the LIVE
// production bundle (whatever users are being served right now, deployed or not) against a FRESH
// checkout of current main, independent of whether a deploy is in flight. It uses the real
// src/lib/afCohorts.ts — both by EXECUTING certifiedAmenityKeys() and by LIFTING the actual source
// array literals — never a hand-copied duplicate of the token list.
//
// ── 2026-09-06, routine #10: THIS BARRIER WAS RED FOR AN IMPOSSIBLE REASON, AND HAD TO BE ─────────
// The first version asked whether the LIVE bundle contained
//   certifiedAmenityKeys(Apartment, RentAnnual)   ← 16 tokens
// comma-joined as ONE literal sequence. That sequence cannot exist in ANY artifact, ever, including
// a bundle built from the same commit: afCohorts.ts emits a 15-element literal array
// (RESIDENTIAL_AMENITY_BASE) and appends the 16th at RUNTIME —
//   `if (cohortAllows(q, 'furnished')) base.push('furnished');`   (src/lib/afCohorts.ts)
// — so `certifiedAmenityKeys()`'s RETURN VALUE is never a compiled literal. The needle is absent from
// the SOURCE FILE too; no deploy could ever satisfy it. Verified against the served bundle on
// 2026-09-06 (entry-b6a5fac1bee322bd959025f1f87bf03a.js): it carries the identical logic, minified —
//   `const y=['kitchen',…,'separate_water_meter'],_=['car_entrance','sanitation'];
//    function h(t){…const u=[...y];return n.every(t=>'Villa'===t)&&u.push(..._),
//    c(t,'furnished')&&u.push('furnished'),u}`
// Production was CORRECT and current the entire time. The check had failed 12/12 scheduled runs since
// 2026-09-02, across three production deploys, so the ONE detector for «the served bundle is behind
// main» could no longer distinguish real drift from its own defect — a standing red is a detector
// that has stopped detecting (ops_incident #41).
//
// THE REPAIR — assert what a compiler can actually emit, without weakening what is caught:
//   * a token list the source emits as an ARRAY LITERAL must ship as that exact contiguous, ordered
//     literal run (this is the incident: 8 tokens appended to RESIDENTIAL_AMENITY_BASE and not
//     deployed makes the joined run absent → RED);
//   * a token the source APPENDS AT RUNTIME must ship as its actual `.push('token')` CALL SITE — a
//     strictly stronger assertion than "the word appears somewhere", which would be satisfied by any
//     of the 24 unrelated `'furnished'` occurrences already in the bundle;
//   * and every certified token must appear as a string literal at all.
// The literal groups are LIFTED out of the real afCohorts.ts (scripts/lib/liftSymbols.ts), so a token
// added to either array is picked up automatically and there is no second copy to drift.
//
// SCOPE (deliberately): this covers the amenity token vocabulary — the exact shape that drifted.
// Doing the equivalent for the much larger COHORT_QUESTIONS nested object against a *minified*
// bundle would mean pattern-matching a big object literal through an unspecified minifier layout —
// fragile by construction, and worse than not having the check (a false sense of coverage). The
// robust way to cover COHORT_QUESTIONS the same way — e.g. baking a build-time content hash of it
// into the bundle that this script recomputes from source and compares — is flagged as a follow-up,
// not implemented here.
//
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//     scripts/verify-frontend-bundle-matches-source-live.ts

import { join } from 'node:path';
import { certifiedAmenityKeys } from '../src/lib/afCohorts.ts';
import type { SearchQuery } from '../src/data/search.ts';
import { liftSymbols } from './lib/liftSymbols.ts';

const PROD = 'https://ezhalah-app.vercel.app';
const root = join(import.meta.dirname, '..');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};

// ── THE PREDICATE, PURE ───────────────────────────────────────────────────────────────────────────
// Pure and exported so the mutation proofs below can hand it a bundle that is genuinely behind the
// source, instead of describing what would happen if one were.

export type LiteralGroup = { name: string; tokens: readonly string[] };
export type Cohort = { label: string; certified: readonly string[] };

/** A minifier keeps string literals verbatim (quote char aside) and never reorders array elements. */
const orderedRun = (bundle: string, tokens: readonly string[]): boolean =>
  bundle.includes(tokens.map((t) => `'${t}'`).join(',')) ||
  bundle.includes(tokens.map((t) => `"${t}"`).join(','));

const quotedAnywhere = (bundle: string, t: string): boolean =>
  bundle.includes(`'${t}'`) || bundle.includes(`"${t}"`);

// How far past a literal group's own occurrence the compiled body that spreads it may sit. Measured
// on the served bundle 2026-09-06: `const y=[…],_=[…];function h(t){…u.push('furnished'),u}` puts the
// append 391 characters after the base run begins. Generous enough to absorb ordinary layout churn;
// a genuine reflow past it goes RED and gets read, which is the correct direction for a detector.
const APPEND_REGION = 2_000;

/**
 * The compiled form of `base.push('furnished')` survives minification as `<v>.push('furnished')` —
 * but ONLY inside the function that builds the list. Searching the whole bundle for that call is not
 * enough, and this is not hypothetical: the served bundle carries TWO `.push('furnished')` sites, the
 * certification's own and afCertify's rejection path ~4,700 characters earlier. Deleting the
 * certification's append from the real artifact left the whole-bundle form reporting no problems —
 * the exact leg that exists to be stronger than "the word appears somewhere" was satisfied by an
 * unrelated call. So the search is scoped to a window anchored at a lifted literal group's own
 * occurrence in the bundle: the append the source writes is adjacent to the array it appends to.
 */
const pushedAtRuntime = (bundle: string, t: string, groups: readonly LiteralGroup[]): boolean => {
  const calls = [`.push('${t}')`, `.push("${t}")`];
  for (const g of groups) {
    if (g.tokens.length === 0) continue;
    for (const q of ["'", '"']) {
      const run = g.tokens.map((x) => `${q}${x}${q}`).join(',');
      for (let i = bundle.indexOf(run); i >= 0; i = bundle.indexOf(run, i + 1)) {
        const region = bundle.slice(i, i + APPEND_REGION);
        if (calls.some((c) => region.includes(c))) return true;
      }
    }
  }
  return false;
};

/**
 * Every way the live bundle can be BEHIND the source it was built from, as a list of problems.
 * Empty ⇒ the served bundle carries current main's amenity certification.
 */
export function bundleParityProblems(
  bundle: string, groups: readonly LiteralGroup[], cohorts: readonly Cohort[],
): string[] {
  const problems: string[] = [];

  // Vacuity floor FIRST: a lift that produced nothing, or a cohort that certified nothing, must read
  // as a broken check — never as "no problems found". An empty input passing is exactly how a guard
  // stops guarding.
  if (groups.length === 0) problems.push('no source literal groups were lifted — the check has nothing to compare');
  for (const g of groups) {
    if (g.tokens.length < 2) problems.push(`literal group ${g.name} lifted ${g.tokens.length} token(s) — the lift is broken, not the bundle`);
  }
  if (cohorts.length === 0) problems.push('no cohorts were evaluated');
  for (const c of cohorts) {
    if (c.certified.length === 0) problems.push(`cohort ${c.label} certified nothing — certifiedAmenityKeys() is not returning a vocabulary`);
  }

  const inSomeGroup = new Set(groups.flatMap((g) => [...g.tokens]));

  // 1. The incident's exact shape: a source ARRAY LITERAL must ship as that contiguous ordered run.
  //    Appending a token to RESIDENTIAL_AMENITY_BASE and not deploying makes this absent.
  for (const g of groups) {
    if (g.tokens.length >= 2 && !orderedRun(bundle, g.tokens)) {
      problems.push(
        `${g.name} = ${JSON.stringify(g.tokens)} is not present in the live bundle as one ordered literal run — ` +
        'main has moved ahead of what users are served (or the array was reordered). Run deploy-frontend.yml.');
    }
  }

  // 2. Tokens the source appends at RUNTIME are not in any literal run by construction; assert the
  //    CALL SITE shipped, which a stray unrelated occurrence of the same word cannot satisfy.
  for (const c of cohorts) {
    for (const t of c.certified) {
      if (inSomeGroup.has(t)) continue;
      if (!pushedAtRuntime(bundle, t, groups)) {
        problems.push(
          `${c.label} certifies '${t}', which no lifted literal group contains, and the live bundle has no ` +
          `.push('${t}') call site beside any lifted literal group — the runtime append that adds it has not shipped.`);
      }
    }
    // 3. Belt and braces: every certified token exists in the bundle as a string at all.
    for (const t of c.certified) {
      if (!quotedAnywhere(bundle, t)) problems.push(`${c.label} certifies '${t}', absent from the live bundle entirely`);
    }
  }
  return problems;
}

// ── MUTATION PROOFS — run BEFORE the network, so a repaired predicate is proven even on a bad day ──
const BASE = ['kitchen', 'parking', 'elevator', 'ac'] as const;
const VILLA = ['car_entrance', 'sanitation'] as const;
const HEALTHY_BUNDLE =
  `const y=['kitchen','parking','elevator','ac'],_=['car_entrance','sanitation'];` +
  `function h(t){const u=[...y];return n.every(t=>'Villa'===t)&&u.push(..._),c(t,'furnished')&&u.push('furnished'),u}`;
const G = [{ name: 'RESIDENTIAL_AMENITY_BASE', tokens: BASE }, { name: 'VILLA_ONLY_AMENITIES', tokens: VILLA }];
const COH = [{ label: 'Apartment/RentAnnual', certified: [...BASE, 'furnished'] }];

mustCatch('THE INCIDENT: a token certified in main but never deployed (the literal run is now absent)',
  bundleParityProblems(HEALTHY_BUNDLE,
    [{ name: 'RESIDENTIAL_AMENITY_BASE', tokens: [...BASE, 'sauna'] }, G[1]],
    [{ label: 'Apartment/RentAnnual', certified: [...BASE, 'sauna', 'furnished'] }]).length > 0);

mustCatch('a source array REORDERED in main but not deployed (same tokens, different order)',
  bundleParityProblems(HEALTHY_BUNDLE,
    [{ name: 'RESIDENTIAL_AMENITY_BASE', tokens: ['parking', 'kitchen', 'elevator', 'ac'] }, G[1]], COH).length > 0);

mustCatch('a RUNTIME-APPENDED token whose push() call site never shipped, even though the word appears elsewhere',
  bundleParityProblems(
    `const y=['kitchen','parking','elevator','ac'],_=['car_entrance','sanitation'];const label='furnished';`,
    G, COH).length > 0);

mustCatch('the villa-only literal group failing to ship',
  bundleParityProblems(`const y=['kitchen','parking','elevator','ac'];c(t,'furnished')&&u.push('furnished')`,
    G, COH).length > 0);

mustCatch('a lift that produced NOTHING reading as «no problems found» (an empty check is a broken check)',
  bundleParityProblems(HEALTHY_BUNDLE, [], COH).length > 0);

mustCatch('a lift that produced a truncated one-token group',
  bundleParityProblems(HEALTHY_BUNDLE, [{ name: 'RESIDENTIAL_AMENITY_BASE', tokens: ['kitchen'] }], COH).length > 0);

mustCatch('certifiedAmenityKeys() returning an empty vocabulary',
  bundleParityProblems(HEALTHY_BUNDLE, G, [{ label: 'Apartment/RentAnnual', certified: [] }]).length > 0);

mustCatch('…while a bundle that genuinely MATCHES its source is NOT flagged (the predicate is not vacuously red)',
  bundleParityProblems(HEALTHY_BUNDLE, G, COH).length === 0);

// ── THE LIVE CHECK ────────────────────────────────────────────────────────────────────────────────
async function fetchText(url: string, label: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': 'ezhalah-live-parity-check' } });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} fetching ${url}`);
  return res.text();
}

const Q = (over: Record<string, unknown>) =>
  ({ deal: 'Rent', location: '', category: 'Residential', type: null, detail: null,
     priceInput: '', priceBand: null, rentPeriod: 'annual', ...over }) as unknown as SearchQuery;

// The REAL source arrays, lifted — not a copy pinned into this file. A token added to either one is
// picked up on the next run with no edit here.
const lifted = await liftSymbols(
  join(root, 'src', 'lib', 'afCohorts.ts'),
  [{ header: 'const RESIDENTIAL_AMENITY_BASE = [', endsWith: /^\] as const;$/ },
   { header: 'const VILLA_ONLY_AMENITIES = [', endsWith: /\] as const;$/ }],
  ['RESIDENTIAL_AMENITY_BASE', 'VILLA_ONLY_AMENITIES'],
);
const groups: LiteralGroup[] = [
  { name: 'RESIDENTIAL_AMENITY_BASE', tokens: lifted.RESIDENTIAL_AMENITY_BASE as string[] },
  { name: 'VILLA_ONLY_AMENITIES', tokens: lifted.VILLA_ONLY_AMENITIES as string[] },
];

const html = await fetchText(`${PROD}/`, 'production HTML');
const entryMatch = /\/_expo\/static\/js\/web\/entry-[a-f0-9]+\.js/.exec(html);
check('production HTML references an Expo web entry bundle', !!entryMatch, 'the app may have moved off Expo web — update this script\'s bundle discovery');
if (!entryMatch) {
  console.error(`\n✗ ${++failed} check(s) FAILED — cannot locate the live bundle to check`);
  process.exit(1);
}
console.log(`Live entry bundle: ${entryMatch[0]}`);
const bundle = await fetchText(`${PROD}${entryMatch[0]}`, 'live entry bundle');
check('fetched a non-trivial bundle (sanity floor, catches an empty/error response passing as 200)',
  bundle.length > 500_000, `got ${bundle.length} bytes`);

const apartmentAnnual = certifiedAmenityKeys(Q({ type: 'Apartment' }));
const villaAnnual = certifiedAmenityKeys(Q({ type: 'Villa' }));
check(`current main's certifiedAmenityKeys(Apartment, RentAnnual) returns ${apartmentAnnual.length} tokens (sanity floor)`,
  apartmentAnnual.length >= 15, `got ${JSON.stringify(apartmentAnnual)} — afCohorts.ts may have shrunk`);
check(`current main's certifiedAmenityKeys(Villa, RentAnnual) adds ${villaAnnual.filter((t) => !apartmentAnnual.includes(t)).length} villa-only token(s) (sanity floor)`,
  villaAnnual.filter((t) => !apartmentAnnual.includes(t)).length >= 2,
  `got ${JSON.stringify(villaAnnual.filter((t) => !apartmentAnnual.includes(t)))}`);

const cohorts: Cohort[] = [
  { label: 'Apartment/RentAnnual', certified: apartmentAnnual },
  { label: 'Villa/RentAnnual', certified: villaAnnual },
];
const problems = bundleParityProblems(bundle, groups, cohorts);
check('the LIVE bundle carries current main\'s amenity certification (literal runs shipped, runtime appends shipped)',
  problems.length === 0, problems.join('\n      '));

// The strongest proof available, and it uses PRODUCTION's own bytes rather than a fixture this file
// invented: take the real served bundle and the real lifted arrays, add ONE token to main's side, and
// assert the predicate turns red. If this ever passes silently, the check above means nothing.
// Stated DIFFERENTIALLY, so it is a real proof whether or not production is currently in drift: the
// probe token must ADD problems that the real arrays do not produce. An "is clean" control here would
// print «BLIND» on a run where production has genuinely drifted — output that says the opposite of
// what is true, which is its own defect class (ops_incident #42). Non-vacuity is already proven above
// against a synthetic healthy bundle.
mustCatch('THE INCIDENT, against the REAL served bundle: one extra token certified in main and not deployed',
  bundleParityProblems(bundle,
    [{ name: groups[0].name, tokens: [...groups[0].tokens, 'undeployed_probe_token'] }, groups[1]],
    cohorts.map((c) => ({ ...c, certified: [...c.certified, 'undeployed_probe_token'] })),
  ).length > problems.length);

// The RUNTIME-APPEND leg, proven the same way — on production's own bytes, not a fixture. The
// synthetic proof above removes every trace of the word, which is the easy half; the half that
// matters is a bundle where the certification's append is gone and an UNRELATED `.push('furnished')`
// (afCertify's rejection path) is still there. That is what a bundle predating the furnished chip
// actually looks like, and the whole-bundle form of this leg reported no problems against it.
// Differential, for the same reason as the proof above.
const appendedTokens = [...new Set(cohorts.flatMap((c) => c.certified))]
  .filter((t) => !groups.some((g) => g.tokens.includes(t)));
for (const t of appendedTokens) {
  const call = `.push('${t}')`;
  const groupAt = bundle.indexOf(groups[0].tokens.map((x) => `'${x}'`).join(','));
  const at = groupAt < 0 ? -1 : bundle.indexOf(call, groupAt);
  const stripped = at < 0 ? bundle : bundle.slice(0, at) + '.pushNOTHING()' + bundle.slice(at + call.length);
  mustCatch(
    `the certification's own .push('${t}') missing from the REAL served bundle while ${Math.max(0, stripped.split(call).length - 1)} unrelated ${call} site(s) remain`,
    at >= 0 && bundleParityProblems(stripped, groups, cohorts).length > problems.length);
}

if (mutFail > 0) console.error(`\n✗ ${mutFail} mutation proof(s) FAILED — this barrier can no longer be trusted`);
console.log(failed === 0 && mutFail === 0
  ? '\n✓ the live bundle\'s compiled amenity certification matches current main — no undeployed drift'
  : `\n✗ ${failed + mutFail} check(s) FAILED — the live frontend has drifted behind main. See .github/workflows/deploy-frontend.yml to ship it.`);
process.exit(failed === 0 && mutFail === 0 ? 0 : 1);
