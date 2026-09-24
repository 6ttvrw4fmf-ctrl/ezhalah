-- routine-3 DATA INTEGRITY, 2026-09-24. ops_incident #558 (district_contradicts_source — gathern).
--
-- THE DEFECT. gathern_residential_listings 735938 and 736377 (two units of gathern property 98313
-- in جدة) are published by the source with neighborhood «An Naim Dist.». Ezhalah served them as
-- «حي النهضة» — An Nahdah, a DIFFERENT real Jeddah district, 935 other served listings deep.
--
-- ROOT CAUSE, and it is not a translation bug. The derived store listings_arabic_locations holds
-- raw_district = 'An Nahdah Dist.' for both rows while the canonical table now says 'An Naim Dist.'
-- The two stores disagree about THE SOURCE STRING ITSELF. The canonical row is re-written by the
-- scraper on every crawl (last_seen_at 2026-09-24 04:41); the derived row is written once at first
-- resolution and nothing re-resolves it. Every platform with a refresh has a named resolver and a
-- cron job — resolve_aqar_locations (jobid 25), resolve_amlakalahsa_locations (115),
-- propagate_dealapp_resolved_locations (61). There is no resolve_gathern_locations and no job that
-- re-resolves gathern, so a gathern listing whose source neighborhood changes keeps its first
-- district for ever, and search_listings_ar serves it from that stale store.
--
-- THE MAPPING IS NOT IN DOUBT. 'An Naim Dist.' → «حي النعيم» is the mapping this same resolver
-- already applies to 57 other active gathern rows; «حي النعيم» is a catalog district with 1,593
-- served listings. Nothing is guessed here: the repair writes the value the resolver itself
-- produces for this exact raw string.
--
-- SCOPE. 197 active gathern rows currently hold a raw_district that disagrees with their canonical
-- neighborhood. For 195 of them both strings resolve to the SAME canonical district (spelling
-- variants), so nothing is contradicted and nothing is touched. Only these 2 resolve to a
-- different district, and only they are repaired. mon_detect_district_contradicts_source() already
-- watches this surface and is what surfaced them; it stays the barrier.
--
-- WHY THE GREEN CHECK BELOW IS ON THE STORE AND NOT ON mon_district_contradicts_source: that view
-- reads search_listings_ar, which sync-search-listings-ar (cron jobid 28) rewrites at :22 past the
-- hour. Inside this transaction the served index still holds the old district BY CONSTRUCTION.
-- Asserting the view here would be asserting that a job we have not run has already run. The
-- served row is verified after the next sync instead, which is where that fact actually becomes
-- true.

do $$
begin
  -- RED first: the contradiction is real, is exactly 2 rows, and is gathern's.
  if (select count(*) from public.mon_district_contradicts_source) <> 2
     or (select count(*) from public.mon_district_contradicts_source where platform = 'gathern') <> 2 then
    raise exception 'expected exactly 2 contradicting rows, all gathern, before repair';
  end if;

  -- The raw string we are about to write must be the canonical one, on both rows.
  if exists (select 1 from public.gathern_residential_listings
              where id in (735938, 736377) and neighborhood is distinct from 'An Naim Dist.') then
    raise exception 'canonical neighborhood is not An Naim Dist. — refusing to repair';
  end if;

  -- And the target district must be what the resolver already produces for that string elsewhere.
  if not exists (select 1 from public.listings_arabic_locations
                  where source_table = 'gathern_residential_listings'
                    and raw_district = 'An Naim Dist.' and district_ar = 'حي النعيم') then
    raise exception 'no existing gathern row maps An Naim Dist. to حي النعيم — refusing to guess';
  end if;
end $$;

update public.listings_arabic_locations
   set raw_district = 'An Naim Dist.',
       district_ar  = 'حي النعيم'
 where source_table = 'gathern_residential_listings'
   and listing_id in (735938, 736377)
   and raw_district = 'An Nahdah Dist.';

do $$
begin
  if (select count(*) from public.listings_arabic_locations
       where source_table = 'gathern_residential_listings'
         and listing_id in (735938, 736377)
         and raw_district = 'An Naim Dist.' and district_ar = 'حي النعيم') <> 2 then
    raise exception 'repair did not land on both rows';
  end if;

  -- The derived store now agrees with canonical truth on both rows. This is the half this
  -- migration owns; the served index follows at the next sync.
  if exists (select 1 from public.listings_arabic_locations l
               join public.gathern_residential_listings g on g.id = l.listing_id
              where l.source_table = 'gathern_residential_listings'
                and l.listing_id in (735938, 736377)
                and l.raw_district is distinct from g.neighborhood) then
    raise exception 'derived store still disagrees with canonical neighborhood';
  end if;
  raise notice 'GREEN confirmed in the derived store: both rows now carry the source district';
end $$;
