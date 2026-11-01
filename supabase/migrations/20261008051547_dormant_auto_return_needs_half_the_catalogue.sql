-- reactivate_recovered_dormant_platforms: a dormant site comes back by itself only when its
-- recovering crawl re-saw at least half of what we still hold for it.
--
-- Why (2026-10-08, ⚡ Scraping Engineer): dwelleo went dormant 10-07 because its API answered 0 and
-- 15/15 of our pages answered 404 — the site moved every listing to a new URL shape. We still hold
-- 12,328 rows for it, all pointing at dead pages. Its 10-08 04:26 crawl saw the 2 listings the site
-- now publishes. With the old rule (latest crawl ok and >= 3 rows), the first night dwelleo shows 3
-- listings the hourly job would flip it active and return ~12,000 dead cards to search. A site that
-- comes back serving a small slice of what we hold is a changed site, not a recovered one: it stays
-- dormant for an engineer, while a site that truly recovers (alhoshan 34/34, macsaib 76/76 on 10-04)
-- still returns on its own within the hour.
create or replace function public.reactivate_recovered_dormant_platforms()
 returns table(platform text, run_started_at timestamp with time zone, rows_upserted integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r record;
begin
  for r in
    select pr.platform, s.started_at, s.rows_upserted
    from platform_registry pr
    join lateral (
      select sr.started_at, sr.ok, sr.rows_upserted
      from scrape_runs sr
      where sr.platform = pr.platform and sr.finished_at is not null
      order by sr.started_at desc
      limit 1
    ) s on true
    where pr.kind = 'source' and pr.status = 'dormant'
      and s.started_at > pr.updated_at
      and s.ok is true
      and coalesce(s.rows_upserted, 0) >= 3
      and coalesce(s.rows_upserted, 0) * 2 >= (select count(*) from search_listings_ar sl
                                              where sl.platform = pr.platform)
  loop
    perform set_platform_status(r.platform, 'active',
      format('auto: crawl %s UTC ok, %s rows saved — the site serves listings again (reactivate_recovered_dormant_platforms)',
             to_char(r.started_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI'), r.rows_upserted));
    platform := r.platform; run_started_at := r.started_at; rows_upserted := r.rows_upserted;
    return next;
  end loop;
end;
$function$;

do $check$
begin
  if position('rows_upserted, 0) * 2 >=' in pg_get_functiondef('public.reactivate_recovered_dormant_platforms'::regproc)) = 0 then
    raise exception 'reactivate_recovered_dormant_platforms lacks the re-saw-half guard';
  end if;
end
$check$;
