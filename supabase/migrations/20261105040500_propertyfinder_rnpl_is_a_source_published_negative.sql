-- PROPERTY FINDER'S «rent now, pay monthly» IS A NEGATIVE THE SOURCE PUBLISHES, not one we manufactured.
-- The daily safety-barrier refresh (03:23 UTC, 2026-11-05) — the first after the Property Finder launch — flagged
-- (propertyfinder, rent_now_pay_later): 1,200 false, 0 true, and verify-safety-barrier.ts has failed every PR's npm test
-- since. Measured 2026-11-05 over the stored rows: every Property Finder RENT ad carries the source's own structured flag
-- `rnpm: {"enabled": false}` in source_capture.item (1,040 / 1,040 residential, 160 / 160 commercial), 0 carry it absent,
-- 0 false cells lack it. scrapers/propertyfinder/run.py is tri-state on it (`bool(rnpm) if rnpm is not None else
-- None`, rent ads only), so an ad that stops publishing the flag goes NULL, never false. Zero-true is Property Finder
-- having no RNPM offer on any Saudi rent ad today. Same evidence-bearing allowlist as aldarim / abwbna (20260911115757).
insert into public.ops_source_published_negative (platform, col, evidence, verified_at) values
('propertyfinder', 'rent_now_pay_later',
 'Property Finder publishes rnpm.enabled as an explicit structured boolean on every rent ad of its category pages '
 '(__NEXT_DATA__ searchResult.listings[].property.rnpm): enabled=false on 1,040/1,040 residential and 160/160 commercial '
 'rent rows, absent on 0, true on 0 (stored source_capture, measured 2026-11-05). The scraper stores it tri-state '
 '(absent → NULL), so no fabricated negative exists. Zero-true is Property Finder offering no rent-now-pay-monthly today.',
 now())
on conflict do nothing;

set local statement_timeout = '10min';
select public.refresh_safety_barrier_state();

do $verify$
begin
  if not exists (select 1 from public.ops_source_published_negative where platform = 'propertyfinder' and col = 'rent_now_pay_later') then
    raise exception 'the propertyfinder rent_now_pay_later allowlist row is missing';
  end if;
  if exists (select 1 from public.propertyfinder_residential_listings
              where rent_now_pay_later is false and coalesce(source_capture->'item'->'rnpm'->>'enabled', '') <> 'false')
     or exists (select 1 from public.propertyfinder_commercial_listings
              where rent_now_pay_later is false and coalesce(source_capture->'item'->'rnpm'->>'enabled', '') <> 'false') then
    raise exception 'a propertyfinder rent_now_pay_later=false cell lacks the source''s own rnpm.enabled=false — that one IS manufactured';
  end if;
  if (select manufactured_pairs from public.mon_safety_barrier_state where id = 1) <> 0 then
    raise exception 'the safety barrier still reports manufactured pairs: %', (select detail from public.mon_safety_barrier_state where id = 1);
  end if;
  raise notice 'propertyfinder rent_now_pay_later recorded as source-published; safety barrier state clean';
end $verify$;
