-- 🆕 New Listings Engineer, 2026-10-16 (backlog #589). sadiqeltajer_residential_listings 17956334 is the
-- platform's own TEST ad, not a property: https://sadiq-eltajer.sa/ads/fake-1001-2 renders the title
-- «fake - 1002», no price, no description, and the site's default «default-build.png» image (source re-read
-- run 38916270732). It arrived on 2026-10-16 and was served to customers as a 50 m² villa for sale in مكة.
--
-- HIDING A LISTING IS A TWO-PART ACT (AGENTS.md): the page is still live at its source, so active = false
-- alone is undone by auto_recover_false_inactive() within a day. The row is therefore also registered in
-- ops_adjudicated_retraction, which puts it under mon_detect_adjudicated_reactivation() — the standing
-- detector that raises if any adjudicated row is active again, by whatever path. The scraper stops
-- re-ingesting /ads/fake-N in the same change (scrapers/sadiqeltajer/run.py PLATFORM_TEST_AD).
--
-- Guarded: touches exactly one row, by id AND its own URL, and only while it is still that test ad.

update public.sadiqeltajer_residential_listings
   set active = false, deactivated_at = now()
 where id = 17956334
   and listing_url = 'https://sadiq-eltajer.sa/ads/fake-1001-2'
   and active;

insert into public.ops_adjudicated_retraction (source_table, listing_id, reason, evidence, retracted_at)
select 'sadiqeltajer_residential_listings', 17956334,
       'The platform''s own test ad (/ads/fake-1001-2, «fake - 1002»), not a property; withdrawn by the New Listings Engineer.',
       jsonb_build_object('url', 'https://sadiq-eltajer.sa/ads/fake-1001-2',
                          'page_title', 'fake - 1002',
                          'reread_run', 38916270732,
                          'backlog', 589,
                          'watched_by', 'mon_detect_adjudicated_reactivation'),
       now()
 where not exists (select 1 from public.ops_adjudicated_retraction
                    where source_table = 'sadiqeltajer_residential_listings' and listing_id = 17956334);

do $$
begin
  if exists (select 1 from public.sadiqeltajer_residential_listings where id = 17956334 and active) then
    raise exception 'test ad 17956334 is still active';
  end if;
  if not exists (select 1 from public.ops_adjudicated_listing
                  where tbl = 'sadiqeltajer_residential_listings' and listing_id = 17956334) then
    raise exception 'test ad 17956334 is not adjudicated, so auto_recover_false_inactive would revive it';
  end if;
end $$;
