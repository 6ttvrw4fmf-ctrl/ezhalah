-- أبعاد (abaad) joins the three registries: liveness, platform_registry, and age_source_registry.
--
-- LIVENESS. Same CANDIDATE_PLUS_DIRECT / 168h / grace 3 as every platform onboarded on 2026-09-24.
--
-- PLATFORM REGISTRY. The removal oracle is unusual and was measured, not assumed: a de-listed abaad
-- ad KEEPS SERVING a full HTTP 200 detail page, so a 200 proves nothing. The decider is the REGA ad
-- licence expiry the record publishes about itself (`end_date`). Measured 2026-09-25: the catalogue
-- went 405 → 400 inside ~25 minutes and the five ids that left were EXACTLY the five whose end_date
-- was that day, with zero of the remaining 400 carrying a past expiry; validated on 12 sampled
-- absent ids (4 × 404, 8 × 200-with-lapsed-expiry, 12/12). So: 404 or lapsed licence → gone; expiry
-- today → hold (the measured boundary); valid → live; unreadable → no opinion.
--
-- AGE. `age_estate` is Arabic WORD-numerals («سنتين», «اكثر من عشر سنوات», «جديد») and goes through
-- the shared normalize.parse_property_age(); an open bound stays NULL rather than becoming its
-- floor. age_source_registry is the ONLY route by which an age reaches the Advanced Filter —
-- listing_native_location_v2 takes property_age from listing_age_resolved, which
-- rebuild_age_producer() (pg_cron 46, hourly at :44) regenerates from THIS registry alone, so a
-- hand-added arm without a row here is wiped within the hour (the akariyoun lesson, 20260919014424).
insert into public.ops_liveness_registry (platform, strategy, sla_hours, grace)
values ('abaad','CANDIDATE_PLUS_DIRECT',168,3)
on conflict (platform) do update
  set strategy = excluded.strategy, sla_hours = excluded.sla_hours, grace = excluded.grace;

insert into public.platform_registry (platform, status, expected_cadence_hours, window_days, notes, kind, updated_at)
values ('abaad','active',24,7,
        'أبعاد (app.abaadapp.sa). Public JSON API /api/v1/estate/get-estate/all?limit=&offset= (offset is a 1-based PAGE), total_size ~400, no auth and no proxy needed. Deal type is advertisement_type (بيع/إيجار). *** NOT A 404 *** a de-listed ad keeps serving a full 200 detail page; the oracle is the ad-licence expiry the record publishes about itself (end_date): 404 or lapsed → gone, expiry today → hold, valid → live, unreadable → no opinion (measured 12/12 on sampled absent ids, plus the 405→400 drop matching exactly the five same-day expiries). LAND PRICES ARE PER-METRE: for category ارض, price is سعر المتر and total_price is إجمالي السعر — both source-published, neither computed.',
        'source', now())
on conflict (platform) do update
  set status = excluded.status, expected_cadence_hours = excluded.expected_cadence_hours,
      window_days = excluded.window_days, notes = excluded.notes, kind = excluded.kind,
      updated_at = now();

insert into public.age_source_registry (source_table, strategy, trusted, note, updated_at)
select t, 'canonical_column', true,
       'TRUSTED 2026-09-25: the API record''s own age_estate, Arabic word-numerals («سنتين», «اكثر من عشر سنوات», «جديد»), through the shared normalize.parse_property_age(); an open bound («اكثر من…») stays NULL rather than becoming its floor. Measured: property_age on 163 of ~400 records (scrapers/abaad/run.py).',
       now()
from unnest(array['abaad_residential_listings','abaad_commercial_listings']) t
on conflict (source_table) do update
  set strategy = excluded.strategy, trusted = excluded.trusted, note = excluded.note, updated_at = now();

do $verify$
declare n int;
begin
  if not exists (select 1 from public.ops_liveness_registry where platform = 'abaad') then
    raise exception 'abaad did not land in ops_liveness_registry';
  end if;
  if not exists (select 1 from public.platform_registry where platform = 'abaad' and status = 'active' and kind = 'source') then
    raise exception 'abaad did not land in platform_registry as an active source';
  end if;
  select count(*) into n from public.age_source_registry
   where source_table in ('abaad_residential_listings','abaad_commercial_listings');
  if n <> 2 then raise exception 'expected both abaad tables in age_source_registry, found %', n; end if;
  -- the three platforms held down tonight must not have been disturbed by this insert
  if (select count(*) from public.platform_registry where status = 'dormant') <> 3 then
    raise exception 'the dormant set changed while registering abaad';
  end if;
end $verify$;
