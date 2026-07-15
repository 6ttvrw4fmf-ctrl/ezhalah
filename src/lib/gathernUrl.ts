// Pure helper for the Gathern click-through URL. Zero-dependency ON PURPOSE so it is unit-testable
// without the React Native / Expo runtime (mirrors src/lib/arabicText.ts's design).
//
// ── Bug history (2026-07-14 price-fidelity investigation) ──────────────────────────────────────
// openListing.ts used to append `?check_in=<today>&check_out=<today+30d>` to every Gathern
// listing_url before opening it, on the theory that it would land the user on the same discounted
// 30-night "monthly view" the scraper priced (scrapers/gathern/run.py calls the msapi
// search-units endpoint in `calendar_type=monthly` mode — see that file's header comment — and
// stores the resulting discounted 30-night total as `additional_info.monthly_price`).
//
// Live-verified (2026-07-14) that this querystring does NOTHING on gathern.co:
//   • https://gathern.co/view/151391/unit/212141                                   (bare, what we store)
//   • https://gathern.co/view/151391/unit/212141?check_in=2026-07-14&check_out=2026-08-13  (what the
//     old gathernDateUrl() below generated)
//   both render an identical single-night spot-price view (`"nights": 1`, an arbitrary
//   `selected_check_in`/`selected_check_out` one day out, e.g. `"price": 145` / `"price": 160` — NOT
//   the stored ~5,213 SAR monthly figure). The page's own `__NEXT_DATA__.props.pageProps.query`
//   contains only `{"chalet_id":"151391","unit_id":"212141"}` — Gathern's Next.js route never reads
//   `check_in`/`check_out` from the querystring at all. Reproduced on 3 more sampled units
//   (GTH141609/Medina, GTH210566/Mecca, GTH199973/Hail) — same pattern every time.
//
// So the old code wasn't just ineffective, it was actively misleading: it dressed up a dead-end URL
// to *look* targeted at the stored monthly price, guaranteeing every click-through/audit "proves" the
// stored price is wrong by comparing it to an unrelated single-night rate. There is currently no known
// working query parameter (or other unauthenticated URL shape) that lands a fresh page load on
// Gathern's priced monthly view — the real monthly price is only delivered via the msapi
// search-units list endpoint the scraper already calls, not the unit page itself. Until that's
// reverse-engineered (needs a live browser + network trace of the site's calendar widget XHR), the
// honest, non-misleading behavior is to open the bare stored URL unchanged and NOT imply a date-scoped
// view that doesn't exist.
export function gathernClickThroughUrl(url: string): string {
  return url;
}
