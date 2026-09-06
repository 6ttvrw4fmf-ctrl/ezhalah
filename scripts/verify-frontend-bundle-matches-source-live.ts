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
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// WHY IT WAS REWRITTEN (ops_incident #41, routine #9 red team, found 2026-09-05, repaired 2026-09-06)
//
// The first version built its needle by EXECUTING `certifiedAmenityKeys(Apartment, RentAnnual)` and
// then searching the bundle for that 16-token result joined as one comma-separated literal. **That
// literal cannot exist in any artifact, ever.** certifiedAmenityKeys() declares a 15-element literal
// and appends the 16th at RUNTIME (`if (cohortAllows(q,'furnished')) base.push('furnished')`), so the
// joined return value is not a literal in the SOURCE FILE either — no build could satisfy it.
//
// Consequence, measured: the workflow failed 15/15 scheduled runs from 2026-09-02 onward, across
// four production deploys, while production was CORRECT the whole time. Verified by a third,
// independent reading of the served bundle entry-dcecc3c9af74754697a3c663cd8bee8d.js, which carries
// `['kitchen','parking',…,'separate_water_meter']` verbatim, `['car_entrance','sanitation']`
// verbatim, and `u.push('furnished')`. So the ONE detector for "the served bundle is behind main"
// could no longer distinguish a real drift from its own defect — a standing red, which is the same
// wound as a dark detector.
//
// THE REPAIR, and why it is a STRENGTHENING and not a loosening:
//   • the needles are now the LITERAL ARRAYS the module declares, imported BY IDENTITY from
//     src/lib/afCohorts.ts — never re-typed here, so they cannot drift from the declaration;
//   • the villa leg was `every token appears SOMEWHERE in the bundle`, which several unrelated
//     occurrences would satisfy; it is now the same exact ORDERED-SEQUENCE assertion as the base
//     list — strictly stronger than what it replaces;
//   • the runtime-appended tokens are asserted as the runtime APPEND (`push('<token>')`), not as a
//     bare substring — 'furnished' appears in the bundle for a dozen unrelated reasons;
//   • and a MODEL check pins this file's model of the function against the function itself: if
//     certifiedAmenityKeys() ever grows another runtime append, the model assertion fails LOUDLY and
//     names the new token, instead of the bundle assertion quietly checking the wrong needle again.
//     That is the specific guard against a repeat of #41.
//
// Every predicate below is a PURE function over (bundle text, tokens) and is mutation-proven at the
// bottom against synthetic bundles — including against the #41 needle itself, which must be
// rejected. A barrier nobody has watched fail is a comment that runs.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
// SCOPE (deliberately): this covers the amenity certification — the exact shape that actually
// drifted. Doing the equivalent for the much larger COHORT_QUESTIONS nested object against a
// *minified* bundle would mean pattern-matching a big object literal through an unspecified
// minifier layout — fragile by construction, and worse than not having the check (a false sense of
// coverage). The robust way to cover COHORT_QUESTIONS the same way — e.g. baking a build-time
// content hash of it into the bundle that this script recomputes from source and compares — is
// flagged as a follow-up, not implemented here.
//
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//     scripts/verify-frontend-bundle-matches-source-live.ts

import { RESIDENTIAL_AMENITY_BASE, VILLA_ONLY_AMENITIES, certifiedAmenityKeys } from '../src/lib/afCohorts.ts';
import type { SearchQuery } from '../src/data/search.ts';

const PROD = 'https://ezhalah-app.vercel.app';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

async function fetchText(url: string, label: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': 'ezhalah-live-parity-check' } });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} fetching ${url}`);
  return res.text();
}

// ── THE PURE PREDICATES (mutation-proven at the bottom) ─────────────────────────────────────────
//
// A minifier keeps string literals verbatim (quote char aside) and never reorders array elements —
// so a SOURCE-DECLARED array, joined as it appears in a compiled array literal, is a reliable
// literal substring regardless of surrounding minification. Both quote styles are checked since the
// bundler in use today happens to emit single quotes. This is only ever applied to an array that IS
// a literal in the source; applying it to a value the code BUILDS is exactly defect #41.
export function containsOrderedArray(bundle: string, tokens: readonly string[]): boolean {
  if (!tokens.length) return false;   // an empty needle would match everything — never a pass
  return bundle.includes(tokens.map((t) => `'${t}'`).join(','))
      || bundle.includes(tokens.map((t) => `"${t}"`).join(','));
}

