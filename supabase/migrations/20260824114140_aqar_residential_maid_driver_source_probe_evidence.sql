-- Live-source evidence, 2026-08-24, captured BEFORE any write (AGENTS.md: a missing captured field
-- is not evidence the source omits it -- re-fetch and record the probe).
--
-- Method: production's own oracle. `_listing_json` was lifted verbatim out of
-- scrapers/aqar/enrich_residential.py (AST-extracted, so the probe cannot drift from what the
-- scraper reads) and run over live https://sa.aqar.fm/ad/<id> pages fetched through this session's
-- egress proxy. 76 pages requested, 76 parsed, 0 fetch failures.
--
--   non-Villa (the segment under test) -- 66 pages, 0 carry a `maid` or `driver` key at all:
--       30 apartment/floor rows WE store as true, 16 random apartment/floor rows, 20 LAND rows
--       WE store as true.
--   Villa (POSITIVE CONTROL, proves the harness sees the key when it is published) -- 10 pages,
--       10/10 carry `maid` and `driver`, every value matching the false we already stored.
--
-- Both directions proven, which is what makes this a verdict rather than an absence.
insert into public.ops_aqar_commercial_amenity_probe
  (column_name, source_table, pages_publishing, pages_parsed, values_published,
   cohort_column, cohort_mode, cohort_values, cohort_label, verdict, method)
values
  ('maid_room', 'aqar_residential_listings', 0, 66, 0,
   'property_type', 'not_in', array['Villa'], 'aqar residential, property_type <> Villa',
   'NOT PUBLISHED outside the Villa ad form - key absent from the payload entirely on 66/66 parsed '
   'non-Villa pages, while 10/10 Villa controls carry it. Corroborated by the stored data: Villa is '
   'the only property_type with any false (2,454), every other type has trues and zero falses.',
   'production _listing_json oracle (AST-lifted from scrapers/aqar/enrich_residential.py), 76 live '
   'pages, 0 fetch failures, Villa control matched stored values exactly'),
  ('driver_room', 'aqar_residential_listings', 0, 66, 0,
   'property_type', 'not_in', array['Villa'], 'aqar residential, property_type <> Villa',
   'NOT PUBLISHED outside the Villa ad form - same 76-page probe; 0/66 non-Villa pages carry the '
   'key, 10/10 Villa controls publish driver:0 matching our stored false.',
   'production _listing_json oracle (AST-lifted from scrapers/aqar/enrich_residential.py), 76 live '
   'pages, 0 fetch failures, Villa control matched stored values exactly')
on conflict (source_table, column_name, coalesce(cohort_label, '')) do update
  set pages_parsed = excluded.pages_parsed,
      pages_publishing = excluded.pages_publishing,
      values_published = excluded.values_published,
      verdict = excluded.verdict,
      method  = excluded.method,
      probed_at = now();
