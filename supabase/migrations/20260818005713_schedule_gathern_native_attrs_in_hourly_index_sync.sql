-- CLOSE THE AUTOMATION GAP (caught in this session's own fresh-listing trace, before it could bite):
-- sync_gathern_native_attrs() had been run once by hand but never scheduled, so listings scraped
-- AFTER that run would sit unrated in the index until the fresh-capture-collapse leg of
-- mon_detect_gathern_rating_source_truth paged someone. Ratings must reach the Monthly filter with
-- NO manual step. It rides the SAME hourly index-sync job every sibling sync already rides
-- (jobid 28, :14 — sync_search_listings_ar → refresh_rnpl_flags → sync_payment_monthly →
-- sync_all_rich_attrs), appended LAST so the base rows exist before their Gathern attrs are
-- mirrored. cron.alter_job keeps the jobid (dashboards and mon_detect_cron_health key on it).
do $$
declare cmd text;
begin
  select command into cmd from cron.job where jobid = 28;
  if cmd is null then raise exception 'jobid 28 (sync-search-listings-ar) not found'; end if;
  if position('sync_gathern_native_attrs' in cmd) > 0 then
    raise notice 'already scheduled — no-op'; return;
  end if;
  perform cron.alter_job(28, command => cmd || ' select public.sync_gathern_native_attrs();');
end $$;
select command from cron.job where jobid = 28;