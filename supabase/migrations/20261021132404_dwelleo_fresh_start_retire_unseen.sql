-- Dwelleo fresh start: retire every row today's full walk did not see (owner 2026-10-21: «Let's delete …
-- start dwello from scratch … want it live»). Switched OFF and adjudicated, never hard-deleted, so it can be
-- undone and auto_recover_false_inactive() cannot read it as an accident (AGENTS.md: hiding is a two-part act).
--
-- Evidence, run 39595359873 (2026-10-21 11:54 UTC, merged code): the catalogue API enumerated 6,330 of its
-- 6,331; the site's own sitemaps/properties.xml lists 3,644 public pages; 3,543 rows were upserted
-- (3,188 residential + 355 commercial), 2,686 API records with no public page were skipped (their card would
-- open a 404). The prune guard kept the old rows because a 30% re-sight looks like a collapse — which is the
-- guard working. The rows left behind (last_seen_at before the walk) are Dwelleo ids that are NOT in the
-- current catalogue at all (rows are keyed by Dwelleo's own id, so a live ad would have been re-seen); they are
-- the pre-2026-10-07-outage catalogue on retired /ar/properties/<slug> URLs (sampled 2026-10-21: 1 answered
-- 404, 4 redirect away). 100 of 100 random rows the walk DID see open with HTTP 200.
with gone as (
  select 'dwelleo_residential_listings'::text tbl, id from public.dwelleo_residential_listings
   where active and last_seen_at < '2026-10-21 11:50:00+00'
  union all
  select 'dwelleo_commercial_listings', id from public.dwelleo_commercial_listings
   where active and last_seen_at < '2026-10-21 11:50:00+00')
insert into public.ops_adjudicated_retraction (source_table, listing_id, reason, evidence)
select g.tbl, g.id,
       'dwelleo fresh start (owner 2026-10-21): not in the full 2026-10-21 walk of its catalogue API + sitemap; '
       || 'pre-outage row whose page no longer exists. Switched off, kept in the table.',
       jsonb_build_object('run', 39595359873, 'api_enumerated', 6330, 'sitemap_pages', 3644,
                          'upserted', 3543, 'walk_started', '2026-10-21T11:54:30Z')
  from gone g
 where not exists (select 1 from public.ops_adjudicated_retraction j where j.source_table = g.tbl and j.listing_id = g.id);

update public.dwelleo_residential_listings set active = false
 where active and last_seen_at < '2026-10-21 11:50:00+00';
update public.dwelleo_commercial_listings set active = false
 where active and last_seen_at < '2026-10-21 11:50:00+00';

do $proof$
declare left_stale int; fresh int; unregistered int;
begin
  select count(*) into left_stale from public.dwelleo_residential_listings where active and last_seen_at < '2026-10-21 11:50:00+00';
  select count(*) into fresh from public.dwelleo_residential_listings where active;
  select count(*) into unregistered from public.dwelleo_residential_listings t
   where not t.active and t.last_seen_at < '2026-10-21 11:50:00+00' and t.deactivated_at > now() - interval '5 minutes'
     and not exists (select 1 from public.ops_adjudicated_retraction j where j.source_table = 'dwelleo_residential_listings' and j.listing_id = t.id);
  if left_stale > 0 then raise exception 'PROOF: % stale dwelleo rows still active', left_stale; end if;
  if fresh < 3000 then raise exception 'PROOF: only % fresh rows left active — the walk did not land', fresh; end if;
  if unregistered > 0 then raise exception 'PROOF: % switched-off rows are not adjudicated', unregistered; end if;
end $proof$;
