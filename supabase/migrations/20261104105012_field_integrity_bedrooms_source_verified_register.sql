-- source-page-checks, 2026-11-04 (owner-approved round; this file records browser re-reads, no owner decision).
--
-- 1. field_integrity_bedrooms (aqar 6, alqasem 1, wasalt 8 rows) — EVERY flagged count is the SOURCE'S OWN.
--    Each ad was opened in a real browser on 2026-11-04 and its published bedroom/room count read off the
--    page (weird does not mean wrong; DATA_INTEGRITY_ENGINEER.md). bedrooms_source_corroborated() could not
--    see them because the number sits in the page's spec grid / <title>, not in our stored title or URL.
--    A new register, ops_bedrooms_source_verified, holds the browser evidence; the bedrooms arm skips a row
--    only while its stored value EQUALS the verified one, so a re-scrape that changes it re-raises.
--
-- 2. aqaralsaudia: 23.333333,45.333333 is the RealHomes theme's JSON-LD default geo, printed on an ad with
--    no map at all (11678440, «دور اول فاخر بحي البيان», read 2026-11-04) — registered as a default pin.
--
-- 3. lifecycle_duplicate_stale_copy:dealapp — both retired residential copies were retired correctly:
--    ad 196823 reads «ارض تجارية للإيجار» (commercial land) and ad 617922 reads «استخدامات العقار: تجاري»
--    (curl, 2026-11-04, HTTP 200 on each). The live copies sit in dealapp_commercial_listings. Recorded as
--    adjudicated retractions (rows unchanged; nothing is hidden or revived here).

create table if not exists public.ops_bedrooms_source_verified (
  source_table text   not null,
  listing_id   bigint not null,
  bedrooms     integer not null,
  evidence     jsonb  not null,
  verified_at  timestamptz not null default now(),
  primary key (source_table, listing_id)
);
comment on table public.ops_bedrooms_source_verified is
  'Browser-verified bedroom counts the source itself publishes (field_integrity_bedrooms). Value-pinned: '
  'mon_detect_field_integrity skips a row only while x.bedrooms = this.bedrooms.';
alter table public.ops_bedrooms_source_verified enable row level security;

insert into public.ops_bedrooms_source_verified (source_table, listing_id, bedrooms, evidence) values
  ('aqar_residential_listings', 16198425, 72, '{"ad":"6904292","read":"2026-11-04 browser","page_title":"استوديو للإيجار … - 72 غرفة، 550 م²","grid":"غرف النوم 72","note":"old شقق URL redirects to استوديوهات"}'),
  ('aqar_residential_listings', 11730,    66, '{"ad":"6716510","read":"2026-11-04 browser","grid":"عدد الغرف 66","note":"aqar now serves it as مجمع (مجمعات-للإيجار)"}'),
  ('aqar_residential_listings', 216114,   64, '{"ad":"6669018","read":"2026-11-04 browser","page_title":"استوديو للإيجار … - 64 غرفة، 1,500 م²","grid":"غرف النوم 64"}'),
  ('aqar_residential_listings', 14997713, 56, '{"ad":"6534212","read":"2026-11-04 browser","page_title":"استوديو للإيجار … - 56 غرفة، 60 م²","grid":"غرف النوم 56"}'),
  ('aqar_residential_listings', 14844060, 70, '{"ad":"6700282","read":"2026-11-04 browser","page_title":"استوديو للإيجار … - 70 غرفة، 60 م²","grid":"غرف النوم 70"}'),
  ('aqar_residential_listings', 88120,    54, '{"ad":"6647250","read":"2026-11-04 browser","grid":"عدد الغرف 54 · عدد الشقق 4","note":"aqar now serves it as مجمع (مجمعات-للبيع)"}'),
  ('alqasem_residential_listings', 13107227, 166, '{"read":"2026-11-04 browser","grid":"نوع العقار شقة · غرف 166","description":"العمارة تتكون من ٤٦ شقة … إجمالي عدد الغرف: ١٦٦ غرفة","note":"a whole building the source types شقة; type kept as published"}'),
  ('wasalt_residential_listings', 15170639, 102, '{"ad":"5930787","read":"2026-11-04 browser","page":"102 Bedrooms"}'),
  ('wasalt_residential_listings', 14609812, 54,  '{"ad":"5923714","read":"2026-11-04 browser","page":"54 Bedrooms","note":"same 1,082 m2 compound as aqar 6647250"}'),
  ('wasalt_residential_listings', 16512927, 60,  '{"ad":"5950973","read":"2026-11-04 browser","page":"60 Bedrooms"}'),
  ('wasalt_residential_listings', 16061243, 100, '{"ad":"5938459","read":"2026-11-04 browser","page":"100 Bedrooms"}'),
  ('wasalt_residential_listings', 16513297, 777, '{"ad":"5950208","read":"2026-11-04 browser","page":"777 Bedrooms"}'),
  ('wasalt_residential_listings', 14609813, 51,  '{"ad":"5923709","read":"2026-11-04 browser","page":"51 Bedrooms"}'),
  ('wasalt_residential_listings', 2071712,  74,  '{"ad":"5882708","read":"2026-11-04 browser","page":"74 Bedrooms"}'),
  ('wasalt_residential_listings', 435660,   700, '{"ad":"5874630","read":"2026-11-04 browser","page":"700 Bedrooms"}')
