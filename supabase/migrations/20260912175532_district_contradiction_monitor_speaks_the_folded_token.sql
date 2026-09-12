-- mon_district_contradicts_source compared source vs display through its OWN inline copy of the
-- PRE-FOLD token logic (normalize_ar + strip 'حي '/'ال' — it even predates the #114 repeated-prefix
-- widening). After the district identity fold (20260912172542, owner 2026-09-12) that copy
-- false-accused the canonical label of the SAME district: 9 gathern rows, source «شفاء» displayed
-- «حي الشفا» — fold-equal, zero genuine contradictions (proven live 2026-09-12 before this change).
-- One token fn = one identity: the view now asks norm_district_tok, like every other layer.
create or replace view public.mon_district_contradicts_source as
select s.source_table, s.listing_id, s.platform, s.city_ar,
       sd.source_district_ar as source_says,
       s.district_ar as we_display
from public.search_listings_ar s
join public.listing_source_district_ar sd
  on sd.source_table = s.source_table and sd.listing_id = s.listing_id
where s.district_ar is not null
  and public.norm_district_tok(s.district_ar) <> public.norm_district_tok(sd.source_district_ar);

-- The live source-truth barrier's coverage check divided by ALL of listing_source_district_ar —
-- a snapshot that keeps retired listings forever. 4,123 of its 33,704 rows are gone from the
-- index (gathern 3-strike drainage), capping the ratio at 87.8% — the 90% floor became
-- unpassable no matter how good resolution is (live-row coverage is 97.9%). This view gives the
-- barrier the honest cohort: live gathern rows that PUBLISH a source district.
create or replace view public.mon_gathern_district_coverage as
select
  count(*) filter (where s.district_ar is not null) as covered,
  count(*) as with_source_live
from public.search_listings_ar s
join public.listing_source_district_ar sd
  on sd.source_table = s.source_table and sd.listing_id = s.listing_id
where s.platform = 'gathern';
grant select on public.mon_gathern_district_coverage to anon, authenticated;

do $$
declare v int; c record;
begin
  select count(*) into v from public.mon_district_contradicts_source;
  if v <> 0 then
    raise exception 'view still reports % contradiction(s) after the token unification - inspect before shipping', v;
  end if;
  -- discrimination: the 2026-08-10 class (a genuinely DIFFERENT district displayed) must still be
  -- visible through the new comparison - the fold must not have blinded the monitor.
  if public.norm_district_tok('حي الظاهرة') = public.norm_district_tok('حي الزهرة') then
    raise exception 'norm_district_tok merged الظاهرة/الزهرة - the view would go blind to the 2026-08-10 class';
  end if;
  v := public.mon_detect_district_contradicts_source();
  if v <> 0 then
    raise exception 'mon_detect_district_contradicts_source still raising (%) after the view fix', v;
  end if;
  select * into c from public.mon_gathern_district_coverage;
  if c.with_source_live < 1000 or c.covered * 100 < c.with_source_live * 90 then
    raise exception 'live gathern coverage unexpectedly poor: %/% - the honest cohort should clear 90%%',
      c.covered, c.with_source_live;
  end if;
end $$;