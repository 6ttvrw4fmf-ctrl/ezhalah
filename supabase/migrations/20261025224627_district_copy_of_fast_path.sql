-- district_copy_of(), fast path (2026-10-25, minutes after the every-listing rule). The SQL-language version planned its
-- 3-branch UNION on every call (a CTE + UNION + LIMIT cannot be inlined), so a count over the search index timed out, and
-- the hourly sync calls loc_display_district_ar() for every listing. Same answers, plpgsql with early exits: a name that
-- is on the list for its city returns null at once (almost every row), then the three indexed lookups in order.
create or replace function public.district_copy_of(p_city_id integer, p_raw text)
returns text
language plpgsql stable
as $function$
declare n text; k1 text; k1s text; k2 text; town text; v text;
begin
  n := public.norm_district_tok(p_raw);
  if n is null or n = '' then return null; end if;
  if exists (select 1 from public.loc_catalog_district f where f.city_id = p_city_id and f.district_norm = n) then return null; end if;
  k1 := public.district_key_letters(p_raw);
  if k1 = '' then return null; end if;
  select b.district_norm into v from public.loc_catalog_district b
   where b.city_id = p_city_id and public.district_key_letters(b.district_ar) = k1 limit 1;
  if v is not null then return v; end if;
  k2 := replace(k1, 'ال', '');
  select b.district_norm into v from public.loc_catalog_district b
   where b.city_id = p_city_id and replace(public.district_key_letters(b.district_ar), 'ال', '') = k2 limit 1;
  if v is not null then return v; end if;
  town := public.district_key_letters(coalesce((select city_ar from public.loc_catalog_city where city_id = p_city_id), ''));
  if town = '' or k1 = town then return null; end if;
  k1s := regexp_replace(regexp_replace(regexp_replace(k1, '^(ب)?' || town, ''), '(ب)?' || town || '$', ''), '[اهء]+$', '');
  if k1s = k1 or k1s = '' then return null; end if;
  select b.district_norm into v from public.loc_catalog_district b
   where b.city_id = p_city_id and public.district_key_letters(b.district_ar) = k1s limit 1;
  return v;
end $function$;

-- PROOF: same answers as before, and fast.
do $proof$
declare t0 timestamptz; ms numeric; v text; c_buq int := (select city_id from public.loc_catalog_city where city_ar = 'بقيق' limit 1);
begin
  if public.loc_display_district_ar(c_buq, 'حي الربوة - بقيق') <> 'حي الربوة' then raise exception 'PROOF: town-suffix copy not folded'; end if;
  if public.loc_display_district_ar(664, 'الملقا') <> 'حي الملقاه' then raise exception 'PROOF: last-letter copy not folded'; end if;
  if public.loc_display_district_ar(3, 'ملك عبد الله') <> 'حي الملك عبدالله' then raise exception 'PROOF: «ال»/spaces copy not folded'; end if;
  if public.loc_display_district_ar(1061, 'حي الواحة') <> 'الواحة' then raise exception 'PROOF: same-letters copy not folded'; end if;
  if public.loc_display_district_ar(3, 'المعيزيلة') <> 'المعيزيلة' then raise exception 'PROOF: a one-letter-away name was folded by itself'; end if;
  if public.district_copy_of(3, 'حي منفوحة الجديدة') is not null then raise exception 'PROOF: منفوحة الجديدة read as a copy'; end if;
  if public.district_copy_of(6, 'الشامية الجديد') is not null then raise exception 'PROOF: الشامية الجديد read as a copy'; end if;
  if public.district_copy_of(3, 'حي النرجس') is not null then raise exception 'PROOF: a list name reads as a copy of itself'; end if;
  if public.loc_display_district_ar(6, 'الهجلة الجديد') <> 'حي الهجلة' then raise exception 'PROOF: the «الجديد» rule broke'; end if;
  if public.district_copy_of(3, null) is not null or public.district_copy_of(3, '') is not null then raise exception 'PROOF: empty input must give null'; end if;
  t0 := clock_timestamp();
  perform public.loc_display_district_ar(s.city_id, s.district_ar) from (select city_id, district_ar from public.search_listings_ar where district_ar is not null and city_id is not null limit 20000) s;
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  if ms > 20000 then raise exception 'PROOF: 20,000 display calls took % ms (want under 20 s, i.e. under 1 ms each)', round(ms); end if;
  raise notice 'PROOF OK: same folds; 20,000 display calls in % ms', round(ms);
end $proof$;
