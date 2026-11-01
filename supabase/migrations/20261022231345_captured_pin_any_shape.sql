-- The «pin we hold but never show» alarm saw ONE shape: a "lat"/"latitude" JSON key. On 2026-10-22 a sweep
-- found ~110 such ads it could not see, on 10 sites, every one a Maps link / place marker kept in another field
-- (map_location, map_url, address, the ad text, a cut Haraj deed copy …). It now reads every shape the fixes
-- read — a JSON key pair, or the first COMPLETE Maps link / place marker (pin_from_maps_text) — and keeps the
-- same exclusions: the far register, the default register, and a point shared by ≥10 ads in ≥3 districts.
set local statement_timeout = '5min';

create or replace function public.captured_pin_not_served(p_table text)
returns table(hits bigint, example_listing_id bigint, example_pin text)
language plpgsql stable set search_path to 'public' as $function$
begin
  return query execute format($q$
    with s as (
      select s.listing_id, s.district_ar, j,
             (regexp_match(j, '"(?:lat|latitude)"\s*:\s*"?((?:1[6-9]|2[0-9]|3[0-2])\.[0-9]{3,})'))[1]::numeric kla,
             (regexp_match(j, '"(?:lng|lon|long|longitude)"\s*:\s*"?((?:3[4-9]|4[0-9]|5[0-6])\.[0-9]{3,})'))[1]::numeric klo
        from public.search_listings_ar s
        join public.%1$I x on x.id = s.listing_id
        cross join lateral (select to_jsonb(x)::text j) jj
       where s.source_table = %1$L and s.production_ready and s.latitude is null
         and not exists (select 1 from public.ops_far_pin_register f where f.source_table = %1$L and f.listing_id = s.listing_id)),
    p as (
      select listing_id, district_ar,
             coalesce(kla, (public.pin_from_maps_text(j) ->> 'latitude')::numeric) la,
             coalesce(klo, (public.pin_from_maps_text(j) ->> 'longitude')::numeric) lo
        from s),
    q as (select * from p where la is not null and lo is not null),
    shared as (select round(la,4) a, round(lo,4) b from q group by 1,2 having count(*) >= 10 and count(distinct district_ar) >= 3),
    near_shared as (select round(la,3) a, round(lo,3) b from q group by 1,2 having count(distinct district_ar) >= 2),
    real as (select q.* from q
              where not exists (select 1 from shared where shared.a = round(q.la,4) and shared.b = round(q.lo,4))
                and not exists (select 1 from near_shared n where n.a = round(q.la,3) and n.b = round(q.lo,3))
                and not exists (select 1 from public.ops_default_pin_register d
                                 where abs(d.lat::numeric - q.la) < 0.0005 and abs(d.lng::numeric - q.lo) < 0.0005))
    select count(*)::bigint, min(listing_id)::bigint, min(la || ',' || lo) from real$q$, p_table);
end $function$;

-- …and it raises from 3 such ads on one table, not 10: on 2026-10-22 single sites held 5, 6, 11 and 17 missed
-- pins, each invisible under the old floor. A coordinate proven not to be the ad's pin goes in
-- ops_captured_pin_waiver with evidence, never a higher floor.
do $m$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_detect_captured_pin_not_served()'::regprocedure);
  if position('if r.hits >= 3 then' in src) > 0 then return; end if;
  out_def := replace(src, 'if r.hits >= 10 then', 'if r.hits >= 3 then');
  if out_def = src then raise exception 'detector anchor not found'; end if;
  execute out_def;
end $m$;

do $proof$
declare h bigint; t text; worst bigint := 0; worst_t text;
begin
  select hits into h from public.captured_pin_not_served('eilmalriyada_residential_listings');
  if h <> 0 then raise exception 'PROOF: % eilmalriyada pins still held and not shown after the fix', h; end if;
  for t in select source_table from public.search_listings_ar where production_ready and latitude is null group by 1 loop
    select hits into h from public.captured_pin_not_served(t);
    if h > worst then worst := h; worst_t := t; end if;
  end loop;
  if worst >= 3 then raise exception 'PROOF: % still holds % pins it does not show', worst_t, worst; end if;
end $proof$;
