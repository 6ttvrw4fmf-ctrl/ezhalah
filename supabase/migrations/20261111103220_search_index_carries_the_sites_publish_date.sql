-- THE SITE'S OWN PUBLISH DATE IN THE SEARCH INDEX (owner 2026-11-11: «time published … by date of publishment not ours»).
-- search_listings_ar.posted_at = public.source_posted_at(<platform table>.date_added): the date the listing SITE says it
-- published the ad — never our first-seen time, a licence date or a bump date (scrapers/common/posting_date.py). A
-- missing or unreadable date stays NULL, and a NULL never counts as recent (the «Published within» filter and the
-- «إعلان جديد» pin tag read it; an undated ad shows only under «أي وقت»). A date more than a day ahead is not a date.
-- Filled like first_seen_at (sync_search_first_seen_at): pass 1 keeps rows first crawled in the last 8 days exact; pass 2
-- fills the older backlog, 25,000 rows a run. Cron every 10 minutes.
alter table public.search_listings_ar add column if not exists posted_at timestamptz;

create or replace function public.sync_search_posted_at()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  rec record;
  recent int := 0;
  older int := 0;
  n int;
begin
  if not public.search_index_writer_lock() then return null; end if;
  for rec in
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name ~ '_(residential|commercial)_listings$'
      and c.column_name = 'date_added'
      and exists (select 1 from information_schema.columns c2
                   where c2.table_schema = 'public' and c2.table_name = c.table_name and c2.column_name = 'scraped_at')
  loop
    execute format($f$
      update public.search_listings_ar s
         set posted_at = x.p
        from (select r.id, case when public.source_posted_at(r.date_added) <= now() + interval '1 day'
                                then public.source_posted_at(r.date_added) end as p
                from public.%1$I r
               where r.scraped_at > now() - interval '8 days') x
       where s.source_table = %1$L
         and s.listing_id = x.id
         and s.posted_at is distinct from x.p
    $f$, rec.table_name);
    get diagnostics n = row_count;
    recent := recent + n;
  end loop;
  for rec in
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name ~ '_(residential|commercial)_listings$'
      and c.column_name = 'date_added'
  loop
    exit when older >= 25000;
    execute format($f$
      update public.search_listings_ar s
         set posted_at = public.source_posted_at(r.date_added)
        from public.%1$I r
       where s.source_table = %1$L
         and s.listing_id = r.id
         and s.posted_at is null
         and s.listing_id in (
               select s2.listing_id
                 from public.search_listings_ar s2
                 join public.%1$I r2 on r2.id = s2.listing_id
                where s2.source_table = %1$L
                  and s2.posted_at is null
                  and public.source_posted_at(r2.date_added) <= now() + interval '1 day'
                limit %2$s)
    $f$, rec.table_name, 25000 - older);
    get diagnostics n = row_count;
    older := older + n;
  end loop;
  return recent + older;
end
$function$;

revoke all on function public.sync_search_posted_at() from public;

select cron.schedule('sync-search-posted-at', '3-59/10 * * * *', 'select public.sync_search_posted_at();');