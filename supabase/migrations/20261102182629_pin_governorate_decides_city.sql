-- THE AD'S OWN PIN DECIDES ITS CITY WHEN THE CITY LABEL IS IN ANOTHER GOVERNORATE (backlog 1166, owner 2026-11-02:
-- «fix the wrong city ones, make sure they ALL match»).
--
-- Root cause, proven on the four handed-over examples: every source hands us a CITY LABEL that can be coarse — haraj
-- takes the REGA deed's «المدينة» (11190323049: deed «أبها», pin and title in بارق), aqar its own city field
-- (6923329: field «الحناكية», pin in الصويدرة inside محافظة المدينة المنورة, title «مدينة المدينة المنورة») — and the
-- location resolver (listing_native_location_v2) trusted the label even when the ad's own map pin sat in another
-- governorate. The judge is the OpenStreetMap governorate boundary (place_shapes kind='city', admin_level 6), never
-- free text alone:
--   * a city's governorate = the boundary named after it (seat) or, for a town that is not a seat, the boundary
--     holding ≥ 60 % of its own ads' pins;
--   * an ad is MISFILED only when its pin lies outside its city's governorate (1.5 km border tolerance);
--   * it is CORRECTED only when its own title or URL names exactly one city of the governorate the pin is in
--     (two independent source signals — pin + words). Region phrases («منطقة مكة المكرمة» in aqar URLs) never count;
--   * a smaller town inside the same governorate is never "corrected" (6838967: ثول inside محافظة جدة stays ثول);
--   * the district moves WITH the city: the title's «حي X» when X is on the new city's official list (and is not the
--     town's own name), else the OSM district polygon under the pin when it is on that list, else NULL — never the
--     old city's district.
-- Everything else stays as the source filed it and is recorded 'unfixable' for the detector. Corrections go through
-- the existing override table listing_city_correction (city_source 'pin_governorate'); every decision keeps its basis
-- in listing_city_pin_evidence. Source tables are untouched (SOURCE IS TRUTH: we choose between the source's own
-- signals, we never invent one).

create table if not exists public.loc_gov_shape_sub (
  gov_shape_id bigint not null,
  gov_ar text not null,
  gov_norm text not null,
  region_id integer,
  built_at timestamptz not null default now(),
  geom extensions.geometry(Polygon, 4326) not null
);
create index if not exists loc_gov_shape_sub_gix on public.loc_gov_shape_sub using gist (geom);
create index if not exists loc_gov_shape_sub_gov_idx on public.loc_gov_shape_sub (gov_shape_id);
alter table public.loc_gov_shape_sub enable row level security;
revoke all on public.loc_gov_shape_sub from anon, authenticated;
comment on table public.loc_gov_shape_sub is 'OSM governorate boundaries (place_shapes kind=city) cut into small indexed pieces so a pin finds its governorate fast. Rebuilt by refresh_gov_shape_sub().';

create table if not exists public.listing_city_pin_evidence (
  source_table text not null,
  listing_id bigint not null,
  verdict text not null check (verdict in ('fixed', 'unfixable')),
  from_city_id integer,
  from_city_ar text,
  to_city_id integer,
  to_city_ar text,
  to_district_norm text,
  district_basis text,
  title_word text,
  pin_lat double precision,
  pin_lon double precision,
  pin_gov_ar text,
  own_gov_ar text,
  first_seen_at timestamptz not null default now(),
  decided_at timestamptz not null default now(),
  primary key (source_table, listing_id)
);
alter table public.listing_city_pin_evidence enable row level security;
revoke all on public.listing_city_pin_evidence from anon, authenticated;
comment on table public.listing_city_pin_evidence is 'Why each pin-governorate city decision was made (backlog 1166): the pin, both governorates, the title word that named the new city, and how the district was chosen.';

create or replace function public.refresh_gov_shape_sub()
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare n integer;
begin
  delete from public.loc_gov_shape_sub;
  insert into public.loc_gov_shape_sub (gov_shape_id, gov_ar, gov_norm, region_id, geom)
  select g.id, g.name_ar, normalize_ar(regexp_replace(g.name_ar, '^محافظة\s+', '')),
         (select cr.region_id from public.place_shapes r join public.loc_catalog_region cr on cr.region_ar = r.name_ar
           where r.kind = 'region' and st_contains(r.geom, st_pointonsurface(g.geom)) limit 1),
         (st_dump(st_subdivide(g.geom, 96))).geom
    from public.place_shapes g
   where g.kind = 'city' and g.name_ar is not null;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.refresh_pin_city_correction(p_apply boolean default true)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_pinned bigint; v_flagged bigint; v_fixed bigint; v_unfixable bigint; v_dropped bigint := 0;
  v_st text; v_ids bigint[]; v_region_rx text;
begin
  if not exists (select 1 from public.loc_gov_shape_sub)
     or (select max(updated_at) from public.place_shapes where kind = 'city') > (select min(built_at) from public.loc_gov_shape_sub) then
    perform public.refresh_gov_shape_sub();
  end if;

  -- every served, pinned ad and the governorate its pin is in
  create temp table _pin on commit drop as
  select s.source_table, s.listing_id, s.city_id, s.city_ar,
         s.latitude::float8 as lat, s.longitude::float8 as lon,
         st_setsrid(st_makepoint(s.longitude::float8, s.latitude::float8), 4326) as pt,
         gs.gov_shape_id as gid, gs.gov_ar
    from public.search_listings_ar s
    left join lateral (select g.gov_shape_id, g.gov_ar from public.loc_gov_shape_sub g
                        where st_intersects(g.geom, st_setsrid(st_makepoint(s.longitude::float8, s.latitude::float8), 4326))
                        limit 1) gs on true
   where s.production_ready and s.city_id is not null
     and s.latitude between 16 and 33 and s.longitude between 34 and 56;
  get diagnostics v_pinned = row_count;
  -- judge the SOURCE's city, not one we already corrected (otherwise a fix would undo itself next run)
  update _pin p set city_id = e.from_city_id, city_ar = e.from_city_ar
    from public.listing_city_pin_evidence e
   where e.source_table = p.source_table and e.listing_id = p.listing_id and e.verdict = 'fixed';

  -- each catalogue city's governorate: the boundary named after it (seat), else where ≥ 60 % of its own pins are
  create temp table _gov on commit drop as
  select distinct gov_shape_id as gid, gov_ar, gov_norm, region_id from public.loc_gov_shape_sub;
  create temp table _cg on commit drop as
  with share as (
    select city_id, gid, count(*) n, sum(count(*)) over (partition by city_id) tot
      from _pin where gid is not null group by 1, 2),
  seat as (
    select c.city_id, g.gid, 'seat'::text as basis
      from public.loc_catalog_city c join _gov g on g.gov_norm = c.city_norm and g.region_id = c.region_id
     where c.retired_at is null),
  maj as (
    select distinct on (city_id) city_id, gid, 'pin_majority'::text as basis
      from share where tot >= 10 and n >= 0.6 * tot order by city_id, n desc)
  select * from seat
  union all
  select m.* from maj m where not exists (select 1 from seat s where s.city_id = m.city_id);

  -- misfiled: the pin is in a governorate, and not within 1.5 km of the ad's own city's governorate
  create temp table _flag on commit drop as
  select p.*, own.gid as own_gid, (select gov_ar from _gov where gid = own.gid) as own_gov_ar
    from _pin p
    join _cg own on own.city_id = p.city_id
   where p.gid is not null and p.gid <> own.gid
     and not exists (select 1 from public.loc_gov_shape_sub g
                      where g.gov_shape_id = own.gid and st_dwithin(g.geom, p.pt, 0.015))
     and not exists (select 1 from public.listing_city_correction x
                      where x.source_table = p.source_table and x.listing_id = p.listing_id
                        and x.city_source <> 'pin_governorate');
  get diagnostics v_flagged = row_count;

  -- the ad's own words: title + URL, cleaned to Arabic letters, with region phrases removed
  create temp table _txt (source_table text, listing_id bigint, txt text) on commit drop;
  for v_st in select distinct source_table from _flag loop
    select array_agg(listing_id) into v_ids from _flag where source_table = v_st;
    execute format('insert into _txt select %L, t.id, coalesce(t.title, '''') || '' '' || coalesce(t.listing_url, '''') from public.%I t where t.id = any($1)', v_st, v_st)
      using v_ids;
  end loop;
  select '(' || string_agg(regexp_replace(normalize_ar(regexp_replace(region_ar, '^(منطقة|المنطقة)\s+', '')), '[^ء-ي]+', ' ', 'g'), '|') || ')'
    into v_region_rx from public.loc_catalog_region;
  update _txt set txt = ' ' || btrim(regexp_replace(
           regexp_replace(regexp_replace(normalize_ar(replace(replace(txt, '-', ' '), '_', ' ')), '[^ء-ي]+', ' ', 'g'),
                          '(منطقه|المنطقه) ' || v_region_rx, ' ', 'g'),
           '\s+', ' ', 'g')) || ' ';

  -- candidate cities: in the PIN's governorate and named in the ad's own words
  create temp table _cand on commit drop as
  select f.source_table, f.listing_id, c.city_id, c.city_ar, cg.basis,
         regexp_replace(c.city_norm, '[^ء-ي]+', ' ', 'g') as word
    from _flag f
    join _txt t on t.source_table = f.source_table and t.listing_id = f.listing_id
    join _cg cg on cg.gid = f.gid
    join public.loc_catalog_city c on c.city_id = cg.city_id and c.retired_at is null
   where c.city_id <> f.city_id
     and length(c.city_norm) >= 3
     and position(' ' || regexp_replace(c.city_norm, '[^ء-ي]+', ' ', 'g') || ' ' in t.txt) > 0;

  create temp table _pick on commit drop as
  select distinct on (source_table, listing_id) source_table, listing_id, city_id, city_ar, word
    from (select k.*, count(distinct k.city_id) over (partition by k.source_table, k.listing_id) n_city,
                 count(*) filter (where k.basis = 'seat') over (partition by k.source_table, k.listing_id) n_seat
            from _cand k) z
   where n_city = 1 or (n_seat = 1 and basis = 'seat')
   order by source_table, listing_id, (basis = 'seat') desc, length(word) desc;

  -- the district moves with the city: «حي X» in the title on the new city's list, else the OSM district under the pin
  create temp table _dist on commit drop as
  with t as (
    select k.source_table, k.listing_id, k.city_id, d.district_norm
      from _pick k
      join _txt x on x.source_table = k.source_table and x.listing_id = k.listing_id
      cross join lateral (select distinct m[1] as w from regexp_matches(x.txt, ' حي ((?:[ء-ي]+ )?[ء-ي]+)(?= )', 'g') m) h
      join public.loc_catalog_district d
        on d.city_id = k.city_id and d.retired_at is null
       and d.district_norm in (norm_district_tok('حي ' || h.w), norm_district_tok('حي ' || split_part(h.w, ' ', 1)))
     where d.district_norm <> norm_district_tok(k.city_ar)),
  tu as (select source_table, listing_id, min(district_norm) dn from t group by 1, 2 having count(distinct district_norm) = 1),
  o as (
    select k.source_table, k.listing_id, min(d.district_norm) dn
      from _pick k
      join _flag f on f.source_table = k.source_table and f.listing_id = k.listing_id
      join public.place_shapes ps on ps.kind = 'district' and st_contains(ps.geom, f.pt)
      join public.loc_catalog_district d
        on d.city_id = k.city_id and d.retired_at is null and d.district_norm = norm_district_tok(ps.name_ar)
     where d.district_norm <> norm_district_tok(k.city_ar)
     group by 1, 2 having count(distinct d.district_norm) = 1)
  select k.source_table, k.listing_id,
         coalesce(tu.dn, o.dn) as district_norm,
         case when tu.dn is not null then 'title_hay_on_city_list'
              when o.dn is not null then 'pin_osm_district_on_city_list'
              else 'none_left_null' end as basis
    from _pick k
    left join tu on tu.source_table = k.source_table and tu.listing_id = k.listing_id
    left join o on o.source_table = k.source_table and o.listing_id = k.listing_id;

  -- record every decision with its basis
  insert into public.listing_city_pin_evidence as e
    (source_table, listing_id, verdict, from_city_id, from_city_ar, to_city_id, to_city_ar, to_district_norm,
     district_basis, title_word, pin_lat, pin_lon, pin_gov_ar, own_gov_ar, decided_at)
  select f.source_table, f.listing_id, case when k.city_id is not null then 'fixed' else 'unfixable' end,
         f.city_id, f.city_ar, k.city_id, k.city_ar, d.district_norm, d.basis, k.word,
         f.lat, f.lon, f.gov_ar, f.own_gov_ar, now()
    from _flag f
    left join _pick k on k.source_table = f.source_table and k.listing_id = f.listing_id
    left join _dist d on d.source_table = f.source_table and d.listing_id = f.listing_id
  on conflict (source_table, listing_id) do update set
    verdict = excluded.verdict, from_city_id = excluded.from_city_id, from_city_ar = excluded.from_city_ar,
    to_city_id = excluded.to_city_id, to_city_ar = excluded.to_city_ar, to_district_norm = excluded.to_district_norm,
    district_basis = excluded.district_basis, title_word = excluded.title_word, pin_lat = excluded.pin_lat,
    pin_lon = excluded.pin_lon, pin_gov_ar = excluded.pin_gov_ar, own_gov_ar = excluded.own_gov_ar,
    decided_at = excluded.decided_at;
  -- an ad that no longer qualifies (left the index, pin moved, source fixed itself) loses its decision
  delete from public.listing_city_pin_evidence e
   where not exists (select 1 from _flag f where f.source_table = e.source_table and f.listing_id = e.listing_id);

  select count(*) filter (where verdict = 'fixed'), count(*) filter (where verdict = 'unfixable')
    into v_fixed, v_unfixable from public.listing_city_pin_evidence;

  if p_apply then
    insert into public.listing_city_correction (source_table, listing_id, city_id, city_source, district_norm)
    select e.source_table, e.listing_id, e.to_city_id, 'pin_governorate', e.to_district_norm
      from public.listing_city_pin_evidence e where e.verdict = 'fixed'
    on conflict (source_table, listing_id) do update
      set city_id = excluded.city_id, district_norm = excluded.district_norm, corrected_at = now()
      where public.listing_city_correction.city_source = 'pin_governorate';
    delete from public.listing_city_correction x
     where x.city_source = 'pin_governorate'
       and not exists (select 1 from public.listing_city_pin_evidence e
                        where e.source_table = x.source_table and e.listing_id = x.listing_id and e.verdict = 'fixed');
    get diagnostics v_dropped = row_count;
  end if;

  return jsonb_build_object('pinned', v_pinned, 'flagged', v_flagged, 'fixed', v_fixed, 'unfixable', v_unfixable,
                            'dropped', v_dropped, 'applied', p_apply);
end $$;

revoke all on function public.refresh_gov_shape_sub() from public, anon, authenticated;
revoke all on function public.refresh_pin_city_correction(boolean) from public, anon, authenticated;
