-- ─────────────────────────────────────────────────────────────────────────────────────────
-- PRICE≠AREA / PRICE≠PPM REPAIR (owner-authorized 2026-08-10). 60 Buy rows had price_total copied
-- from a NON-price: per-listing source verification (3 agents, evidence quoted per row,
-- workflow wf_9dcdbb5b) classified 55 FIX_TO_NULL (source publishes NO total: the «سعر المتر 1»
-- rial-per-meter gimmick makes aqar display area×1 as the page price; old dealapp fallback copied
-- area into price with ppm=1 placeholder) + 5 KEEP (source states that exact total, incl. id
-- 132677 «المطلوب: 2,000,000» on a 2,000,000 m² plot — a GENUINE source coincidence, preserved).
-- SOURCE-TRUTH RULE APPLIED: nothing nulled for looking unrealistic; only figures the source never
-- published as a total. Source-backed extremes stay verbatim.
--
-- 1) ROOT CAUSE (live, reproduced): aqar_parse still returns the area×1 artifact as price
--    (5968252→630, 138332→300000, 1017694→3000000). The ppm-as-total class was already fixed by
--    the 2026-08-03 rate-strip (72076→NULL now); those rows are stale data. Fix: when parsed price
--    EXACTLY equals parsed area, require an explicit total label (السعر/المطلوب/قيمة) adjacent to
--    that exact figure; otherwise the price is the area artifact → NULL. Evidence-grounded: every
--    verified genuine total carries such a label; every artifact lacks one. No magnitude gates.
create or replace function public.aqar_parse(txt text)
 returns jsonb
 language plpgsql
 immutable
as $function$
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
$function$;

-- SELF-TEST (fails the whole migration if the parser regresses):
do $$
declare a jsonb; b jsonb; c jsonb;
begin
  a := public.aqar_parse('ارض للبيع 630 ريال تفاصيل الإعلان المساحة 630 الواجهة شرق');
  if a->>'price' is not null then raise exception 'artifact guard FAILED: unlabeled price==area must be NULL, got %', a->>'price'; end if;
  if a->>'area_m2' <> '630' then raise exception 'artifact guard broke area parse: %', a->>'area_m2'; end if;
  b := public.aqar_parse('ارض للبيع المطلوب: 2,000,000 ريال تفاصيل الإعلان المساحة 2,000,000');
  if b->>'price' <> '2000000' then raise exception 'labeled source total must be KEPT, got %', b->>'price'; end if;
  c := public.aqar_parse('شقة السعر 550,000 ريال تفاصيل الإعلان المساحة 120');
  if c->>'price' <> '550000' or c->>'area_m2' <> '120' then raise exception 'normal listing broken: % / %', c->>'price', c->>'area_m2'; end if;
end $$;

-- 2) REPAIR — exactly the 55 per-row-verified FIX_TO_NULL rows (never a blanket predicate).
--    aqar: price_total/price_original → NULL (the ppm column keeps the source-displayed per-meter
--    figure, including the literal «1» placeholder aqar itself displays). 34 rows.
update public.aqar_residential_listings
   set price_total = null, price_original = null
 where id in (42754,138332,148711,1015536,1017694,1019212,1068878,1191409,1858460,3494514,
              5968249,5968252,5968258,6248923,6248991,6749999,
              66735,72070,72076,122020,123554,123580,124144,128476,128610,128700,
              131061,132809,137299,139464,143531,1341862,1341888,1449071);
--    dealapp: legacy fallback copied area→price and invented ppm=1 (OUR placeholder, not source) → both NULL. 21 rows.
update public.dealapp_residential_listings
   set price_total = null, price_per_meter = null
 where id in (1039954,1039957,1134750,1134805,1134815,1134818,1134834,1291497,1501421,1732497,
              1890181,2046807,2046809,2872995,2872997,4372398,4952759,4952761,5440634,5440636,5696041);

