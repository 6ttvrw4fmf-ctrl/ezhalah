-- 2026-07-29 (follow-up to aqar_parse_region_no_freetext_fallback): floor_number was still garbage
-- on rows WHERE the structured block exists but has no «الدور» row. Root cause live-proven on ad
-- 6431756 (id 78910, stored floor_number=4500000): the label pattern 'الدور' is un-anchored, so it
-- matched INSIDE «شارع عباس الدوري» (a street name in the page's similar-ads tail, which is part of
-- `region` since it sits after «تفاصيل الإعلان»), and the old loose '\d+' then scanned ahead and
-- captured the NEIGHBORING AD'S PRICE as a floor number. Similar rows stored 1,700,000 / 22,000 /
-- 207 as "floors".
--
-- Fix: a genuine aqar spec row renders as «الدور N» where the captured value (after _aqar_between's
-- trim/collapse + next-label lookahead) is EXACTLY the bare number. Require '^\d{1,2}$' — a full-value
-- 1-2 digit match (0-99, far above any real Saudi building). A false-friend match inside «الدوري»
-- captures «ي, حي ...» and now fails to NULL; any run-on/garbage tail also fails to NULL. Honest
-- unknown beats a fabricated floor.
--
-- NOTE: superseded in the same session by 20260729204833_aqar_parse_floor_ardi_ground_zero.sql,
-- which keeps this anchor and additionally maps the closed non-numeric value «أرضي» (ground) -> 0.
-- Kept as its own migration to mirror the recorded prod history exactly.
create or replace function public.aqar_parse(txt text)
 returns jsonb
 language plpgsql
 immutable
as $function$
declare
  region text; head text; prices bigint[]; v_disc int; v_price bigint; v_orig bigint; v_area int;
begin
  if txt is null then return '{}'::jsonb; end if;
  txt := translate(txt, '٠١٢٣٤٥٦٧٨٩', '0123456789');
  region := substring(txt from 'تفاصيل الإعلان(.*)');  -- NULL (not txt) when the structured block is absent
  head   := split_part(txt, 'تفاصيل الإعلان', 1);

  select array_agg(v order by ord) into prices from (
     select round((regexp_replace((t.g)[1], ',', '', 'g'))::numeric)::bigint as v, ord
     from regexp_matches(head, '(\d[\d,]*(?:\.\d+)?)\s*(?:§|ريال|﷼)', 'g') with ordinality as t(g, ord)
  ) s where v > 0;
  v_disc := nullif(substring(head from 'خصم\s*(\d+)\s*%'), '')::int;
  if v_disc is not null and coalesce(array_length(prices,1),0) >= 2 then v_orig := prices[1]; v_price := prices[2];
  elsif coalesce(array_length(prices,1),0) >= 1 then v_price := prices[1]; end if;

  -- Word-price fallback (2026-07-29): when the source states no §/ريال/﷼ price but writes it in words
  -- («المطلوب 380 الف», «مليون و 150 الف»), recover it. Only fires when v_price is still NULL, so a real
  -- §-price is never overridden.
  if v_price is null then v_price := public.aqar_word_price(txt); end if;

  -- area: numeric cast (no int overflow) + plausibility gate — a phone/ID after «المساحة» is NOT an area.
  v_area := (
    select case when v >= 1 and v <= 10000000 then v::int end
    from (
      select nullif(regexp_replace(coalesce((regexp_match(_aqar_between(region, 'المساحة(?!\s*حسب)'), '\d[\d,]*'))[1], ''), ',', '', 'g'), '')::numeric as v
    ) s
  );

  return jsonb_strip_nulls(jsonb_build_object(
    'direction',        _aqar_between(region, 'الواجهة'),
    'last_update',      _aqar_between(region, 'آخر تحديث'),
    'date_added',       substring(_aqar_between(region, 'تاريخ الإضافة') from '\d{2}/\d{2}/\d{4}'),
    'license_number',   (regexp_match(_aqar_between(region, 'رخصة الإعلان'), '\d{6,}'))[1],
    'license_expiry',   substring(_aqar_between(region, 'تاريخ نهاية الترخيص') from '\d{2}/\d{2}/\d{4}'),
    'ad_source',        _aqar_between(region, 'مصدر الإعلان'),
    'plan_parcel',      coalesce(_aqar_between(region, 'المخطط و القطعة'), _aqar_between(region, 'المخطط والقطعة')),
    'deed_area_m2',     regexp_replace(coalesce((regexp_match(_aqar_between(region, 'المساحة حسب الصك'), '\d[\d.,]*'))[1],''), ',', '', 'g'),
    'views_count',      regexp_replace(coalesce((regexp_match(_aqar_between(region, 'المشاهدات'), '\d[\d,]*'))[1],''), ',', '', 'g'),
    'tenant_category',  _aqar_between(region, 'الفئة'),
    'floor_number',     (regexp_match(_aqar_between(region, 'الدور'), '^\d{1,2}$'))[1],
    'num_apartments',   (regexp_match(_aqar_between(region, 'عدد الشقق'), '\d+'))[1],
    'furnished',        case when txt ~ 'مؤثث|مفروش' then true else null end,
    'area_m2',          v_area, 'price', v_price, 'price_original', v_orig, 'discount_pct', v_disc
  ));
end
$function$;
