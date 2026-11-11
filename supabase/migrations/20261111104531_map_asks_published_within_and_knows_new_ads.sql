-- THE MAP ASKS «نُشر خلال» TOO, AND EACH SPOT KNOWS ITS NEW ADS (owner 2026-11-11: «time published … in the filter in
-- the map and normal» · «see how it says new … by date of publishment not ours»). Same rule as the Filter's clause:
-- p_posted_within_days = N keeps an ad only when its SITE published it in the last N days (search_listings_ar.posted_at);
-- an undated ad is in no window. Each exact spot also returns `fresh` = how many of its ads (short stays excepted) the
-- site published in the last 3 days — the pin's «إعلان جديد» tag.
--   1. map_listing_points_ar (the pins' source view) carries s.posted_at;
--   2. map_nopin_ar (district markers) carries it, filled now and on every refresh;
--   3. map_pins_ar(…, p_posted_within_days) returns `fresh` — the old 20-argument version is dropped first;
--   4. map_nopin_markers_ar(…, p_posted_within_days) — same.
-- The new argument defaults to NULL = not narrowed, so the live site keeps working before and after the frontend ships.
do $v$
declare v text; v2 text;
begin
  v := pg_get_viewdef('public.map_listing_points_ar'::regclass, true);
  v2 := replace(v, 's.unit_subtype_ar' || chr(10), 's.unit_subtype_ar,' || chr(10) || '    s.posted_at' || chr(10));
  if (length(v2) - length(v)) <> 2 * length(',' || chr(10) || '    s.posted_at') then
    raise exception 'map_listing_points_ar: unexpected shape (delta %)', length(v2) - length(v);
  end if;
  execute 'create or replace view public.map_listing_points_ar as ' || v2;
end
$v$;

alter table public.map_nopin_ar add column if not exists posted_at timestamptz;
update public.map_nopin_ar m set posted_at = s.posted_at
  from public.search_listings_ar s
 where s.source_table = m.source_table and s.listing_id = m.listing_id and s.posted_at is not null;

do $mig$
declare v text; v2 text; n int;
  old_pins constant text := 'double precision,double precision,double precision,double precision,double precision,text[],jsonb,integer,text,text[],integer[],integer,integer,numeric,numeric,boolean,text[],text[],text[],text';
  old_nopin constant text := 'double precision,double precision,double precision,double precision,text[],text,text[],integer[],integer,integer,numeric,numeric,integer,boolean,text[],text[],text[],text';
  win_s constant text := ' and (p_posted_within_days is null or (s.posted_at is not null and s.posted_at >= now() - make_interval(days => p_posted_within_days)))';
  win_m constant text := ' and (p_posted_within_days is null or (m.posted_at is not null and m.posted_at >= now() - make_interval(days => p_posted_within_days)))';
  beds_s constant text := 'and (p_beds is null or s.bedrooms = any (p_beds)) and (p_furnished is null or s.furnished = p_furnished)';
  beds_m constant text := 'and (p_beds is null or m.beds = any (p_beds)) and (p_furnished is null or m.furnished = p_furnished)';
  unpriced_col constant text := '(count(*) filter (where k.price is null or k.price < case when k.deal = ''rent'' then 1000 else 10000 end))::int';
begin
  -- 2b. map_nopin_refresh_ar(): carry s.posted_at into the table.
  v := pg_get_functiondef('public.map_nopin_refresh_ar()'::regprocedure);
  v2 := replace(v, 's.furnished, s.unit_subtype_ar', 's.furnished, s.unit_subtype_ar, s.posted_at');
  v2 := replace(v2, 'furnished, unit_subtype_ar)', 'furnished, unit_subtype_ar, posted_at)');
  v2 := replace(v2, 'furnished, unit_subtype_ar from map_nopin_new', 'furnished, unit_subtype_ar, posted_at from map_nopin_new');
  if (length(v2) - length(v)) <> 2 * length(', s.posted_at') + 2 * length(', posted_at') then
    raise exception 'map_nopin_refresh_ar: unexpected shape (delta %)', length(v2) - length(v);
  end if;
  execute v2;

  -- 3. map_pins_ar
  v := pg_get_functiondef(('public.map_pins_ar(' || old_pins || ')')::regprocedure);
  n := (length(v) - length(replace(v, beds_s, ''))) / length(beds_s);
  if n <> 4 then raise exception 'map_pins_ar: expected 4 read paths, found %', n; end if;
  n := (length(v) - length(replace(v, 'else s.price_annual end as price' || chr(10), ''))) / length('else s.price_annual end as price' || chr(10));
  if n <> 4 then raise exception 'map_pins_ar: expected 4 kept selects, found %', n; end if;
  v2 := replace(v, 'p_macro text DEFAULT NULL::text)' || chr(10) || ' RETURNS TABLE', 'p_macro text DEFAULT NULL::text, p_posted_within_days integer DEFAULT NULL::integer)' || chr(10) || ' RETURNS TABLE');
  v2 := replace(v2, 'price_max numeric, unpriced integer)', 'price_max numeric, unpriced integer, fresh integer)');
  v2 := replace(v2, 'null::numeric, 0' || chr(10), 'null::numeric, 0, 0' || chr(10));
  v2 := replace(v2, 'and p_tables is null and p_tables2 is null and p_macro is null', 'and p_tables is null and p_tables2 is null and p_macro is null and p_posted_within_days is null');
  v2 := replace(v2, 'else s.price_annual end as price' || chr(10), 'else s.price_annual end as price, s.posted_at' || chr(10));
  v2 := replace(v2, beds_s, beds_s || win_s);
  v2 := replace(v2, unpriced_col || chr(10), unpriced_col || ',' || chr(10)
    || '           (count(*) filter (where k.deal <> ''short'' and k.posted_at >= now() - interval ''3 days''))::int' || chr(10));
  if position('p_posted_within_days integer DEFAULT NULL::integer)' in v2) = 0 or position('unpriced integer, fresh integer)' in v2) = 0
     or position('k.posted_at >= now() - interval' in v2) = 0 or position('p_macro is null and p_posted_within_days is null' in v2) = 0
     or (length(v2) - length(replace(v2, 'null::numeric, 0, 0', ''))) / length('null::numeric, 0, 0') <> 3 then
    raise exception 'map_pins_ar: not every part was rewritten';
  end if;
  execute 'drop function public.map_pins_ar(' || old_pins || ')';
  execute v2;
  execute 'revoke all on function public.map_pins_ar(' || old_pins || ',integer) from public';
  execute 'grant execute on function public.map_pins_ar(' || old_pins || ',integer) to anon, authenticated, service_role';

  -- 4. map_nopin_markers_ar
  v := pg_get_functiondef(('public.map_nopin_markers_ar(' || old_nopin || ')')::regprocedure);
  v2 := replace(v, 'p_macro text DEFAULT NULL::text)', 'p_macro text DEFAULT NULL::text, p_posted_within_days integer DEFAULT NULL::integer)');
  v2 := replace(v2, beds_m, beds_m || win_m);
  if (length(v2) - length(v)) <> length(', p_posted_within_days integer DEFAULT NULL::integer') + length(win_m) then
    raise exception 'map_nopin_markers_ar: unexpected shape (delta %)', length(v2) - length(v);
  end if;
  execute 'drop function public.map_nopin_markers_ar(' || old_nopin || ')';
  execute v2;
  execute 'revoke all on function public.map_nopin_markers_ar(' || old_nopin || ',integer) from public';
  execute 'grant execute on function public.map_nopin_markers_ar(' || old_nopin || ',integer) to anon, authenticated, service_role';
end
$mig$;