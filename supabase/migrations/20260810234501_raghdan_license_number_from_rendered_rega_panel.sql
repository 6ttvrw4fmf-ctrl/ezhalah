-- Raghdan renders a REGA ad-licence («رقم ترخيص الإعلان») on every detail page. The scraper never
-- read it, so this branch was pinned to NULL and raghdan showed 0 licences on all 71 searchable
-- annual-rent apartments. The 2026-08-11 crawl found the panel on 336 of 339 active listings.
--
-- The AD licence only. «رقم رخصة الوساطة» is the brokerage's own company licence and is IDENTICAL
-- on every raghdan listing (1200029439); mapping it here would stamp one company's registration
-- onto every ad as if each had its own. Two different licences, kept apart.
--
-- LITERAL block replacement, not a regex span. A first attempt used
-- 'NULL::text AS license_number,(.*?)FROM raghdan_..._listings x' and its own post-condition
-- rejected it: a lazy .*? starts at the EARLIEST such line anywhere in the view and runs across
-- other platforms' branches, so it would have moved someone else's licence column. The exact
-- column list below can only match the raghdan branches.
do $$
declare def text; before int; after int; res text; com text;
begin
  select pg_get_viewdef('public.listing_extra_attrs'::regclass, true) into def;
  before := (select count(*) from regexp_matches(def, 'rega_ad_license_number', 'g'));

  res := E'NULL::text AS license_number,\n    x.elevator,\n    x.parking,\n    x.kitchen,\n'
      || E'    x.air_conditioner,\n    x.maid_room,\n    x.driver_room,\n    x.private_entrance\n'
      || E'   FROM raghdan_residential_listings x';
  com := replace(res, 'raghdan_residential_listings', 'raghdan_commercial_listings');

  if position(res in def) = 0 or position(com in def) = 0 then
    raise exception 'raghdan branch text not found verbatim - view shape changed, refusing to guess';
  end if;

  def := replace(def, res, replace(res, 'NULL::text AS license_number',
    'NULLIF(btrim(COALESCE(x.additional_info ->> ''rega_ad_license_number''::text, ''''::text)), ''''::text) AS license_number'));
  def := replace(def, com, replace(com, 'NULL::text AS license_number',
    'NULLIF(btrim(COALESCE(x.additional_info ->> ''rega_ad_license_number''::text, ''''::text)), ''''::text) AS license_number'));

  after := (select count(*) from regexp_matches(def, 'rega_ad_license_number', 'g'));
  if after <> before + 2 then
    raise exception 'expected exactly 2 new licence expressions (% -> %), got %', before, before + 2, after;
  end if;

  execute 'create or replace view public.listing_extra_attrs as ' || def;
end $$;
