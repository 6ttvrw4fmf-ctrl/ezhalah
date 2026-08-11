-- Two facts captured at scale with NO canonical column anywhere, so they died at the mapping layer:
--
--   car_entrance   — aqar publishes it on 11,068 of the cohort's rows as real tri-state data
--                    (2,286 true / 7,838 false / rest NULL). The single largest remaining capture
--                    gap. It is NOT private_entrance: a مدخل سيارة is a vehicle entrance, a
--                    مدخل خاص is a separate pedestrian entrance to the unit. Merging them would be
--                    the concept-collapse the rules forbid, which is presumably why nobody mapped it.
--   optical_fibers — an explicit source YES on 1,514 active residential rows across 7 platforms.
--
-- Both columns exist on all 50 source tables, so the mapping is a direct read everywhere and the
-- false values aqar publishes are REAL source negatives, preserved as false (explicit no -> false).
--
-- Added to every branch mechanically: all 50 branches end with "AS deed_location_text" immediately
-- followed by FROM <table> <alias>, verified before rewriting, so the alias is captured and reused.
alter table public.search_listings_ar
  add column if not exists car_entrance   boolean,
  add column if not exists optical_fibers boolean;

do $$
declare def text; n int;
begin
  select pg_get_viewdef('public.listing_rich_attrs'::regclass, true) into def;

  n := (select count(*) from regexp_matches(def, 'AS deed_location_text\s+FROM [a-z0-9_]+ [a-z]+', 'g'));
  if n <> 50 then
    raise exception 'expected 50 branch tails, found % - view shape changed, refusing to guess', n;
  end if;
  if position('car_entrance' in def) > 0 then
    raise exception 'car_entrance already present in the view';
  end if;

  def := regexp_replace(def,
    'AS deed_location_text(\s+FROM ([a-z0-9_]+) ([a-z]+))',
    E'AS deed_location_text,\n    \\3.car_entrance,\n    \\3.optical_fibers\\1',
    'g');

  n := (select count(*) from regexp_matches(def, '\.car_entrance,', 'g'));
  if n <> 50 then
    raise exception 'rewrote % branches, expected 50', n;
  end if;

  execute 'create or replace view public.listing_rich_attrs as ' || def;

  if (select count(*) from (select 1 from public.listing_rich_attrs
        group by source_table, listing_id having count(*) > 1) q) > 0 then
    raise exception 'duplicate keys after rewrite';
  end if;
end $$;
