-- 🆕 2026-10-17, backlog #595: «حي 1النرجس» (dealapp, تاروت ×5) folded to «1 النرجس», never «نرجس», so the
-- catalog's «حي النرجس» (city 456) never matched and the listings stayed district-less. The leading-number
-- strip ran BEFORE the «حي» strip, so a number behind «حي» survived. Needle edit: after the «حي» strip, drop
-- a leading number ONLY when an «ال» word follows it. A bare plan code keeps its number: «حي 33ج» and
-- «حي 34ج» must not both become «ج», nor «حي 1077 مخطط رقم» / «حي 638 مخطط رقم» one «مخطط رقم».
-- Measured over every distinct district name in search_listings_ar, loc_catalog_district and
-- listing_source_district_ar_fleet (6,241): exactly two tokens change, «حي 1النرجس» and «حي 1النخيل».
-- No stored district_ar or catalog name has that shape, so no index entry or generated value moves
-- (asserted below) and idx_slar_district_tok needs no rebuild.
create or replace function public.norm_district_tok(t text)
 returns text
 language sql
 immutable
as $function$
  select btrim(regexp_replace(regexp_replace(regexp_replace(
           btrim(regexp_replace(regexp_replace(
             btrim(regexp_replace(regexp_replace(
               replace(
                 translate(
                   regexp_replace(public.normalize_ar(coalesce(t,'')), '[ًٌٍَُِّْٰ]', '', 'g'),
                   'ئ٠١٢٣٤٥٦٧٨٩', 'ي0123456789'),
                 'ء',''),
               '([ء-ي])([0-9])', '\1 \2', 'g'),
             '([0-9])([ء-ي])', '\1 \2', 'g')),
           '^[0-9]+\s*', ''), '\s*[0-9]+$', '')),
         '^(حي\s+)+', ''), '^[0-9]+\s+(?=ال)', ''), '^ال', ''));
$function$;

do $$
begin
  if public.norm_district_tok('حي 1النرجس') <> 'نرجس' then
    raise exception 'norm_district_tok(«حي 1النرجس») = %, expected نرجس', public.norm_district_tok('حي 1النرجس');
  end if;
  if public.norm_district_tok('حي 33ج') = public.norm_district_tok('حي 34ج') then
    raise exception 'two numbered plan codes collapsed into one token';
  end if;
  if public.norm_district_tok('حي النرجس 1') <> 'نرجس' or public.norm_district_tok('1 حي النرجس') <> 'نرجس'
     or public.norm_district_tok('حي الصفا') <> public.norm_district_tok('الصفاء') then
    raise exception 'an existing fold changed';
  end if;
  if exists (select 1 from public.search_listings_ar
             where district_ar is not null and district_norm_tok is distinct from public.norm_district_tok(district_ar)) then
    raise exception 'a stored district token moved; rebuild idx_slar_district_tok and the generated column first';
  end if;
end $$;
