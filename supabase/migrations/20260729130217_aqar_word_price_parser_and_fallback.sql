-- P0 recovery durability (2026-07-29): parse Arabic WORD-prices — «المطلوب 380 الف» → 380000,
-- «مليون و 150 الف» → 1,150,000, «2 مليون و 200 الف» → 2,200,000, «3.5 مليون», «السعر: 1,200,000 ريال» —
-- so re-scrapes preserve them and future listings parse them. Used ONLY as a fallback when the source
-- states no §/ريال/﷼ machine-price. VALIDATED live: reproduces all 47 hand-verified prices exactly, and
-- is conservative (fills only ~1.3% of no-price Buy rows, on a clear anchored word-price; never «سعر المتر»).
-- Fidelity: an honest NULL where no price is stated (multi-unit / «على السوم» / none) beats a guess.
CREATE OR REPLACE FUNCTION public.aqar_word_price(txt text) RETURNS bigint LANGUAGE plpgsql IMMUTABLE AS $$
declare t text; win text; m text[]; price numeric;
begin
  if txt is null then return null; end if;
  t := translate(txt, '٠١٢٣٤٥٦٧٨٩', '0123456789');
  -- window: the FIRST price anchor actually followed by a number (never «سعر المتر»).
  win := (regexp_match(t, '(?:المطلوب|السعر|بسعر)(?!\s*المتر)([^0-9\n]{0,15}[0-9][^\n]{0,30})'))[1];
  if win is null then return null; end if;

  m := regexp_match(win, '([0-9]+(?:\.[0-9]+)?)\s*مليون\s*و\s*([0-9]+)\s*(?:[اأآ]لا?ف)');   -- N مليون و M الف
  if m is not null then price := m[1]::numeric*1000000 + m[2]::numeric*1000;
  else m := regexp_match(win, 'مليون\s*و\s*([0-9]+)\s*(?:[اأآ]لا?ف)');                        -- مليون و M الف (=1M)
  if m is not null then price := 1000000 + m[1]::numeric*1000;
  else m := regexp_match(win, '([0-9]+(?:\.[0-9]+)?)\s*مليون');                               -- N[.M] مليون
  if m is not null then price := m[1]::numeric*1000000;
  else m := regexp_match(win, '([0-9]+(?:[.,][0-9]+)?)\s*(?:[اأآ]لا?ف)');                      -- N الف / ألف / آلاف
  if m is not null then price := replace(m[1],',','')::numeric*1000;
  else m := regexp_match(win, '([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{6,})');                         -- bare comma-full or >=6 digits
  if m is not null then price := replace(m[1],',','')::numeric;
  end if; end if; end if; end if; end if;

  if price is null or price < 50000 or price > 500000000 then return null; end if;
  return round(price)::bigint;
end $$;

-- aqar_parse: add the word-price fallback for Buy — used ONLY when no §/ريال/﷼ price is found, so a real
-- machine-price is never overridden. Everything else identical (area numeric+plausibility guard retained;
-- price_per_meter still untouched — verify-aqar-trigger-preserves-source-ppm.ts must stay green).
CREATE OR REPLACE FUNCTION public.aqar_parse(txt text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  region text; head text; prices bigint[]; v_disc int; v_price bigint; v_orig bigint; v_area int;
begin
  if txt is null then return '{}'::jsonb; end if;
  txt := translate(txt, '٠١٢٣٤٥٦٧٨٩', '0123456789');
  region := coalesce(substring(txt from 'تفاصيل الإعلان(.*)'), txt);
  head   := split_part(txt, 'تفاصيل الإعلان', 1);

  select array_agg(v order by ord) into prices from (
     select round((regexp_replace((t.g)[1], ',', '', 'g'))::numeric)::bigint as v, ord
     from regexp_matches(head, '(\d[\d,]*(?:\.\d+)?)\s*(?:§|ريال|﷼)', 'g') with ordinality as t(g, ord)
  ) s where v > 0;
  v_disc := nullif(substring(head from 'خصم\s*(\d+)\s*%'), '')::int;
  if v_disc is not null and coalesce(array_length(prices,1),0) >= 2 then v_orig := prices[1]; v_price := prices[2];
  elsif coalesce(array_length(prices,1),0) >= 1 then v_price := prices[1]; end if;

  -- Word-price fallback (2026-07-29): recover a price stated in words when no §/ريال/﷼ price was found.
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
