# Engineer test tools

Browser and data tools the nightly engineers (docs/ops/*_ENGINEER.md) reuse from run to run, so no
run spends its hour rebuilding them. The ⚡ Scraping Engineer saves its live-site full-chain browser
test here the first time it writes one (for example `full-chain.mjs`), and every later run reuses it.
Tools here are read-only against production: they search the live site and read data through the
public anon key, never write.

- `full-chain.mjs` — ⚡'s one-listing check: search → «عرض المزيد» → click → the URL it opens.
- `customer-journey.mjs` — 🆕's customer proof for a batch of listings, in BOTH surfaces:
  `--mode normal` (filter → results → card → source URL) and `--mode af` (into the Advanced
  Filter, answering questions the listing's own DB values can answer, then verifying on the
  SEARCH REQUEST the page sent — its `p_*` parameters and an anon replay of the exact body —
  never the on-screen count, which updates late). `--sample N` picks last-24h production-served
  listings spread across platforms; `--listings '<json>'` takes explicit
  `{platform, source_table, listing_id}` rows. Pure helpers live in `journey-lib.mjs`
  (`node e2e/engineers/journey-lib.mjs` runs its hermetic self-check).
