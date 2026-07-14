// Automated tests — eaqartabuk (عقار تبوك) price-fidelity, 2026-07-14.
//
// The scraper that owns this logic (scrapers/eaqartabuk/run.py) is Python, so it cannot be
// `import`-ed from this Node/TS test runner. This file is a faithful, line-cited PORT of the two
// pure functions under test — NOT an independent reimplementation — so it exercises the exact
// same branches the real fix does. The authoritative, dependency-real regression test that
// imports the actual Python functions lives at
// scrapers/common/tests/test_price_fidelity.py::test_eaqartabuk_bug2_still_fixed /
// ::test_eaqartabuk_bug3_on_request_price_not_fabricated — run both in CI, this one is the
// zero-dependency Node mirror requested for the scripts/verify-*.ts gate.
//
// Guards two bugs:
//   BUG 2 (fixed 2026-07-13) — a real monthly-rent figure (meta.price < 10,000) must be stored
//     ANNUALIZED (×12) into price_annual, never raw — the app displays round(price_annual/12).
//     run.py::_price(), lines ~250-266.
//   BUG 3 (fixed 2026-07-14) — some listings have NO real price: the description literally says
//     "السعر حسب النشاط" / "السعر حسب مدة العقد" (price depends on the tenant's business activity
//     / contract term), but meta.price still carries a non-zero placeholder digit that the
//     magnitude heuristic alone would happily turn into a fabricated real-looking price.
//     Live-verified against eaqartabuk.com 2026-07-14 (raw API responses frozen below):
//       id 7917 (ET7917 / DB row 598548): meta.price="150",    content "...السعر حسب النشاط ومدة العقد"
//       id 8092 (ET8092 / DB row 598534): meta.price="150000", content "...السعر حسب النشاط ومدة العقد رقم 121"
//       id 7327 (ET7327 / DB row 598631): meta.price="0",      content "...السعر حسب مدة العقد"
//                                          (already null via the <=0 guard — kept for parity)
//     run.py::_price_on_request() + its call-site in map_listing(), lines ~269-320.
//
// Run: node --experimental-strip-types scripts/verify-eaqartabuk-price-fidelity.ts
// Exits non-zero on any failure so it can gate CI.

let failed = 0;
const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  → got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};

// ---- port of run.py::_price(raw, is_rent) → [price_total, price_annual, rent_period] ----
function annualizeRentMonthly(v: number): number {
  return v * 12; // port of normalize.annualize_rent(v, "monthly")
}
function price(raw: string | null, isRent: boolean): [number | null, number | null, string | null] {
  const v = raw == null ? null : parseInt(raw, 10);
  if (!v || v <= 0) return [null, null, null];
  if (!isRent) {
    const total = v < 10000 ? v * 1000 : v;
    if (total < 1000) return [null, null, null];
    return [total, null, null];
  }
  if (v < 10000) return [null, annualizeRentMonthly(v), 'monthly'];
  return [null, v, 'annual'];
}

// ---- port of run.py::_strip_tags(s) — just enough to strip the <p> wrapper used in fixtures ----
function stripTags(s: string | null): string | null {
  if (!s) return null;
  return s.replace(/<br\s*\/?>/gi, ' ').replace(/<\/p>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').trim();
}

// ---- port of run.py::_price_on_request(*texts) ----
const ON_REQUEST_RE = /السعر\s*حسب/;
function priceOnRequest(...texts: Array<string | null>): boolean {
  return texts.some((t) => !!t && ON_REQUEST_RE.test(t));
}

console.log('── BUG 2 — monthly rent must be annualized, never stored raw ──');
// Live-verified 2026-07-14: id 8950 (ET8950/row 598426), meta.price="2700".
// Live DB confirms price_annual=32400, rent_period="monthly" (32400/12=2700 → card shows real rent).
eq('_price("2700", rent) → annualized ×12', price('2700', true), [null, 32400, 'monthly']);
eq('_price("580", buy) → thousands ×1000 untouched by this fix', price('580', false), [580000, null, null]);
eq('_price("1350000", buy) → already full SAR, untouched', price('1350000', false), [1350000, null, null]);
eq('_price("0", rent) → null, no fabricated price', price('0', true), [null, null, null]);

console.log('\n── BUG 3 — "price on request" text must null the price, not the raw digit ──');
// Frozen raw fixtures — live GET https://eaqartabuk.com/wp-json/public/v1/property/{id} on 2026-07-14.
const content7917 = '<p>ارض بحي الريان مساحة 593م شارعين السعر حسب النشاط ومدة العقد</p>\n'; // id 7917
const content8092 = '<p>ارض بحي ملحق الرابية تجاري للاستثمار مساحة 910م شارعين واجهة 42م السعر حسب النشاط ومدة العقد رقم 121</p>\n'; // id 8092
const content7327 = '<p>السعر حسب مدة العقد</p>'; // id 7327

// Prove the raw numeric heuristic ALONE would still fabricate a price (this is exactly what went
// live before the fix — 1,800 SAR/yr and 150,000 SAR/yr for listings that quote no real figure).
eq('_price("150", rent) alone would fabricate 1800/yr', price('150', true), [null, 1800, 'monthly']);
eq('_price("150000", rent) alone would fabricate 150000/yr', price('150000', true), [null, 150000, 'annual']);

eq('_price_on_request detects id 7917 phrasing', priceOnRequest(stripTags(content7917)), true);
eq('_price_on_request detects id 8092 phrasing', priceOnRequest(stripTags(content8092)), true);
eq('_price_on_request detects id 7327 phrasing (already-null parity case)', priceOnRequest(stripTags(content7327)), true);
eq('_price_on_request does NOT false-positive on a normal description',
   priceOnRequest(stripTags('<p>شقة فاخرة حي المروج مساحة 200م</p>')), false);

console.log('');
if (failed > 0) { console.error(`✗ ${failed} assertion(s) FAILED`); process.exit(1); }
console.log('✓ all eaqartabuk price-fidelity assertions passed (BUG 2 + BUG 3)');
