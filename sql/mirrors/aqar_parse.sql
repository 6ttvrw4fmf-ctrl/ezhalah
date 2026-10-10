-- MIRROR of the LIVE production object. NOT a migration — see the full-body-replace rule.
-- Re-verified 2026-09-27 (migration 20260811130514_sql_mirror_live_drift_detector): UNCHANGED.
--   md5(pg_get_functiondef) in production = 3347a572f90a29a1ab2de739f987975b, identical to this file.
--   Stamped for verify-sql-mirrors-not-stale (B2): the previous same-day stamp named no version at or
--   after this migration, so nothing proved it was re-checked AFTER it. Nothing in the body was edited.
-- Refreshed 2026-08-11 for the labeled-total-beats-sub-floor-pick fix (migration 20260811064231).
--   THIS MIRROR WAS FOUND STALE by senior audit run #10 and is regenerated verbatim here. It had
--   been missing the ENTIRE «AREA-ARTIFACT GUARD (2026-08-10)» block shipped by migration
--   20260810202219 — 4,363 bytes on disk against 5,270 live. The offline verifier could not see it:
--   check (A) is self-consistency (the file's md5 against its own body) and check (B) compares the
--   mirror's date to the newest migration touching the object, and BOTH were 2026-08-10, so a
--   same-day drift passes every assertion. Re-derived from pg_get_functiondef, not hand-patched.
-- Verified byte-exact; md5 of everything below this header block: 3347a572f90a29a1ab2de739f987975b
--   equals md5(pg_get_functiondef) in production, 7,234 bytes both sides, checked 2026-08-11.
CREATE OR REPLACE FUNCTION public.aqar_parse(txt text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  region text; head text; prices bigint[]; v_disc int; v_price bigint; v_orig bigint; v_area int;
  v_floor_raw text; v_labeled bigint;
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

  -- LABELED TOTAL BEATS A SUB-FLOOR PICK (2026-08-11, P1): prices[] is DOCUMENT ORDER, and the aqar
  -- page header renders an unlabeled currency chip that does not always carry the total. Observed
  -- live, all served to users at the wrong price:
  --   * per-meter rate as the chip — «2,690 §» beside «السعر: 11,000,000 ريال» (ids 7026223/7032586)
  --   * abbreviated thousands chip — «950 §» beside «السعر: 950,000 ريال» (ids 6962441, 3897470)
  --   * unrelated prose amount first — «7 ريال شهريًا» water cost, real «السعر» 720,000-730,000
  --     (ids 74567/74616/74619)
  -- When the document-order pick lands UNDER 10,000 SAR — the band trg_aqar_parse already documents
  -- as "never a real SAR total ... an honest NULL beats a fabricated price" — and the same page
  -- states an explicit «السعر: N ريال» at or above that band, the labeled figure is the SOURCE'S OWN
  -- statement of the price and wins. Nothing is derived, estimated or rounded: the value is copied
  -- from the page verbatim.
  -- One-directional and floor-gated ON PURPOSE. It can never let a seller's rounded prose figure
  -- displace a plausible structured price: measured over all 56,384 active aqar Buy rows on
  -- 2026-08-11, 348 carry a labeled value BELOW the header price (tax/net/rounding — e.g. header
  -- 1,250,025 vs «السعر: 1,250,000 ريال صافي») and every one is left untouched. Whole-corpus blast
  -- radius of this rule at authoring time: 10 Buy rows.
  if v_price is not null and v_price < 10000 then
    v_labeled := (
      select round(v)::bigint from (
        select nullif(regexp_replace(coalesce((regexp_match(head,
                 'السعر\s*:?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:§|ريال|﷼)'))[1], ''), ',', '', 'g'), '')::numeric as v
      ) s where v >= 10000
    );
    if v_labeled is not null then v_price := v_labeled; end if;
  end if;

  -- area: numeric cast (no int overflow) + plausibility gate — a phone/ID after «المساحة» is NOT an area.
  v_area := (
    select case when v >= 1 and v <= 10000000 then v::int end
    from (
      select nullif(regexp_replace(coalesce((regexp_match(_aqar_between(region, 'المساحة(?!\s*حسب)'), '\d[\d,]*'))[1], ''), ',', '', 'g'), '')::numeric as v
    ) s
  );

  -- AREA-ARTIFACT GUARD (2026-08-10): the «سعر المتر 1» rial-per-meter gimmick makes aqar render
  -- area×1 as the page price with no seller-published total (55-row incident; per-row source
  -- evidence in the audit). When the parsed price EXACTLY equals the parsed area, keep it ONLY if
  -- an explicit total label (السعر/المطلوب/قيمة) sits adjacent to that exact figure — a labeled
  -- coincidence (id 132677: «المطلوب: 2,000,000» for a 2,000,000 m² plot at 1 ﷼/m²) is source-real
  -- and stays. Otherwise the figure is the area artifact → NULL (honest unknown, never a guess).
  if v_price is not null and v_area is not null and v_price = v_area::bigint
     and regexp_replace(head, ',', '', 'g') !~ ('(السعر|المطلوب|قيمة)[^0-9]{0,40}' || v_price::text || '(\D|$)')
  then
    v_price := null; v_orig := null; v_disc := null;
  end if;

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
    'furnished',        case when txt ~ 'غير[[:space:]]*(مفروش|مؤثث)' and regexp_replace(txt, 'غير[[:space:]]*(مفروش|مؤثث)[^[:space:]]*', ' ', 'g') ~ '(مفروش|مؤثث)' then null when txt ~ 'غير[[:space:]]*(مفروش|مؤثث)' then false when txt ~ '(مفروش|مؤثث)' then true else null end,
    'area_m2',          v_area, 'price', v_price, 'price_original', v_orig, 'discount_pct', v_disc
  ));
end
$function$
