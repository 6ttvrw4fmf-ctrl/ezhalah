-- 🔧 QA 2026-10-09: every served listing gets its Ezhalah first_seen_at, not only the ones whose
-- source has no last_updated.
--
-- Measured 2026-10-09 17:30 UTC: search_listings_ar.first_seen_at was NULL on 135,079 of 352,565
-- served rows. sync_search_first_seen_at() stamped a row only while s.last_updated IS NULL, so any
-- listing whose source carries an update time (aqar, dealapp, muhaysini, ...) was stamped only if
-- this job happened to reach it before the hourly sync wrote last_updated. In the last 24 h the
-- index counted 18 aqar arrivals while aqar_residential_listings inserted 835 (dealapp 45 vs 1,601).
-- «New in 24 h» — the New Listings engineer's whole scope, the owner's feeds gate, and the
-- detectors that read recent arrivals (aqar_deep_fill_health, english_city_arrival_lag,
-- af_coverage_cliff, scraper_field_fill_losses) — was reading a race, not the arrivals.
--
-- Customers see no change: search orders by coalesce(last_updated, first_seen_at), and every row
-- this newly stamps already has last_updated.
--
-- Pass 1 stamps the last 8 days on every run (≈15k rows the first time, then only new arrivals).
-- Pass 2 back-fills older rows at most 25,000 per run, so the 135k backlog drains over ~6 runs of
-- the existing 10-minute job without one heavy write.
create or replace function public.sync_search_first_seen_at()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  rec record;
  filled int := 0;
  older int := 0;
  n int;
begin
  if not public.search_index_writer_lock() then return null; end if;
  for rec in
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name ~ '_(residential|commercial)_listings$'
      and c.column_name = 'scraped_at'
  loop
    execute format($f$
      update public.search_listings_ar s
         set first_seen_at = r.scraped_at
        from public.%I r
       where s.source_table = %L
         and s.listing_id = r.id
         and s.first_seen_at is null
         and r.scraped_at > now() - interval '8 days'
    $f$, rec.table_name, rec.table_name);
    get diagnostics n = row_count;
    filled := filled + n;
  end loop;
  for rec in
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name ~ '_(residential|commercial)_listings$'
      and c.column_name = 'scraped_at'
  loop
    exit when older >= 25000;
    execute format($f$
      update public.search_listings_ar s
         set first_seen_at = r.scraped_at
        from public.%1$I r
       where s.source_table = %1$L
         and s.listing_id = r.id
         and s.first_seen_at is null
         and s.listing_id in (
               select s2.listing_id
                 from public.search_listings_ar s2
                 join public.%1$I r2 on r2.id = s2.listing_id
                where s2.source_table = %1$L
                  and s2.first_seen_at is null
                  and r2.scraped_at is not null
                limit %2$s)
    $f$, rec.table_name, 25000 - older);
    get diagnostics n = row_count;
    older := older + n;
  end loop;
  return filled + older;
end
$function$;