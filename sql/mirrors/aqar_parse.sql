-- MIRROR of the LIVE production object. NOT a migration — see the full-body-replace rule.
-- Refreshed 2026-08-03 (senior run #3 continuation): adds the per-meter-rate exclusion
-- (rate-qualified price expressions stripped from the head before the price scan).
-- Verified byte-exact; md5 of everything below this header block: 00f675b3620becc41c4fdabc0ee325d4
CREATE OR REPLACE FUNCTION public.aqar_parse(txt text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  region text; head text; prices bigint[]; v_disc int; v_price bigint; v_orig bigint; v_area int;
  v_floor_raw text;
begin
  if txt is null then return '{}'::jsonb; end if;
  txt := translate(txt, '٠١٢٣٤٥٦٧٨٩', '0123456789');
  region := substring(txt from 'تفاصيل الإعلان(.*)');  -- NULL (not txt) when the structured block is absent
  head   := split_part(txt, 'تفاصيل الإعلان', 1);
  -- Per-meter RATES are not totals (2026-08-03): remove rate-qualified price expressions from the
  -- head before scanning, so «سعر المتر 4100 ريال» / «8000 ريال للمتر» can never become price_total.
  head := regexp_replace(head, '(?:سعر\s*)?المتر[\s:]{0,6}\d[\d,]*(?:\.\d+)?\s*(?:§|ريال|﷼)', ' ', 'g');
  head := regexp_replace(head, '\d[\d,]*(?:\.\d+)?\s*(?:§|ريال|﷼)\s*(?:لل|ال)?\s*متر', ' ', 'g');

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

  -- floor: strict full-value match only. «أرضي» (ground) is a lexical identity for 0; a bare 1-2 digit
  -- value passes; anything else (a false-friend match inside «...الدوري», «علوي», run-on text) → NULL.
  v_floor_raw := _aqar_between(region, 'الدور');

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
    'floor_number',     case when v_floor_raw ~ '^[اأ]رضي$' then '0'
                             else (regexp_match(v_floor_raw, '^\d{1,2}$'))[1] end,
    'num_apartments',   (regexp_match(_aqar_between(region, 'عدد الشقق'), '\d+'))[1],
    'furnished',        case when txt ~ 'مؤثث|مفروش' then true else null end,
    'area_m2',          v_area, 'price', v_price, 'price_original', v_orig, 'discount_pct', v_disc
  ));
end
$function$
