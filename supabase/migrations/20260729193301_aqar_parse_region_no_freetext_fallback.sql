-- 2026-07-29: aqar_parse()'s `region` fell back to the ENTIRE free-text description when the
-- structured "تفاصيل الإعلان" details block is absent from source_text, instead of yielding no
-- structured data. _aqar_between(region, 'الدور') would then match the FIRST "الدور" occurrence
-- anywhere in the prose (very commonly a villa's own "الدور الأرضي/الأول/الثاني" floor-by-floor
-- room breakdown) and grab whatever digit followed — often just bullet-list numbering ("1 -"),
-- unrelated to any real floor number. Confirmed live: 5,078/7,259 (70%) of active residential rows
-- with a non-null floor_number, and 57/... commercial rows, have NO structured marker at all —
-- their floor_number is fleet-wide garbage. Also corrupts direction (1,864 residential rows),
-- num_apartments, tenant_category, license_number/expiry, deed_area_m2 at smaller scale, since all
-- of these are extracted from the same `region` variable via _aqar_between().
--
-- Fix: when the marker is absent, `region` must be NULL (honest "no structured data"), never fall
-- back to the raw description. Every downstream _aqar_between(region, ...) call already returns
-- NULL cleanly on a NULL/empty input, and jsonb_strip_nulls() already drops null keys from the
-- returned object -- so this is a pure "stop guessing" fix, zero behavior change for the ~50k rows
-- that DO have a genuine structured block.
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
    'floor_number',     (regexp_match(_aqar_between(region, 'الدور'), '\d+'))[1],
    'num_apartments',   (regexp_match(_aqar_between(region, 'عدد الشقق'), '\d+'))[1],
    'furnished',        case when txt ~ 'مؤثث|مفروش' then true else null end,
    'area_m2',          v_area, 'price', v_price, 'price_original', v_orig, 'discount_pct', v_disc
  ));
end
$function$;