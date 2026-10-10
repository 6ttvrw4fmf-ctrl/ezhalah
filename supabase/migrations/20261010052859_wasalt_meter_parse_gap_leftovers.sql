-- wasalt_meter_parse_gap leftovers (2026-10-10): 7,403 active wasalt rows state electricityMeter /
-- waterMeter Yes/No in their own additional_info while separate_*_meter is NULL. All were scraped
-- 2026-08-09 .. 2026-09-06, i.e. detail-enriched before scrapers/wasalt/enrich.py learned
-- meter_fields_from_deep() (2026-09-04); every row enriched since carries the columns, so the gap is
-- historical, not recurring. Same tri-state rule as run.py _yes_no(): yes -> true, no -> false,
-- anything else -> left NULL. Fills NULLs only; never overwrites a known value.
-- Not land services: electricity / water_supply stay land-only (20261010051214).
with v as (
  select r.id,
         case (select lower(btrim(e->>'value')) from jsonb_array_elements(r.additional_info) e
                where e->>'key' = 'electricityMeter' limit 1)
           when 'yes' then true when 'no' then false end as em,
         case (select lower(btrim(e->>'value')) from jsonb_array_elements(r.additional_info) e
                where e->>'key' = 'waterMeter' limit 1)
           when 'yes' then true when 'no' then false end as wm
    from public.wasalt_residential_listings r
   where jsonb_typeof(r.additional_info) = 'array'
     and (r.separate_electricity_meter is null or r.separate_water_meter is null)
)
update public.wasalt_residential_listings r
   set separate_electricity_meter = coalesce(r.separate_electricity_meter, v.em),
       separate_water_meter       = coalesce(r.separate_water_meter, v.wm)
  from v
 where r.id = v.id
   and ((r.separate_electricity_meter is null and v.em is not null)
        or (r.separate_water_meter is null and v.wm is not null));

do $c$
declare bad int;
begin
  select count(*) into bad from public.wasalt_residential_listings r
   where r.active and r.separate_electricity_meter is null and jsonb_typeof(r.additional_info) = 'array'
     and exists (select 1 from jsonb_array_elements(r.additional_info) e
                  where e->>'key' = 'electricityMeter' and lower(btrim(e->>'value')) in ('yes','no'));
  if bad > 0 then raise exception 'meter gap check: % rows still state a meter with the column NULL', bad; end if;
end $c$;
