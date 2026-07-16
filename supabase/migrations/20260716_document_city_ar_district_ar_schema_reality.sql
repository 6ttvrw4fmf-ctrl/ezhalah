-- ─────────────────────────────────────────────────────────────────────────────────────────
-- DOCUMENT city_ar/district_ar SCHEMA REALITY — comment-only, no behavior change
--
-- INCIDENT (2026-07-16, project aannarbkwcymrotzwdbo): a one-time, ~52-second burst of
-- `column city_ar/district_ar does not exist` errors hit ~19 non-native platforms' raw
-- *_listings tables. Root-caused to an ad-hoc script (not any committed cron job, function,
-- trigger, or Edge Function — all exhaustively checked and ruled out) that assumed every
-- `*_listings` table carries first-class `city_ar`/`district_ar` columns. Verified via direct
-- `information_schema.columns` query: only 7 tables across 6 platforms actually do —
-- aldarim, alhoshan, aqargate, aqarmonthly (residential only), hajer, sanadak, wasalt.
-- Everywhere else, the resolved Arabic location (where it exists) lives in
-- `additional_info->>'city_ar'` / `->>'district_ar'` (JSONB), not a real column.
--
-- No code or schema was broken by this incident (SELECT-only failures abort before any write
-- executes) — this migration only adds a COMMENT so the correct, already-existing safe
-- pattern (`listing_native_location_v2`, which already NULL-catch-alls every non-native
-- platform) is discoverable directly from the schema (`\d+ listing_native_location_v2`,
-- `information_schema.views`) by any future script or session, instead of only living in
-- docs/LOCATION_RESOLUTION.md. Full writeup: docs/LOCATION_RESOLUTION.md
-- ("city_ar/district_ar are NOT universal columns" section).
-- ─────────────────────────────────────────────────────────────────────────────────────────

comment on view public.listing_native_location_v2 is
  'SAFE, schema-aware way to read a listing''s resolved city_ar/district_ar for ANY platform. '
  'Only 7 tables (aldarim, alhoshan, aqargate, aqarmonthly-residential, hajer, sanadak, wasalt) '
  'have real city_ar/district_ar columns; every other platform''s *_listings table does NOT — '
  'querying one directly raises "column does not exist" (real 2026-07-16 incident). This view '
  'handles every platform correctly (native columns where they exist, souq24 special-cased, '
  'NULL catch-all everywhere else). Always read location through this view, never a raw '
  'platform table''s city_ar/district_ar. See docs/LOCATION_RESOLUTION.md.';
