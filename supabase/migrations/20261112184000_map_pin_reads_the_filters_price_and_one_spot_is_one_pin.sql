-- THE PIN SAYS THE PRICE THE CARD SAYS, AND ONE SPOT IS ONE PIN (owner 2026-11-12, photos from الجلة: «it says سعر عند
-- الطلب when I click I see the price … didn't u fix the pins already if same listing»).
--   1. A sale pin read `price_total`; the Filter, the card and the search all read `price_total_effective`. 7,817 sale
--      ads on the map have only the per-metre price (e.g. haraj 19063138: 1,000 SAR/m² × 10,255 m² = 10,255,000), so
--      their pin said «السعر عند الطلب» over a priced card, and the map's price filter dropped them. The pins' view
--      now carries price_total_effective and every map read (map_pins_ar ×4, map_posted_window_counts_ar,
--      map_nopin_refresh_ar ×2) reads coalesce(price_total_effective, price_total) — the Filter's own column.
--   2. A spot is grouped by its coordinates rounded to 6 decimals (~0.1 m). Haraj stored 24.333833307351 and dealapp
--      24.333833307351153 for the SAME point, so the exact-equality group drew two pins on one spot. Same point, one
--      pin; points that really differ (even by a metre) still get their own pin (owner 2026-11-10 rule).
-- No signature changes: create or replace keeps every grant.
do $v$
declare v text; v2 text;
begin
  v := pg_get_viewdef('public.map_listing_points_ar'::regclass, true);
  v2 := replace(v, 's.posted_at' || chr(10), 's.posted_at,' || chr(10) || '    s.price_total_effective' || chr(10));
  if (length(v2) - length(v)) <> 2 * length(',' || chr(10) || '    s.price_total_effective') then
    raise exception 'map_listing_points_ar: unexpected shape (delta %)', length(v2) - length(v);
  end if;
  execute 'create or replace view public.map_listing_points_ar as ' || v2;
end
$v$;

do $mig$
declare v text; v2 text; n int;
  old_price constant text := 'then s.price_total else s.price_annual end as price';
  new_price constant text := 'then coalesce(s.price_total_effective, s.price_total) else s.price_annual end as price';
  old_ll constant text := 'coalesce(snap.lat, s.latitude::double precision) la, coalesce(snap.lng, s.longitude::double precision) lo';
  new_ll constant text := 'round(coalesce(snap.lat, s.latitude::double precision)::numeric, 6)::double precision la, round(coalesce(snap.lng, s.longitude::double precision)::numeric, 6)::double precision lo';
  pins constant text := 'public.map_pins_ar(double precision,double precision,double precision,double precision,double precision,text[],jsonb,integer,text,text[],integer[],integer,integer,numeric,numeric,boolean,text[],text[],text[],text,integer)';
begin
  -- map_pins_ar: 4 price reads, 3 exact-spot reads
  v := pg_get_functiondef(pins::regprocedure);
  n := (length(v) - length(replace(v, old_price, ''))) / length(old_price);
  if n <> 4 then raise exception 'map_pins_ar: expected 4 price reads, found %', n; end if;
  n := (length(v) - length(replace(v, old_ll, ''))) / length(old_ll);
  if n <> 3 then raise exception 'map_pins_ar: expected 3 exact-spot reads, found %', n; end if;
  v2 := replace(replace(v, old_price, new_price), old_ll, new_ll);
  execute v2;

  -- map_posted_window_counts_ar: the same rows as the pins, so the same price
  select pg_get_functiondef(p.oid) into v from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'map_posted_window_counts_ar';
  n := (length(v) - length(replace(v, old_price, ''))) / length(old_price);
  if n <> 1 then raise exception 'map_posted_window_counts_ar: expected 1 price read, found %', n; end if;
  execute replace(v, old_price, new_price);

  -- map_nopin_refresh_ar: the district markers' price (filled on its own schedule)
  v := pg_get_functiondef('public.map_nopin_refresh_ar()'::regprocedure);
  n := (length(v) - length(replace(v, old_price, ''))) / length(old_price);
  if n <> 2 then raise exception 'map_nopin_refresh_ar: expected 2 price reads, found %', n; end if;
  execute replace(v, old_price, new_price);

  -- proof: haraj 19063138 (price only per metre) reads 10,255,000 through the view the pins read
  if (select case when s.deal_ar = 'بيع' then coalesce(s.price_total_effective, s.price_total) end
        from public.map_listing_points_ar s
       where s.source_table = 'haraj_residential_listings' and s.listing_id = 19063138) is distinct from 10255000 then
    if exists (select 1 from public.search_listings_ar where source_table = 'haraj_residential_listings' and listing_id = 19063138
                and price_total_effective = 10255000) then
      raise exception 'proof: the pins view does not carry the Filter price';
    end if;
  end if;
end
$mig$;
