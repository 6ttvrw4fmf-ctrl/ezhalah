-- Regenerates the Tier-3 browser allowlist in docs/ops/SEARCH_MATCH_QA_ENGINEER.md §18b:
-- the destination host of every active platform's listing_url, i.e. every domain the Search &
-- Matching QA engineer's browser must reach to test card click-through (§22).
--
-- Run after any platform is added or retired, then update §18b. Generated, never hand-maintained.
do $$
declare r record;
begin
  create temp table if not exists qa_src_hosts(platform text, host text, n bigint) on commit preserve rows;
  delete from qa_src_hosts;
  for r in select distinct split_part(s.source_table,'_',1) plat, s.source_table
           from public.search_listings_ar s where s.production_ready
  loop
    begin
      execute format(
        'insert into qa_src_hosts select %L, lower(substring(listing_url from ''^https?://([^/]+)'')), count(*)
           from public.%I where listing_url is not null group by 2', r.plat, r.source_table);
    exception when others then null;   -- table without listing_url: skip, never fail the sweep
    end;
  end loop;
end $$;

select platform,
       string_agg(distinct host, ', ' order by host) as hosts,
       sum(n) as listings
from qa_src_hosts
where host is not null
group by platform
order by sum(n) desc;
