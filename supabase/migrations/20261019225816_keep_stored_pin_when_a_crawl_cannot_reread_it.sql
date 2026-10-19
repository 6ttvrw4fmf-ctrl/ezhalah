-- A crawl that could not re-read an ad's pin must not erase the pin it already stored.
--
-- Owner 2026-10-19 («fix the ones we don't get a pin … make sure every new listing gets the pin»).
-- Measured the same night: aqalemhajer's 448 backfilled pins (additional_info.latitude/longitude,
-- resolved from its maps.app.goo.gl links) dropped to 102 on the next crawl (run 39337109406)
-- because the goo.gl hop failed from the runner and the upsert rewrote additional_info without the
-- pair. That is the FETCH-layer shape of «unknown must not overwrite known» (AGENTS.md: a failed
-- fetch is not an empty answer), applied to one jsonb key the index reads
-- (listing_rich_attrs → search_listings_ar.latitude).
--
-- Scope: the three office sites whose pin is a short link the runner may not be able to follow.
-- The trigger only fills a MISSING pair from OLD; a pair the crawl did read always wins, and an ad
-- the source deactivates is untouched (active=false is a different column).
create or replace function public.tg_keep_stored_pin() returns trigger
language plpgsql as $$
begin
  if (new.additional_info ->> 'latitude') is null
     and (old.additional_info ->> 'latitude') is not null
     and (old.additional_info ->> 'longitude') is not null then
    new.additional_info := coalesce(new.additional_info, '{}'::jsonb)
      || jsonb_build_object('latitude',  (old.additional_info -> 'latitude'),
                            'longitude', (old.additional_info -> 'longitude'));
  end if;
  return new;
end $$;

comment on function public.tg_keep_stored_pin() is
  'BEFORE UPDATE: a row whose new additional_info carries no latitude/longitude keeps the pair it already had (owner 2026-10-19; a failed goo.gl hop must not erase a stored pin).';

drop trigger if exists keep_stored_pin on public.aqalemhajer_residential_listings;
create trigger keep_stored_pin before update on public.aqalemhajer_residential_listings
  for each row execute function public.tg_keep_stored_pin();
drop trigger if exists keep_stored_pin on public.abralosol_residential_listings;
create trigger keep_stored_pin before update on public.abralosol_residential_listings
  for each row execute function public.tg_keep_stored_pin();
drop trigger if exists keep_stored_pin on public.bossbih_residential_listings;
create trigger keep_stored_pin before update on public.bossbih_residential_listings
  for each row execute function public.tg_keep_stored_pin();
