-- District-vs-source check goes fleet-wide (owner, 2026-09-25: "PROVE whether they actually cover
-- all active platforms ... If any platform bypasses them, fix that.").
--
-- MEASURED BEFORE THIS: mon_detect_district_contradicts_source compared against
-- listing_source_district_ar, whose definition reads ONE table (gathern_residential_listings). The
-- only "district contradicts what the source published" barrier covered 1 of 104 active platforms
-- (27,875 compared rows); this makes it 236,158.
--
-- listing_source_district_ar itself is NOT changed: refresh_district_recovery() uses it as an
-- exclusion list when it WRITES district_recovery, so widening it would silently change a data path.
-- The fleet table below feeds only the detector's view (read-only: raises alerts, writes no listing).
--
-- A TABLE refreshed off-sweep, not a view: the full-fleet scan costs ~30s and the twice-hourly
-- mon_run_all_detectors sweep already runs 4-11 min against a 900s timeout (cron jobid 38,
-- measured 2026-09-25). The detector joins this indexed table instead.
--
-- Source value, per row: the first ARABIC-SCRIPT value among additional_info.district_ar, the
-- district_ar column (where the table has one) and neighborhood, trimmed of edge punctuation.
-- Latin-script values are skipped: gathern/rightcompound/daryusuf/compoundin/abeea/satel publish
-- English names ("Al Yarmuk Dist." -> "حي اليرموك"); that is a language difference, not a
-- contradiction.
--
-- The comparison adds CONTAINMENT: "الرحاب" vs "الرحاب - بريده" or "الجامعة" vs "تبوك حي الجامعة" is
-- formatting, not a different neighbourhood. Measured on the pre-existing gathern scope before the
-- change: 3 contradictions exact, 3 with containment — the refinement hides nothing it flagged.
create table if not exists public.listing_source_district_ar_fleet (
  source_table text not null,
  listing_id bigint not null,
  source_district_ar text not null,
  refreshed_at timestamptz not null default now(),
  primary key (source_table, listing_id)
);

create or replace function public.refresh_listing_source_district_ar_fleet()
returns int
language plpgsql
set statement_timeout = '600s'
as $$
declare
  q text;
  n int;
  ar constant text := 'case when %1$s ~ ''[؀-ۿ]'' and %1$s !~ ''[A-Za-z]'' then nullif(btrim(%1$s, '' :-،.''), '''') end';
begin
  select string_agg(format(
           'select %L::text, x.id, coalesce(%s) from public.%I x where x.active',
           c.relname,
           concat_ws(', ',
             format(ar, '(x.additional_info->>''district_ar'')'),
             case when exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'district_ar' and not a.attisdropped)
                  then format(ar, 'x.district_ar') end,
             format(ar, 'x.neighborhood')),
           c.relname), ' union all ' order by c.relname),
         count(*)
    into q, n
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     and c.relname ~ '_(residential|commercial)_listings$'
     and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'neighborhood' and not a.attisdropped)
     and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'additional_info' and not a.attisdropped)
     and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'active' and not a.attisdropped);

  delete from public.listing_source_district_ar_fleet;
  execute 'insert into public.listing_source_district_ar_fleet (source_table, listing_id, source_district_ar) '
       || 'select * from (' || q || ') u(st, id, v) where v is not null';
  return n;
end $$;

select public.refresh_listing_source_district_ar_fleet();

create or replace view public.mon_district_contradicts_source as
select s.source_table, s.listing_id, s.platform, s.city_ar,
       sd.source_district_ar as source_says, s.district_ar as we_display
  from public.search_listings_ar s
  join public.listing_source_district_ar_fleet sd
    on sd.source_table = s.source_table and sd.listing_id = s.listing_id
 where s.district_ar is not null
   and public.norm_district_tok(s.district_ar) <> public.norm_district_tok(sd.source_district_ar)
   and position(public.norm_district_tok(s.district_ar) in public.norm_district_tok(sd.source_district_ar)) = 0
   and position(public.norm_district_tok(sd.source_district_ar) in public.norm_district_tok(s.district_ar)) = 0;

-- Re-derived every 3h from the live table list, so a platform added later is covered automatically.
select cron.schedule('refresh-listing-source-district-ar-fleet', '41 */3 * * *',
                     $$select public.refresh_listing_source_district_ar_fleet()$$);
