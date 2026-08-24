-- Data Integrity run (2026-08-24): evidence table for source liveness probes taken when
-- adjudicating a stale-path inactivation.
--
-- WHY THIS EXISTS. mark_stale_listings_inactive() inactivates on `last_seen_at` age alone, with no
-- source re-check. `last_seen_at` only tracks whether a listing appeared in the platform's DISCOVERY
-- index (for aqarcity: sitemap.xml). When that index is INCOMPLETE — it publishes a window, not the
-- full live catalogue — a listing that is still served by the source falls out of `last_seen_at`
-- and is inactivated 7 days later. That is the exact shape DATA_INTEGRITY_ENGINEER.md §4 forbids:
-- "missing from one crawl ≠ inactive", "old/stale ≠ inactive".
--
-- Measured 2026-08-24: aqarcity sitemap.xml publishes 1,799 property ids (26858..30637). Of the 252
-- aqarcity rows the stale path inactivated in 30 days, 0 appear in that sitemap — yet 252/252
-- answered LIVE on a direct fetch, most with ids INSIDE the sitemap's own id range. abeea: 9/9 live.
--
-- Oracles used, each control-validated in the same run (never a bare HTTP 200):
--   aqarcity — bogus id /property/999999 returns HTTP 200 with <title>Page Not Found</title> at
--              42,080 bytes (a soft-404). A live listing returns a per-listing title CONTAINING ITS
--              OWN id, e.g. "…حي النوارية - 28196 | عقار ستي" at ~82KB. Verdict LIVE requires the
--              stored id to appear in <title>; "Page Not Found" is GONE. This matches the oracle
--              platform_retention_policy already declares for aqarcity.
--   abeea    — bogus slug returns a hard HTTP 404. Live listings return 200 with a property-specific
--              <title> at >50KB.
-- Counter-example kept deliberately: mustqr and aqargate were probed in the same sweep and were NOT
-- restored — mustqr serves a byte-identical 18,951-byte generic shell for real and bogus ids alike,
-- aqargate a 751-byte stub. Their stale inactivations are consistent with genuinely gone, and an
-- HTTP 200 there proves nothing. sanadak is a JS SPA whose raw HTML is identical for a bogus slug:
-- UNVERIFIABLE, so its 228 stale inactivations were left untouched, not restored.

create table if not exists public.ops_stale_inactivation_probe (
  id            bigserial primary key,
  source_table  text        not null,
  listing_id    bigint      not null,
  listing_url   text        not null,
  probed_at     timestamptz not null default now(),
  http_status   int,
  body_bytes    int,
  page_title    text,
  verdict       text        not null check (verdict in ('LIVE','GONE','AMBIGUOUS','UNKNOWN')),
  oracle        text        not null,
  note          text,
  unique (source_table, listing_id, probed_at)
);

comment on table public.ops_stale_inactivation_probe is
  'Per-row source liveness evidence captured BEFORE any restore of a stale-path inactivation '
  '(DATA_INTEGRITY_ENGINEER.md §4/§15: only source-confirmed evidence justifies an inactivation, and '
  'a source-confirmed-live row must be restored). verdict=LIVE is the only value that licenses a '
  'restore. Written by the daily Data Integrity routine; read by mon_detect_stale_inactivation_unverified().';

create index if not exists idx_stale_inact_probe_row
  on public.ops_stale_inactivation_probe (source_table, listing_id, probed_at desc);
