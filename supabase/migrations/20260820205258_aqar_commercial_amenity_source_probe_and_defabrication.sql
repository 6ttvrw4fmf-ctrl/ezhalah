-- Senior Production Engineer run #32b (2026-08-20), owner-directed follow-up.
--
-- QUESTION ASKED: aqar_commercial has captured no elevator since 2026-08-07 while residential still
-- captures it. Is the source no longer publishing, or did Ezhalah stop reading?
--
-- ANSWER: NEITHER. aqar has never published these keys for COMMERCIAL listings, and the 4,176 rows
-- that carry them are pre-2026-08-09 fabrications the anti-fabrication cleanup missed.
--
-- HOW IT WAS PROVEN (the earlier run reported this BLOCKED because a local probe failed on its own
-- control; that is why a control is mandatory). The production fetch helper scrapers/common/http.get()
-- returns None in the audit container: it passes proxies=None for aqar URLs, forcing a direct
-- connection the sandbox blocks, and curl_cffi's Chrome-impersonated handshake is reset by the
-- egress proxy. So the pages were fetched with a plain browser-UA client and read through
-- PRODUCTION'S OWN ORACLE -- _listing_json() + _amenities() from scrapers/aqar/enrich_residential.py,
-- the exact functions the enricher uses.
--
-- The harness was validated against a RESIDENTIAL CONTROL before any commercial conclusion was drawn:
-- ad 6831515 (row 8632774) -> oracle returned elevator=False, kitchen=True, which is EXACTLY what
-- production has stored for that row. A harness that reproduces a known-good row is trustworthy;
-- the earlier probe was discarded precisely because its control returned None.
--
-- PER-COLUMN EVIDENCE, 14 live commercial pages, all 14 parsed OK (mixed محلات / مكتب / مستودع /
-- فنادق / محطات, rent and sale), counting pages where aqar publishes the key at all:
--     elevator 0/14 · kitchen 0/14 · air_conditioner 0/14 · car_entrance 0/14 · private_entrance 0/14
--     parking 3/14 · balcony_terrace 3/14 · laundry_room 3/14 · optical_fibers 3/14
--     apartment_in_project 3/14 · separate_water_meter 3/14 · separate_electricity_meter 3/14
--     villa_on_roof 3/14 · furnished 4/14 · water_supply 14/14 · electricity 14/14 · sanitation 14/14
--
-- So the commercial payload is a DIFFERENT SHAPE, not a broken read: its extended_details block is
-- 15-21 keys of REGA/licence/location metadata and appears with the amenity sub-block on only ~21%
-- of pages. The columns aqar DOES publish are being captured correctly right now -- water_supply is
-- 292/292 on the last 7 days of fresh commercial rows. Nothing is broken in the enricher, the
-- upsert, or the type routing: run_commercial.py already imports the shared enrich_residential().
--
-- ONLY the five 0/14 columns are touched. parking and the other extended_details columns are
-- explicitly NOT touched -- they ARE published on some commercial pages, and blanket-clearing them
-- would destroy real source data. (aqar_commercial.parking is 0 non-null today anyway.)
--
-- WHY THE STORED VALUES ARE FABRICATIONS, NOT STALE TRUTH. Re-probed 7 of the affected rows live
-- through the same validated oracle: 0/7 pages publish lift/ketchen/ac, yet all 7 store confident
-- booleans -- including elevator=true on three offices. Before 2026-08-09 the parser derived these
-- from prose and defaulted absence to False; that was recognised as fabrication and fixed
-- (scrapers/aqar/recover_stubs.py --cohort amenity-repair documents the cleanup), but the cleanup
-- covered the residential table only. The cohort is closed and dated: 4,176 rows, newest affected
-- scraped_at = 2026-08-07 16:16, and ZERO rows scraped after 2026-08-09 carry any of the five --
-- the current parser cannot produce them, so this cannot re-accumulate.
--
-- USER IMPACT BEING REMOVED: listing_extra_attrs is a VIEW over the raw table, so the fabrications
-- reach search_listings_ar unchanged -- 2,674 active, production_ready (searchable) commercial
-- listings, of which 86 assert elevator=true to anyone using the elevator Advanced Filter, and 2,588
-- assert a confident false the source never stated. Honest NULL beats a guess (AGENTS.md).
--
-- FULLY REVERSIBLE: every prior value is snapshotted first, so this is restorable row-by-row.

