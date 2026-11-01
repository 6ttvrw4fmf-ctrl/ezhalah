-- Floor 10 → 5 ads. After 20261020002310's first strip, sakan still held its Jeddah centre
-- (21.485811,39.19250 — 9 ads tagged with 4 districts: الرياض، الصوارى، الفيصلية، المروة) and bossbih
-- two points at 9 ads / 4 districts each. Three or more districts on one coordinate already
-- proves it is not those ads' pin; the ad floor only keeps a coincidence (two agents, one
-- building, mis-tagged districts) from registering a real point, and 5 is enough for that.
create or replace function public.shared_default_pins(p_min_ads int default 5, p_min_districts int default 3)
returns table(source_table text, platform text, lat numeric, lng numeric, ads bigint, districts bigint)
language sql stable as $$
  select s.source_table, s.platform,
         round(s.latitude::numeric, 5), round(s.longitude::numeric, 5),
         count(*), count(distinct s.district_ar)
    from public.search_listings_ar s
   where s.latitude is not null and s.longitude is not null and s.district_ar is not null
   group by 1, 2, 3, 4
  having count(*) >= p_min_ads and count(distinct s.district_ar) >= p_min_districts
   order by 5 desc;
$$;

do $proof$
declare before_n int; after_n int; stripped int;
begin
  select count(*) into before_n from public.ops_default_pin_register;
  stripped := public.strip_shared_default_pins();
  select count(*) into after_n from public.ops_default_pin_register;
  if after_n <= before_n then raise exception 'PROOF: the lower floor registered nothing new (% → %)', before_n, after_n; end if;
  if (select count(*) from public.shared_default_pins_unfixed()) <> 0 then raise exception 'PROOF: points still stored after the strip'; end if;
  raise notice 'floor 5: register % → %, stripped % rows', before_n, after_n, stripped;
end
$proof$;
