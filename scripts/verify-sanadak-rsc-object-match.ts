// Regression test — Sanadak price/row-fidelity bug (2026-07-14 audit).
//
// Root cause: scrapers/sanadak/run.py's old `_extract_obj(body)` did
// `body.find('"advertisementNumber"')` — the FIRST byte-offset occurrence of that key anywhere in
// the whole RSC flight response — with no check that the recovered object actually belonged to the
// URL being fetched. Every Sanadak /property-details/... response embeds the primary listing PLUS
// ~5 "similar listings" carousel cards that each carry their own "advertisementNumber", and their
// arrival order in the flight text is a per-request race (proved live: re-fetching the same URL on
// different days flipped which chunk streamed first). So "first match" silently returned a random
// sibling recommendation's full object instead of the page's own listing — corrupting EVERY stored
// field (price, area, bedrooms, property_type, city, district), not just price.
//
// Fix (same branch, scrapers/sanadak/run.py): `_url_ad_number(url)` derives the page's own
// advertisementNumber from Sanadak's own URL convention (every URL ends in "-{advertisementNumber}"),
// then `_extract_obj_for_url(body, url)` scans EVERY candidate object in the flight stream via
// `_iter_candidate_objs` and returns the one whose own advertisementNumber matches the URL's — or
// None (fail loud, caller skips the row) if nothing matches, instead of silently keeping garbage.
//
// This test drives the REAL Python extraction functions (not a JS reimplementation) against three
// frozen RSC-flight fixtures that reproduce the exact bug shape confirmed in the live audit:
//   1. carousel-first  (the exact manifestation of the reported bug: SN7100232821/id=585647 shape)
//   2. primary-first    (the SAME root cause, opposite manifestation — proves the old code's
//                        "success" on some requests was accidental, not evidence of correctness)
//   3. no-match/anomaly (proves the fix fails LOUD — returns None — instead of silently keeping a
//                        mismatched object when the URL's ad number appears nowhere in the stream)
//
//   node --experimental-strip-types scripts/verify-sanadak-rsc-object-match.ts   (wired into `npm test`)

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};
const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected;
  if (!ok) console.error(`  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  check(label, ok);
};

// A fake "similar listings" card object — same shape (advertisementNumber + a few core fields) as
// the real ones the live audit pulled out of sanadak.sa's flight stream.
const cardObj = (ad: number, price: number) =>
  `{"advertisementNumber":${ad},"price":${price},"propertyTypeText":"أرض","district":"حي وهمي","nested":{"lotSize":100,"ok":true}}`;

const REAL_AD = 3333333333;
const REAL_PRICE = 1450000;
const realObj = (extra = '') =>
  `{"advertisementNumber":${REAL_AD},"price":${REAL_PRICE},"propertyTypeText":"فيلا","city":"الخبر","district":"التحلية","nested":{"lotSize":250,"numberBedrooms":9}${extra}}`;

const URL_FOR_REAL_AD = `https://sanadak.sa/property-details/فيلا-للبيع-في-الخبر-التحلية-9-غرفة-${REAL_AD}`;

// Fixture 1: carousel-first — the exact bug shape (id=585647 / SN7100232821 live case): two
// "similar listings" cards stream BEFORE the primary object, each with their own advertisementNumber.
const FIXTURE_CAROUSEL_FIRST =
  `1:["$","div",null,{"children":["$","SimilarListings",null,{"cards":[` +
  cardObj(1111111111, 500000) + ',' + cardObj(2222222222, 600000) +
  `]}}]}\n` +
  `12:` + realObj(',"extraNoise":"hydration-chunk-a"') + `\n` +
  `13:` + realObj(',"extraNoise":"hydration-chunk-b (repeated, as in real Sanadak responses)"') + `\n`;

// Fixture 2: primary-first — same root cause, opposite manifestation (confirms the race, not a
// fixed layout): the real object happens to stream before the carousel this time.
const FIXTURE_PRIMARY_FIRST =
  `12:` + realObj() + `\n` +
  `1:["$","div",null,{"children":["$","SimilarListings",null,{"cards":[` +
  cardObj(1111111111, 500000) + ',' + cardObj(2222222222, 600000) +
  `]}}]}\n`;

// Fixture 3: anomaly — the URL's own ad number appears NOWHERE in the stream (e.g. the primary
// detail chunk failed to resolve at all this request). The fix must return None; the old code
// would have silently returned an unrelated carousel card's data.
const FIXTURE_NO_MATCH =
  `1:["$","div",null,{"children":["$","SimilarListings",null,{"cards":[` +
  cardObj(1111111111, 500000) + ',' + cardObj(2222222222, 600000) +
  `]}}]}\n`;

function runPython(body: string, url: string): { url_ad: string | null; old_ad: number | null; new_ad: number | null } {
  const py = `
import sys, json, types
sys.path.insert(0, ${JSON.stringify(REPO_ROOT)})
_stub = types.ModuleType("supabase")
_stub.Client = object
_stub.create_client = lambda *a, **k: None
sys.modules["supabase"] = _stub
from scrapers.sanadak.run import _extract_obj, _extract_obj_for_url, _url_ad_number

data = json.load(sys.stdin)
body, url = data["body"], data["url"]
old = _extract_obj(body)
new = _extract_obj_for_url(body, url)
print(json.dumps({
    "url_ad": _url_ad_number(url),
    "old_ad": (old.get("advertisementNumber") if old else None),
    "new_ad": (new.get("advertisementNumber") if new else None),
}))
`.trim();
  const stdout = execFileSync('python3', ['-c', py], { input: JSON.stringify({ body, url }), encoding: 'utf8' });
  return JSON.parse(stdout.trim().split('\n').pop()!);
}

// ── Fixture 1: carousel-first (the reported bug's exact shape) ─────────────────────────────────
{
  const r = runPython(FIXTURE_CAROUSEL_FIRST, URL_FOR_REAL_AD);
  eq('fixture 1 (carousel-first): url_ad_number derived correctly', r.url_ad, String(REAL_AD));
  eq(
    'fixture 1: OLD buggy _extract_obj reproduces the bug — grabs the FIRST carousel card (wrong ad)',
    r.old_ad,
    1111111111,
  );
  eq(
    'fixture 1: NEW _extract_obj_for_url picks the object matching the URL (correct ad)',
    r.new_ad,
    REAL_AD,
  );
  check('fixture 1: fix actually changes the outcome vs. the buggy path (not a no-op)', r.old_ad !== r.new_ad);
}

// ── Fixture 2: primary-first (same root cause, opposite manifestation — proves it's a race) ────
{
  const r = runPython(FIXTURE_PRIMARY_FIRST, URL_FOR_REAL_AD);
  eq('fixture 2 (primary-first): OLD happens to be right here (race went the other way)', r.old_ad, REAL_AD);
  eq('fixture 2: NEW is right regardless of stream order', r.new_ad, REAL_AD);
}

// ── Fixture 3: anomaly — URL ad number absent from every candidate ──────────────────────────────
{
  const r = runPython(FIXTURE_NO_MATCH, URL_FOR_REAL_AD);
  eq(
    'fixture 3 (no match in stream): OLD buggy path silently returns a WRONG object instead of failing',
    r.old_ad,
    1111111111,
  );
  eq(
    'fixture 3: NEW fails LOUD (returns None) instead of silently keeping a mismatched object',
    r.new_ad,
    null,
  );
}

// ── _url_ad_number: URL-shape edge cases ────────────────────────────────────────────────────────
{
  const r1 = runPython(FIXTURE_PRIMARY_FIRST, `${URL_FOR_REAL_AD}/`);
  eq('_url_ad_number tolerates a trailing slash', r1.url_ad, String(REAL_AD));
}

console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} sanadak-rsc-object-match assertion(s) FAILED`);
  process.exit(1);
}
console.log('✓ all sanadak-rsc-object-match assertions passed');
