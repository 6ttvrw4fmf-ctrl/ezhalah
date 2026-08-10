// EVERY VISIBLE FILTER CONTROL MUST ACTUALLY FILTER.
//
// Owner, 2026-08-10:
//   "A question must never appear if selecting it does nothing.
//    Every visible Advanced Filter control must map to a real backend predicate,
//    real count path, and real results path."
//
// THE DEFECT THIS LOCKS OUT. The guided interview offered «Pool» and «Gym» for months. Neither had a
// slug in AMENITY_TOKEN, so picking one was echoed back in the user's own chat bubble and then applied
// NO constraint whatsoever — the search silently broadened. The 2026-08-10 source audit closed the
// question: only sanadak publishes them and it publishes an explicit NO on 184/184 listings, so
// `pool is true` matches zero rows fleet-wide. Both were removed.
//
// A control is only legitimate when all THREE paths exist:
//   1. results  — the slug is in location_search_candidates_ar's p_amenities vocabulary
//   2. count    — apartment_guided_counts_ar returns the cnt_* the chip's count() reads
//   3. UI       — the control is actually rendered
// This checks 1 and 2 statically for every control declared in 3, and check 5 enforces the inverse —
// a field the registry marks backend-only must never acquire a chip.
//
// Checks 1-4 are hermetic source parsing. Check 5 reads the LIVE field registry through the anon key
// (a copy of the contract inside the test would drift from the contract). Wired into `npm test`.
//   node --experimental-strip-types scripts/verify-ui-controls-have-predicates.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nEvery visible filter control must map to a real predicate + count path\n');

const advanced  = read('src/data/advancedFilters.ts');
const remote    = read('src/data/remote.ts');
const interview = read('src/app/interview.tsx');

// ── the authoritative slug vocabulary, copied from location_search_candidates_ar ────────────────
// An UNKNOWN token matches nothing by design, so a guessed slug silently zeroes every result.
const RESULTS_SLUGS = new Set([
  'elevator', 'parking', 'kitchen', 'ac', 'maid_room', 'driver_room',
  'private_entrance', 'furnished', 'rnpl', 'rent_now_pay_later',
]);

// Only the AMENITY-bearing questions carry p_amenities slugs. The age question's keys
// ('new', '1_2', …) are age buckets applied via p_age_min/p_age_max, and the bathroom rungs are
// numeric and applied via p_bath_min — neither is an amenity, so scope the slug rule to the
// questions that actually call addAmenities().
const amenityBlocks = [...advanced.matchAll(/const (RNPL_QUESTION|AMENITIES_QUESTION)[\s\S]*?apply: addAmenities/g)]
  .map((m) => m[0]).join('\n');
check('found the amenity-bearing question blocks', amenityBlocks.length > 0);

// ── 1. every amenity chip's key is a real results slug ──────────────────────────────────────────
const chipKeys = [...amenityBlocks.matchAll(/\{\s*key:\s*'([a-z_]+)'\s*,\s*labelKey:/g)].map((m) => m[1]);
check('amenity questions declare the expected chips', chipKeys.length >= 6, `found ${chipKeys.length}: ${chipKeys.join(', ')}`);
for (const key of chipKeys) {
  check(`chip '${key}' is a real p_amenities slug`, RESULTS_SLUGS.has(key),
    `not in location_search_candidates_ar's vocabulary — an unknown token matches nothing by design, so the chip would silently zero every result`);
}

// ── 2. every chip's count() reads a field its counts type actually declares ─────────────────────
// Chips read GuidedCounts; the age question reads AgeOptionCounts. Accept either, but the field
// must exist somewhere — otherwise the chip renders a live count of `undefined`.
const typeSlice = (name: string) => {
  const i = remote.indexOf(`export type ${name}`);
  return i < 0 ? '' : remote.slice(i, i + 1200);
};
const declaredCountFields = typeSlice('GuidedCounts') + typeSlice('AgeOptionCounts');
const countFields = [...advanced.matchAll(/count:\s*\(c\)\s*=>\s*c\.(cnt_[a-z0-9_]+)/g)].map((m) => m[1]);
for (const f of new Set(countFields)) {
  check(`count field '${f}' is declared on a counts type`, new RegExp(`\\b${f}\\s*:`).test(declaredCountFields),
    'the chip would render a live count the RPC never returns (undefined -> NaN)');
}

// ── 3. every amenity the INTERVIEW offers maps to a slug ─────────────────────────────────────────
// This is the exact Pool/Gym failure: an option offered, echoed back, and mapped to nothing.
const tokenBlock = interview.slice(interview.indexOf('const AMENITY_TOKEN'), interview.indexOf('const AMENITY_TOKEN') + 500);
const mapped = new Set([...tokenBlock.matchAll(/'?([A-Za-z ]+?)'?\s*:\s*'([a-z_]+)'/g)].map((m) => m[1].trim()));
const mappedSlugs = [...tokenBlock.matchAll(/:\s*'([a-z_]+)'/g)].map((m) => m[1]);

// Generous span: the option list sits behind a long explanatory comment block.
const amenityOptsMatch = interview.match(/title:\s*'Must-have amenities\?'[\s\S]{0,3000}?opts:\s*\[([^\]]+)\]/);
check('found the interview amenity option list', !!amenityOptsMatch);