-- 3) VERIFIED-COINCIDENCE ALLOWLIST + LIVE BARRIER: price==area / price==ppm on a searchable Buy row
--    is henceforth an alarm unless the row is source-verified.
create table if not exists public.ops_price_eq_area_verified (
  source_table text not null,
  listing_id   bigint not null,
  evidence     text not null,
  verified_at  timestamptz not null default now(),
  primary key (source_table, listing_id)
);
insert into public.ops_price_eq_area_verified (source_table, listing_id, evidence) values
  ('aqar_residential_listings', 132677,
   'source capture states «بسعر ريال واحد فقط للمتر المساحة: 2,000,000 المطلوب: 2,000,000» — explicit المطلوب total; 2M m² × 1 ﷼/m². Price==area is source-real.')
on conflict do nothing;

create or replace function public.mon_detect_price_eq_area_or_ppm()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_cnt bigint; v_open boolean; n int := 0;
begin
  select count(*) into v_cnt
  from public.search_listings_ar s
  where s.production_ready and s.deal_ar = 'بيع' and s.price_total is not null
    and (s.price_total = s.area_m2 or s.price_total = s.price_per_meter)
    and not exists (select 1 from public.ops_price_eq_area_verified v
                    where v.source_table = s.source_table and v.listing_id = s.listing_id);
  v_open := exists (select 1 from public.alert_event
                    where dedup_key='price_eq_area_or_ppm' and resolved_at is null);
  if v_cnt = 0 then
    if v_open then perform public.mon_resolve('price_eq_area_or_ppm','search_index'); end if;
  elsif not v_open then
    n := n + public.mon_raise('P1','price_eq_area_or_ppm','search_index','price_eq_area_or_ppm',
      jsonb_build_object('count', v_cnt,
        'why','a searchable Buy price exactly equals its area or per-meter figure without source verification — the area/ppm-as-price parser artifact (55-row incident 2026-08-10). Verify against source_capture: source-real → add to ops_price_eq_area_verified; parser artifact → NULL the price and fix the writer.'));
  end if;
  return n;
end $$;

-- 4) roster: 22 → 23 (rebuilt from the current live body, verified this session)
create or replace function public.mon_run_all_detectors()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  fns text[] := array[
    'mon_detect_silent_scraper_death',
    'mon_detect_zero_new_stall',
    'mon_detect_stale_active_fraction',
    'mon_detect_volume_drop',
    'mon_detect_cron_health',
    'mon_detect_stale_refresh',
    'mon_detect_legacy_alert_tables',
    'mon_detect_field_integrity',
    'mon_detect_search_index_freshness',
    'mon_detect_quarantine_growth',
    'mon_detect_registry_orphans',
    'mon_detect_rls_reachability',
    'mon_detect_mass_inactivation',
    'mon_detect_english_district_leak',
    'mon_detect_impossible_price_size',
    'mon_detect_unverified_inactivation',
    'mon_detect_deletion_spike',
    'mon_detect_buy_token_price_suppression',
    'mon_detect_price_source_mismatch',
    'mon_detect_dangling_scrape_run',
    'mon_detect_cron_minute_collision',
    'mon_detect_price_eq_area_or_ppm',      -- new 2026-08-10: area/ppm-as-price artifact tripwire
    'mon_detect_orphaned_detectors'
  ];
  fn text; raised int; result jsonb := '{}'::jsonb; failed text[] := '{}';
begin
  foreach fn in array fns loop
    begin
      execute format('select public.%I()', fn) into raised;
      result := result || jsonb_build_object(replace(fn, 'mon_detect_', ''), raised);
    exception when others then
      failed := failed || fn;
      result := result || jsonb_build_object(replace(fn, 'mon_detect_', ''), 'ERROR: ' || sqlerrm);
      begin
        perform public.mon_raise('P1', 'detector_crash', 'all',
          'detector_crash:' || fn || ':' || current_date,
          jsonb_build_object('detector', fn, 'sqlstate', sqlstate, 'error', sqlerrm));
      exception when others then
        null;
      end;
    end;
  end loop;
  return result || jsonb_build_object('ran_at', now(), 'failed', to_jsonb(failed));
end $function$;