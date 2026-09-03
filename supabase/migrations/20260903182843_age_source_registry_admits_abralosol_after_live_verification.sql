-- Admit abralosol to the property-age resolver, on EVIDENCE (2026-09-03).
--
-- age_source_registry is deliberately not a list of "platforms that have an age column" — it is a
-- list of sources whose age has been PROVEN to match what the site publishes. Every existing row
-- carries the probe that earned it. So abralosol was probed before being registered, not after:
--
--   LIVE PROBE 2026-09-03, 5 listings fetched from abralosol.com and compared to the stored value:
--     https://abralosol.com/6680  source «العمر30» -> stored property_age 30   MATCH
--     https://abralosol.com/7232  source «العمر25» -> stored 25                MATCH
--     https://abralosol.com/7217  source «العمر1»  -> stored 1                 MATCH
--     https://abralosol.com/7302  source «العمر10» -> stored 10                MATCH
--     https://abralosol.com/7544  source «العمر29» -> stored 29                MATCH
--   5/5 exact. The site prints the age inline in the listing row as «العمر <n>», which the scraper
--   reads into the canonical property_age column, so strategy is canonical_column (no JSONB key).
--   372 of 2,662 rows carry an age; the rest are silent at source and stay NULL.
--
-- The other four platforms activated today are deliberately NOT registered: therc, aouj, arkaan and
-- rawasidark publish no property age at all (0 non-null across all 1,652 of their rows), so there is
-- nothing to admit. Registering them would assert a decision about evidence that does not exist.
insert into public.age_source_registry (source_table, strategy, trusted, note, jsonb_key)
values
  ('abralosol_residential_listings', 'canonical_column', true,
   'TRUSTED 2026-09-03 (5-platform activation): live probe of 5 listings on abralosol.com — 6680 (30), '
   || '7232 (25), 7217 (1), 7302 (10), 7544 (29) — each printed inline as «العمر <n>» and each equal to '
   || 'the stored property_age. 5/5 exact, no conflation with the adjacent «شارع»/«المساحة» figures. '
   || '372/2662 rows aged; the remainder are source-silent and stay NULL.', null),
  ('abralosol_commercial_listings', 'canonical_column', true,
   'as residential — same inline «العمر <n>» cell, same parser, same 2026-09-03 probe.', null)
on conflict (source_table) do update
  set strategy = excluded.strategy,
      trusted   = excluded.trusted,
      note      = excluded.note,
      jsonb_key = excluded.jsonb_key,
      updated_at = now();

select source_table, strategy, trusted from public.age_source_registry
where source_table like 'abralosol%' order by 1;