on conflict (source_table, listing_id) do update
  set bedrooms = excluded.bedrooms, evidence = excluded.evidence, verified_at = now();

do $do$
declare
  v_def text := pg_get_functiondef('public.mon_detect_field_integrity()'::regprocedure);
  v_old1 text := $o$and not public.bedrooms_source_corroborated(title, listing_url, bedrooms)),$o$;
  v_new1 text := $n$and not public.bedrooms_source_corroborated(title, listing_url, bedrooms)
                            -- browser-verified as the source's own count, and still that value
                            and not exists (select 1 from public.ops_bedrooms_source_verified b
                                             where b.source_table = %L and b.listing_id = x.id
                                               and b.bedrooms = x.bedrooms)),$n$;
  v_old2 text := $o$$f$, ph, ph, unit_types, rec.tn, land_types, rec.tn, rec.tn, rec.tn)$o$;
  v_new2 text := $n$$f$, ph, ph, unit_types, rec.tn, rec.tn, land_types, rec.tn, rec.tn, rec.tn)$n$;
begin
  if (length(v_def) - length(replace(v_def, v_old1, ''))) / length(v_old1) <> 1
     or (length(v_def) - length(replace(v_def, v_old2, ''))) / length(v_old2) <> 1 then
    raise exception 'mon_detect_field_integrity: anchors not found exactly once — re-read the live function';
  end if;
  execute replace(replace(v_def, v_old1, v_new1), v_old2, v_new2);
end
$do$;

insert into public.ops_default_pin_register (source_table, lat, lng, ads, districts)
values ('aqaralsaudia_residential_listings', 23.333333, 45.333333, 1, 1)
on conflict do nothing;

insert into public.ops_adjudicated_retraction (source_table, listing_id, reason, evidence) values
  ('dealapp_residential_listings', 14980521, 'wrong-table sibling: the source states commercial land; live copy is dealapp_commercial_listings 15697640',
   '{"url":"https://dealapp.sa/ar/ad-details/196823","read":"2026-11-04 curl HTTP 200","title":"ارض تجارية للإيجار","alert":"lifecycle_duplicate_stale_copy:dealapp"}'),
  ('dealapp_residential_listings', 22045812, 'wrong-table sibling: the source states commercial use; live copy is dealapp_commercial_listings 22738059',
   '{"url":"https://dealapp.sa/ar/ad-details/617922","read":"2026-11-04 curl HTTP 200","title":"شقة للإيجار","usage":"استخدامات العقار: تجاري","alert":"lifecycle_duplicate_stale_copy:dealapp"}')
on conflict (source_table, listing_id) do nothing;