if (amenityOptsMatch) {
  const offered = [...amenityOptsMatch[1].matchAll(/'([^']+)'|"([^"]+)"/g)]
    .map((m) => (m[1] ?? m[2]).trim())
    .filter((o) => o && !/doesn't matter/i.test(o));
  check('interview offers at least one amenity', offered.length > 0);
  for (const opt of offered) {
    check(`interview option '${opt}' maps to an amenity slug`, mapped.has(opt),
      `offered to the user but absent from AMENITY_TOKEN — picking it would apply NO constraint and silently broaden the search (this is the Pool/Gym bug)`);
  }
  // and the slugs it maps to must themselves be real
  for (const slug of mappedSlugs) {
    check(`interview slug '${slug}' is a real p_amenities slug`, RESULTS_SLUGS.has(slug),
      'an unknown token matches nothing by design and would zero every result');
  }
}

// ── 4. controls we deliberately retired must not creep back ──────────────────────────────────────
for (const dead of ['Pool', 'Gym']) {
  const offeredAgain = amenityOptsMatch ? new RegExp(`'${dead}'`).test(amenityOptsMatch[1]) : false;
  check(`'${dead}' is not offered as an amenity option`, !offeredAgain,
    `only sanadak publishes it and publishes an explicit NO on 184/184 listings, so the chip can only ever return zero results. ` +
    `The data is still stored (search_listings_ar.${dead.toLowerCase()}); re-expose it only when a platform publishes a yes.`);
}

// ── 5. THE INVERSE RULE: backend-only fields must STAY backend-only ─────────────────────────────
// Checks 1-4 stop a visible control existing without a backend. This stops the opposite: a field the
// registry marks ui_exposed=false quietly acquiring a chip. Those flags are not stylistic — they
// record that a field is free prose (deed_location_text), has zero positive inventory anywhere
// (pool/gym/garden), or is too thin to help (floor at 17%). Exposing one anyway puts a question in
// front of users that cannot answer them.
//
// Read from the LIVE registry rather than a copy here, so the check can never drift from the
// contract it is enforcing. Network-dependent, unlike checks 1-4 — if the registry is unreachable
// this FAILS rather than skipping, because a barrier that silently opts out is not a barrier.
const REG_URL = process.env.EZHALAH_SUPABASE_URL ?? 'https://aannarbkwcymrotzwdbo.supabase.co';
const regKey = (await import('./lib/public-supabase.ts')).resolvePublicSupabase(process.env).key;
try {
  const registry: Array<{ canonical_key: string; ui_exposed: boolean; not_exposed_reason: string | null }> =
    await fetch(`${REG_URL}/rest/v1/af_field_registry?select=canonical_key,ui_exposed,not_exposed_reason`,
      { headers: { apikey: regKey, Authorization: `Bearer ${regKey}` } }).then((r) => r.json());

  check('field registry is readable and populated', Array.isArray(registry) && registry.length > 0,
    `got ${JSON.stringify(registry).slice(0, 200)}`);

  if (Array.isArray(registry) && registry.length) {
    const backendOnly = registry.filter((f) => !f.ui_exposed).map((f) => f.canonical_key);
    const exposedChips = new Set(chipKeys);
    const leaked = backendOnly.filter((k) => exposedChips.has(k));
    check(`backend-only fields are not exposed as chips (${backendOnly.length} backend-only)`,
      leaked.length === 0,
      `ui_exposed=false in the registry but rendered as a chip: ${leaked.join(', ')}`);

    // deed_location_text specifically: prose must never become a predicate anywhere.
    const deedInUi = /deed_location_text/.test(advanced) || /deed_location_text/.test(interview);
    check('deed_location_text never reaches the filter UI (it is prose, not a predicate)', !deedInUi,
      'a free-text title-deed description cannot be a filter, and must never be parsed into '
      + 'district/street/coordinates — those are separate facts with their own sources');

    const noReason = registry.filter((f) => !f.ui_exposed && !f.not_exposed_reason).map((f) => f.canonical_key);
    check('every backend-only field records WHY it is hidden', noReason.length === 0, noReason.join(', '));
  }
} catch (e) {
  check('field registry reachable for the backend-only check', false, String(e));
}

console.log(failures === 0
  ? '\n✓ every visible control maps to a real predicate, and backend-only fields stay backend-only\n'
  : `\n✗ ${failures} check(s) FAILED — a control would be silently ignored, or a hidden field leaked into the UI\n`);
process.exit(failures === 0 ? 0 : 1);
