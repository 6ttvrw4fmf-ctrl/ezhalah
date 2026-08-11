-- One entry point that syncs EVERY branch, so adding a branch never again requires a cron edit.
-- The platform list is parsed out of the view definition (cheap regex, no scan) rather than
-- SELECT DISTINCT over the view, which would materialise all ~50 branches just to list them.
--
-- wasalt is excluded by default: its branch alone costs ~18.6s (correlated subplans re-detoasting
-- the same jsonb), versus under 310ms for every other platform combined. It runs on its own daily
-- slot instead of inside the hourly job.
create or replace function public.sync_all_rich_attrs(
  p_exclude text[] default array['wasalt_residential_listings'])
returns table(source_table text, rows_written bigint)
language plpgsql
as $fn$
declare def text; t text; n bigint;
begin
  select pg_get_viewdef('public.listing_rich_attrs'::regclass, true) into def;
  for t in
    select distinct m[1] from regexp_matches(def, 'FROM ([a-z0-9_]+_listings) [a-z]', 'g') m
     order by 1
  loop
    continue when t = any(coalesce(p_exclude, '{}'::text[]));
    n := public.sync_listing_rich_attrs(t);
    if n > 0 then
      source_table := t; rows_written := n; return next;
    end if;
  end loop;
end
$fn$;

comment on function public.sync_all_rich_attrs(text[]) is
  'Syncs every listing_rich_attrs branch into search_listings_ar. Branch list is parsed from the '
  'view definition, so a newly added branch is picked up with no cron change. wasalt is excluded by '
  'default (~18.6s) and runs on its own daily slot.';

-- point the hourly job at the single entry point
do $$
declare cur text; want text;
begin
  select command into cur from cron.job where jobid = 28;
  if cur is null or cur not like '%sync_search_listings_ar()%' then
    raise exception 'jobid 28 is not the search sync job - refusing to edit';
  end if;
  want := regexp_replace(cur, '\s*select public\.sync_listing_rich_attrs\([^)]*\);', '', 'g');
  want := regexp_replace(want, '\s*select \* from public\.sync_all_rich_attrs\(\);', '', 'g');
  want := rtrim(btrim(want), ';') || '; select * from public.sync_all_rich_attrs();';
  perform cron.alter_job(28, command => want);

  select command into cur from cron.job where jobid = 28;
  if cur not like '%sync_search_listings_ar()%' or cur not like '%refresh_rnpl_flags()%'
     or cur not like '%sync_payment_monthly()%' or cur not like '%sync_all_rich_attrs()%' then
    raise exception 'post-edit jobid 28 is wrong: %', cur;
  end if;
end $$;