// A token the function APPENDS at runtime is never part of a literal array, so its presence must be
// read from the append itself. `.push` is a property of Array and cannot be renamed by a minifier;
// the argument is a string literal and survives verbatim. A bare `bundle.includes('furnished')`
// would be satisfied by any of the dozen unrelated occurrences of that word.
export function containsRuntimeAppend(bundle: string, token: string): boolean {
  return bundle.includes(`push('${token}')`) || bundle.includes(`push("${token}")`);
}

const Q = (over: Record<string, unknown>) =>
  ({ deal: 'Rent', location: '', category: 'Residential', type: null, detail: null,
     priceInput: '', priceBand: null, rentPeriod: 'annual', ...over }) as unknown as SearchQuery;

// ── 1. THE MODEL CHECK — this file's understanding of the function, against the function ─────────
// If certifiedAmenityKeys() ever appends another token at runtime, or reorders its literals, THIS
// fails and names the difference — so the bundle needles below can never again be silently wrong.
const RUNTIME_APPENDED = ['furnished'] as const;
const apartment = certifiedAmenityKeys(Q({ type: 'Apartment' }));
const villa = certifiedAmenityKeys(Q({ type: 'Villa' }));
const modelApartment = [...RESIDENTIAL_AMENITY_BASE, ...RUNTIME_APPENDED];
const modelVilla = [...RESIDENTIAL_AMENITY_BASE, ...VILLA_ONLY_AMENITIES, ...RUNTIME_APPENDED];

check('MODEL: certifiedAmenityKeys(Apartment,RentAnnual) == RESIDENTIAL_AMENITY_BASE + the runtime appends',
  JSON.stringify(apartment) === JSON.stringify(modelApartment),
  `function=${JSON.stringify(apartment)}\n      model=${JSON.stringify(modelApartment)}\n      ` +
  'afCohorts.ts changed shape: update RUNTIME_APPENDED (and the bundle needles) in this file.');
check('MODEL: certifiedAmenityKeys(Villa,RentAnnual) == base + VILLA_ONLY_AMENITIES + the runtime appends',
  JSON.stringify(villa) === JSON.stringify(modelVilla),
  `function=${JSON.stringify(villa)}\n      model=${JSON.stringify(modelVilla)}`);
check(`sanity floor: the certified base is still ${RESIDENTIAL_AMENITY_BASE.length} tokens (>= 15)`,
  RESIDENTIAL_AMENITY_BASE.length >= 15, `got ${JSON.stringify(RESIDENTIAL_AMENITY_BASE)} — afCohorts.ts may have shrunk`);
check(`sanity floor: villa still adds ${VILLA_ONLY_AMENITIES.length} villa-only token(s) (>= 2)`,
  VILLA_ONLY_AMENITIES.length >= 2, `got ${JSON.stringify(VILLA_ONLY_AMENITIES)}`);

// ── 2. THE LIVE BUNDLE ───────────────────────────────────────────────────────────────────────────
const html = await fetchText(`${PROD}/`, 'production HTML');
const entryMatch = /\/_expo\/static\/js\/web\/entry-[a-f0-9]+\.js/.exec(html);
check('production HTML references an Expo web entry bundle', !!entryMatch,
  'the app may have moved off Expo web — update this script\'s bundle discovery');
if (!entryMatch) {
  console.error(`\n✗ ${++failed} check(s) FAILED — cannot locate the live bundle to check`);
  process.exit(1);
}
console.log(`Live entry bundle: ${entryMatch[0]}`);
const bundle = await fetchText(`${PROD}${entryMatch[0]}`, 'live entry bundle');
check('fetched a non-trivial bundle (sanity floor, catches an empty/error response passing as 200)',
  bundle.length > 500_000, `got ${bundle.length} bytes`);