create table if not exists public.ops_aqar_commercial_amenity_probe (
  id            bigserial primary key,
  probed_at     timestamptz not null default now(),
  column_name   text not null,
  pages_publishing int not null,
  pages_parsed  int not null,
  verdict       text not null,
  method        text not null
);
comment on table public.ops_aqar_commercial_amenity_probe is
  'Recorded source evidence for aqar COMMERCIAL amenity publication (owner permanent rule #2, 2026-08-13: '
  'a missing captured field is never evidence the source omits it until a probe says so). Read through '
  'production''s own _listing_json()/_amenities() oracle, validated against a residential control that '
  'reproduced its stored values exactly. Senior run #32b, 2026-08-20.';

insert into public.ops_aqar_commercial_amenity_probe (column_name, pages_publishing, pages_parsed, verdict, method)
values
 ('elevator',0,14,'NOT PUBLISHED for commercial','production _listing_json + _amenities oracle, 14 live pages, residential control matched stored values'),
 ('kitchen',0,14,'NOT PUBLISHED for commercial','same'),
 ('air_conditioner',0,14,'NOT PUBLISHED for commercial','same'),
 ('car_entrance',0,14,'NOT PUBLISHED for commercial','same'),
 ('private_entrance',0,14,'NOT PUBLISHED for commercial','same'),
 ('parking',3,14,'PUBLISHED on some commercial pages - DO NOT CLEAR','same'),
 ('balcony_terrace',3,14,'PUBLISHED on some commercial pages - DO NOT CLEAR','same'),
 ('laundry_room',3,14,'PUBLISHED on some commercial pages - DO NOT CLEAR','same'),
 ('optical_fibers',3,14,'PUBLISHED on some commercial pages - DO NOT CLEAR','same'),
 ('apartment_in_project',3,14,'PUBLISHED on some commercial pages - DO NOT CLEAR','same'),
 ('separate_water_meter',3,14,'PUBLISHED on some commercial pages - DO NOT CLEAR','same'),
 ('separate_electricity_meter',3,14,'PUBLISHED on some commercial pages - DO NOT CLEAR','same'),
 ('villa_on_roof',3,14,'PUBLISHED on some commercial pages - DO NOT CLEAR','same'),
 ('furnished',4,14,'PUBLISHED - captured correctly today','same'),
 ('water_supply',14,14,'PUBLISHED ALWAYS - captured 292/292 on fresh rows','same'),
 ('electricity',14,14,'PUBLISHED ALWAYS - captured today','same'),
 ('sanitation',14,14,'PUBLISHED ALWAYS - captured today','same');

-- Reversible snapshot of every value about to be cleared.
create table if not exists public.ops_aqar_commercial_amenity_defabrication (
  listing_id       bigint primary key,
  scraped_at       timestamptz,
  elevator         boolean,
  kitchen          boolean,
  air_conditioner  boolean,
  car_entrance     boolean,
  private_entrance boolean,
  cleared_at       timestamptz not null default now()
);
comment on table public.ops_aqar_commercial_amenity_defabrication is
  'Pre-clear snapshot of the 4,176 pre-2026-08-09 fabricated aqar_commercial amenity booleans. '
  'Restores the exact prior value per row if this repair ever needs reversing. Senior run #32b.';

insert into public.ops_aqar_commercial_amenity_defabrication
  (listing_id, scraped_at, elevator, kitchen, air_conditioner, car_entrance, private_entrance)
select id, scraped_at, elevator, kitchen, air_conditioner, car_entrance, private_entrance
  from public.aqar_commercial_listings
 where elevator is not null or kitchen is not null or air_conditioner is not null
    or car_entrance is not null or private_entrance is not null
on conflict (listing_id) do nothing;

-- Guard: refuse to clear anything the CURRENT parser produced. If a row scraped after the
-- 2026-08-09 anti-fabrication fix carries one of these, the premise is wrong and this must not run.
do $$
declare v_new int;
begin
  select count(*) into v_new from public.aqar_commercial_listings
   where scraped_at > timestamptz '2026-08-09 00:00:00+00'
     and (elevator is not null or kitchen is not null or air_conditioner is not null
       or car_entrance is not null or private_entrance is not null);
  if v_new > 0 then
    raise exception 'REFUSED: % commercial rows scraped after the 2026-08-09 fix carry these columns - the fabrication premise does not hold', v_new;
  end if;
end $$;

update public.aqar_commercial_listings
   set elevator = null, kitchen = null, air_conditioner = null,
       car_entrance = null, private_entrance = null
 where elevator is not null or kitchen is not null or air_conditioner is not null
    or car_entrance is not null or private_entrance is not null;