const BEHIND = 'main has moved ahead of what users are actually served. Run deploy-frontend.yml.';
check('the LIVE bundle carries current main\'s certified amenity base, in order',
  containsOrderedArray(bundle, RESIDENTIAL_AMENITY_BASE),
  `main certifies ${JSON.stringify(RESIDENTIAL_AMENITY_BASE)} but the deployed bundle does not contain this ` +
  `exact ordered sequence — ${BEHIND}`);
check('the LIVE bundle carries the villa-only amenity tokens, in order',
  containsOrderedArray(bundle, VILLA_ONLY_AMENITIES),
  `main certifies villa-only ${JSON.stringify(VILLA_ONLY_AMENITIES)} as an ordered pair, absent from the ` +
  `deployed bundle — ${BEHIND}`);
for (const token of RUNTIME_APPENDED) {
  check(`the LIVE bundle still appends the runtime-only token '${token}'`,
    containsRuntimeAppend(bundle, token),
    `certifiedAmenityKeys() appends '${token}' at runtime and the deployed bundle has no such append — ${BEHIND}`);
}

// ── MUTATION PROOFS — the predicates are watched to FAIL, then to pass ───────────────────────────
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
console.log('\nMutation proofs\n');

const asLiteral = (t: readonly string[]) => `[${t.map((x) => `'${x}'`).join(',')}]`;
// A synthetic "served bundle" built the way the real bundler builds one: the literals verbatim, the
// runtime append as an append. Everything below mutates THIS and watches the predicate.
const fakeBundle = `var q=${asLiteral(RESIDENTIAL_AMENITY_BASE)},w=${asLiteral(VILLA_ONLY_AMENITIES)};`
  + `function c(t){var u=[...q];t&&u.push(...w);d(t,'furnished')&&u.push('furnished');return u}`;

mustCatch('a bundle BEHIND main — the newest certified token missing from the base sequence (the real drift class)',
  !containsOrderedArray(fakeBundle.replace(`,'separate_water_meter'`, ''), RESIDENTIAL_AMENITY_BASE));
mustCatch('a bundle whose base list is REORDERED (same tokens, different certification)',
  !containsOrderedArray(fakeBundle, [...RESIDENTIAL_AMENITY_BASE].reverse()));
mustCatch('a bundle missing the villa-only pair — the leg that used to pass on scattered occurrences',
  !containsOrderedArray(fakeBundle.replace(asLiteral(VILLA_ONLY_AMENITIES), `['sanitation']`), VILLA_ONLY_AMENITIES));
mustCatch('villa tokens present but NOT as the ordered pair (what the old per-token leg accepted)',
  !containsOrderedArray(`var a=['car_entrance','x'],b=['y','sanitation'];`, VILLA_ONLY_AMENITIES));
mustCatch('a bundle that dropped the runtime append while the word still occurs elsewhere',
  !containsRuntimeAppend(`var k='furnished';label('furnished');`, 'furnished'));
mustCatch('DEFECT #41 ITSELF: the executed RETURN value is not a literal any build can contain',
  !containsOrderedArray(fakeBundle, certifiedAmenityKeys(Q({ type: 'Apartment' }))));
mustCatch('an empty needle is never a pass (a vacuous match would green a bundle with nothing in it)',
  !containsOrderedArray(fakeBundle, []));
// …and the other direction: a predicate that is vacuously red proves as little as one that is
// vacuously green. The REAL, correctly-built bundle shape must still PASS all three.
mustCatch('…while a correctly-built bundle still PASSES all three assertions (none is vacuously red)',
  containsOrderedArray(fakeBundle, RESIDENTIAL_AMENITY_BASE)
  && containsOrderedArray(fakeBundle, VILLA_ONLY_AMENITIES)
  && RUNTIME_APPENDED.every((t) => containsRuntimeAppend(fakeBundle, t)));

const ok = failed === 0 && mutFail === 0;
console.log(ok
  ? '\n✓ the live bundle\'s compiled amenity certification matches current main — no undeployed drift'
  : `\n✗ ${failed} check(s) failed, ${mutFail} mutation(s) survived`);
process.exit(ok ? 0 : 1);
