-- RENT PERIOD: the «judged» flag follows the source, and the rent-period detectors know the 2026-09-28 rule.
-- UNLOCATED: a row with no proven city carries no city match ids (owner location decision 2026-08-18).
--
-- 1. rent_period_judgment_holds(): ONE predicate for "this served period is the owner's silent-period
--    judgment (docs/ARCHITECTURE.md «A SILENT period is JUDGED from the price»), not a manufactured one".
--    mon_detect_rent_period_inferred_when_source_silent and mon_detect_rent_period_contract still counted
--    every judged row (10,872 of 10,880) as «manufactured» — written before the rule existed.
-- 2. enforce_rent_period_judgment() + sync_search_listings_ar(): the sync's ON CONFLICT never handed over
--    the flag its own INSERT pass had just computed, and the trigger's UPDATE branch then kept OLD's flag
--    whenever the period word was unchanged. So a row whose source went silent kept judged=false (8 rows)
--    and a row whose source STARTED stating a period kept judged=true (1,939 rows) — the second class is
--    invisible to every detector that skips judged rows (mon_detect_cheap_yearly_rent_served among them).
-- 3. trg_set_match_city_ids(): composite_match_city_ids() resolved «الدوادمي - البجادية» part by part
--    nationally and gave two UNLOCATED wasalt rows match ids [701] — a city we cannot prove.

create or replace function public.rent_period_judgment_holds(
  p_judged boolean, p_period text, p_price_annual numeric, p_price_total numeric, p_type_ar text, p_platform text)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  -- TRUE only for a row the trigger enforce_rent_period_judgment() labelled from a silent source AND whose
  -- stored label still follows from its stored figure: a per-month figure stored ×12 (raw = price_annual/12
  -- judged «شهري»), or a yearly-sized figure judged «سنوي». The stay-length platforms are monthly-only.
  select coalesce(p_judged, false) and case
    when p_platform in ('gathern', 'aqarmonthly') then p_period is not distinct from 'شهري'
    else p_period is not distinct from 'سنوي' and (
           public.judge_silent_rent_period_ar(coalesce(p_price_annual, p_price_total), p_type_ar) is not distinct from 'سنوي'
        or (p_price_annual is not null
            and public.judge_silent_rent_period_ar(p_price_annual / 12, p_type_ar) is not distinct from 'شهري'))
  end
$function$;

-- 2a. The trigger accepts a flag the writer hands over explicitly (the sync's INSERT-pass verdict), and only
--     a TRUE that the judgment really supports — an asserted judgment the price cannot back is refused.
do $do$
declare src text; anchor text; patched text;
begin
  src := pg_get_functiondef('public.enforce_rent_period_judgment'::regproc);
  anchor := $a$    elsif TG_OP = 'UPDATE' and NEW.rent_period_ar is not distinct from OLD.rent_period_ar then
      NEW.rent_period_judged := OLD.rent_period_judged;$a$;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'enforce_rent_period_judgment: anchor not found exactly once — live body changed, re-read it';
  end if;
  patched := replace(src, anchor, $r$    elsif TG_OP = 'UPDATE' and NEW.rent_period_judged is distinct from OLD.rent_period_judged
          and (not NEW.rent_period_judged
               or public.rent_period_judgment_holds(true, NEW.rent_period_ar, NEW.price_annual, NEW.price_total,
                                                    NEW.type_ar, NEW.platform)) then
      -- The writer handed over a verdict (sync_search_listings_ar passes its INSERT pass's flag): the source
      -- went silent (judged) or started stating a period (not judged). Keep it.
      null;
    elsif TG_OP = 'UPDATE' and NEW.rent_period_ar is not distinct from OLD.rent_period_ar then
      NEW.rent_period_judged := OLD.rent_period_judged;$r$);
  execute patched;
end
$do$;

-- 2b. The sync hands the flag over, and re-visits a judged row whose source now states a period (the
--     period word alone may not change, e.g. a judged «سنوي» row whose site starts printing «سنوي»).
do $do$
declare src text; a1 text; a2 text; patched text;
begin
  src := pg_get_functiondef('public.sync_search_listings_ar'::regproc);
  a1 := 'rent_period_ar=excluded.rent_period_ar,';
  a2 := '                       or s3.rent_period_ar is distinct from (case';
  if (length(src) - length(replace(src, a1, ''))) / length(a1) <> 1
     or (length(src) - length(replace(src, a2, ''))) / length(a2) <> 1
     or position('rent_period_judged' in src) > 0 then
    raise exception 'sync_search_listings_ar: anchors not found exactly once (or already patched) — re-read the live body';
  end if;
  patched := replace(src, a1, 'rent_period_ar=excluded.rent_period_ar, rent_period_judged=excluded.rent_period_judged,');
  patched := replace(patched, a2, '                       or (s3.rent_period_judged and v.rent_period is not null)' || chr(10) || a2);
  execute patched;
end
$do$;

-- 3. An unlocated row carries no city match ids.
do $do$
declare src text; anchor text;
begin
  src := pg_get_functiondef('public.trg_set_match_city_ids'::regproc);
  anchor := '  new.match_city_ids := public.composite_match_city_ids(new.city_ar, new.region_id, new.city_id);';
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'trg_set_match_city_ids: anchor not found exactly once — re-read the live body';
  end if;
  execute replace(src, anchor,
    '  -- UNLOCATED (no proven city) => no city match ids: those ids are the branch that admits a row to a' || chr(10) ||
    '  -- city-filtered search, and resolving a composite name part by part would hand it a city we cannot' || chr(10) ||
    '  -- prove (owner location decision 2026-08-18; mon_detect_unlocated_search_contract limb (a)).' || chr(10) ||
    '  new.match_city_ids := case when new.city_id is null then null' || chr(10) ||
    '                             else public.composite_match_city_ids(new.city_ar, new.region_id, new.city_id) end;');
end
$do$;

-- 4. The detectors.
create or replace function public.mon_detect_rent_period_inferred_when_source_silent()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_inferred bigint; v_wrong_value bigint; v_flag_lies bigint; n int := 0; bad jsonb := '[]'::jsonb;
begin
  -- 1. THE CORE INVARIANT: index says a period, source says nothing — and it is NOT the owner's silent-period
  --    judgment (2026-09-28, docs/ARCHITECTURE.md «A SILENT period is JUDGED from the price»).
  select count(*) into v_inferred
  from search_listings_ar s
  join listing_native_location_v2 v
    on v.source_table = s.source_table and v.listing_id = s.listing_id
  where s.deal_ar = 'إيجار'
    and s.rent_period_ar is not null
    and v.rent_period is null
    and s.platform not in ('gathern','aqarmonthly')
    and not public.rent_period_judgment_holds(s.rent_period_judged, s.rent_period_ar, s.price_annual,
                                              s.price_total, s.type_ar, s.platform);

  -- 2. The index must never carry a period token outside the source vocabulary.
  select count(*) into v_wrong_value
  from search_listings_ar
  where rent_period_ar is not null and rent_period_ar not in ('شهري','سنوي');

  -- 3. The other direction: a row flagged JUDGED although its source states a period. Every detector that
  --    trusts the flag (e.g. mon_detect_cheap_yearly_rent_served skips judged rows) is blind to it.
  select count(*) into v_flag_lies
  from search_listings_ar s
  join listing_native_location_v2 v
    on v.source_table = s.source_table and v.listing_id = s.listing_id
  where s.rent_period_judged and v.rent_period is not null;

  if v_inferred > 0 then
    bad := bad || jsonb_build_object('kind','period_inferred_from_silence','rows',v_inferred,
      'why','These rentals publish NO period at source but carry one in the search index that the silent-period '
         || 'judgment (enforce_rent_period_judgment / judge_silent_rent_period_ar) does not produce, so they '
         || 'match a strict period filter on manufactured evidence. Fix the writer — never widen the filter.');
  end if;
  if v_wrong_value > 0 then
    bad := bad || jsonb_build_object('kind','period_token_outside_vocabulary','rows',v_wrong_value);
  end if;
  if v_flag_lies > 0 then
    bad := bad || jsonb_build_object('kind','judged_flag_on_stated_period','rows',v_flag_lies,
      'why','rent_period_judged=true on rows whose source STATES a period. The sync must hand over the flag '
         || 'its INSERT pass computes (rent_period_judged=excluded.rent_period_judged).');
  end if;

  if jsonb_array_length(bad) > 0 then
    n := public.mon_raise('P1','rent_period_source_truth','all','rent_period_inferred_when_silent',
      jsonb_build_object('failures', bad,
        'why','PERIOD = SOURCE when the ad states one. A rental whose source states no period is labelled only '
           || 'by the owner''s silent-period judgment (2026-09-28): 300-7,999 on a home/business type = per '
           || 'month, served سنوي ×12; 15,000+ = سنوي; anything else stays NULL. gathern/aqarmonthly are '
           || 'monthly-only.'));
  else
    perform public.mon_resolve_key('rent_period_source_truth','rent_period_inferred_when_silent');
  end if;
  return n;
end $function$;

create or replace function public.mon_detect_rent_period_contract()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0; v jsonb := '{}'::jsonb; bad int; total int := 0;
  sync_src text; pool_src text; struct_bad jsonb := '[]'::jsonb; surfaces jsonb := '[]'::jsonb; trg_ok boolean;
begin
  -- (1) owner barrier 1: a SALE listing can never carry a rent period
  select count(*) into bad from public.search_listings_ar
   where deal_ar = 'بيع' and rent_period_ar is not null;
  total := total + bad; v := v || jsonb_build_object('sale_with_period', bad);

  -- (2a) a period value that is neither سنوي nor شهري is garbage — still a breach.
  select count(*) into bad from public.search_listings_ar
   where deal_ar = 'إيجار' and rent_period_ar is not null and rent_period_ar not in ('سنوي','شهري');
  total := total + bad; v := v || jsonb_build_object('rent_period_garbage', bad);

  -- (2b) INFORMATIONAL: a rent row with no period (borderline figure, price on request). Reported so a RISE
  --      stays visible; deliberately NOT added to total.
  select count(*) into bad from public.search_listings_ar
   where deal_ar = 'إيجار' and rent_period_ar is null;
  v := v || jsonb_build_object('rent_without_period', bad);

  -- (2c) MANUFACTURED period — the index states a period the source never published, on a platform that is
  --      not monthly-only, and it is NOT the owner's silent-period judgment (2026-09-28).
  select count(*) into bad
    from public.listing_native_location_v2 lv
    join public.search_listings_ar s
      on s.source_table = lv.source_table and s.listing_id = lv.listing_id
   where lower(lv.transaction_type) = 'rent' and lv.rent_period is null
     and s.platform not in ('gathern','aqarmonthly') and s.rent_period_ar is not null
     and not public.rent_period_judgment_holds(s.rent_period_judged, s.rent_period_ar, s.price_annual,
                                               s.price_total, s.type_ar, s.platform);
  total := total + bad; v := v || jsonb_build_object('period_manufactured', bad);

  -- (3) owner barrier 2: an explicit MONTHLY upstream lands in the pool rent_pool_ar() assigns it — «شهري»
  --     on the two stay-length platforms, «سنوي» (×12) everywhere else (owner 2026-10-25). Never lost to NULL.
  select count(*) into bad
    from public.listing_native_location_v2 lv
    join public.search_listings_ar s
      on s.source_table = lv.source_table and s.listing_id = lv.listing_id
   where lower(lv.transaction_type) = 'rent' and lv.rent_period = 'monthly'
     and s.rent_period_ar is distinct from public.rent_pool_ar(s.platform, lv.rent_period);
  total := total + bad; v := v || jsonb_build_object('explicit_monthly_lost', bad);

  -- (4) owner barrier 3: explicit ANNUAL upstream stays in its pool
  select count(*) into bad
    from public.listing_native_location_v2 lv
    join public.search_listings_ar s
      on s.source_table = lv.source_table and s.listing_id = lv.listing_id
   where lower(lv.transaction_type) = 'rent' and lv.rent_period = 'annual'
     and s.rent_period_ar is distinct from public.rent_pool_ar(s.platform, lv.rent_period);
  total := total + bad; v := v || jsonb_build_object('explicit_annual_lost', bad);

  -- (5) the MONTHLY-ONLY platforms never fall back to annual (owner rule 2026-07-06)
  select count(*) into bad from public.search_listings_ar
   where platform in ('gathern','aqarmonthly') and deal_ar = 'إيجار'
     and rent_period_ar is distinct from 'شهري';
  total := total + bad; v := v || jsonb_build_object('monthly_only_platform_not_monthly', bad);

  -- (6) owner barrier 6: eastabha is classified per LISTING, never by a platform-wide override
  select count(*) into bad
    from public.listing_native_location_v2 lv
    join public.search_listings_ar s
      on s.source_table = lv.source_table and s.listing_id = lv.listing_id
   where s.platform = 'eastabha' and lower(lv.transaction_type) = 'rent'
     and lv.rent_period in ('monthly','annual')
     and s.rent_period_ar is distinct from public.rent_pool_ar(s.platform, lv.rent_period);
  total := total + bad; v := v || jsonb_build_object('eastabha_listing_evidence_overridden', bad);

  -- (6b) owner barrier 6, second half: no platform-wide waiver may re-appear for eastabha.
  select count(*) into bad from public.ops_rent_period_sourceless where platform = 'eastabha';
  total := total + bad; v := v || jsonb_build_object('eastabha_platform_wide_waiver_returned', bad);

  -- (7) STRUCTURAL: the only writer of the canonical field still maps through rent_pool_ar() inside the
  --     rent-only guard, rent_pool_ar() still names the two stay-length platforms, and the judgment
  --     trigger is attached and enabled.
  select pg_get_functiondef(p.oid) into sync_src
    from pg_proc p join pg_namespace nsp on nsp.oid = p.pronamespace
   where nsp.nspname = 'public' and p.proname = 'sync_search_listings_ar';
  select pg_get_functiondef(p.oid) into pool_src
    from pg_proc p join pg_namespace nsp on nsp.oid = p.pronamespace
   where nsp.nspname = 'public' and p.proname = 'rent_pool_ar';
  if sync_src is null then
    struct_bad := struct_bad || to_jsonb('sync_search_listings_ar missing'::text);
  else
    if position('public.rent_pool_ar(v.platform, v.rent_period)' in sync_src) = 0 then
      struct_bad := struct_bad || to_jsonb('the sync no longer maps the period through rent_pool_ar()'::text);
    end if;
    if position('lower(v.transaction_type) = ''rent''' in sync_src) = 0
       and position('lower(v.transaction_type)=''rent''' in sync_src) = 0 then
      struct_bad := struct_bad || to_jsonb('the rent-only guard around the period case is gone'::text);
    end if;
    if position('rent_period_judged=excluded.rent_period_judged' in sync_src) = 0 then
      struct_bad := struct_bad || to_jsonb('the sync no longer hands over rent_period_judged'::text);
    end if;
  end if;
  if pool_src is null or position('''gathern'',''aqarmonthly''' in pool_src) = 0 then
    struct_bad := struct_bad || to_jsonb('rent_pool_ar() is missing or no longer names the stay-length platforms'::text);
  end if;
  select exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.search_listings_ar'::regclass
                    and t.tgname = 'trg_rent_period_judgment' and not t.tgisinternal and t.tgenabled <> 'D')
    into trg_ok;
  if not trg_ok then
    struct_bad := struct_bad || to_jsonb('trg_rent_period_judgment is missing or disabled'::text);
  end if;

  -- (9) owner barrier 9: every read surface must consume the CANONICAL field.
  select coalesce(jsonb_agg(pr.proname order by pr.proname), '[]'::jsonb) into surfaces
    from pg_proc pr join pg_namespace nsp on nsp.oid = pr.pronamespace
   where nsp.nspname = 'public' and pr.prokind = 'f'
     and pr.proname in ('location_search_candidates_ar','af_eligibility_clause','af_eligible_count',
                        'af_in_certified_cohort','apartment_guided_counts_ar','district_options_ar',
                        'property_age_option_counts_ar','top_cities_by_deal_ar')
     and pg_get_functiondef(pr.oid) !~* 'rent_period_ar';
  if jsonb_array_length(surfaces) > 0 then
    struct_bad := struct_bad || surfaces;
  end if;
  v := v || jsonb_build_object('surfaces_not_reading_rent_period_ar', surfaces,
                               'structural', struct_bad);

  if total > 0 or jsonb_array_length(struct_bad) > 0 then
    n := public.mon_raise('P1', 'rent_period_contract', 'all', 'rent_period_contract',
      v || jsonb_build_object(
        'contract', 'An explicit source period always wins and lands in rent_pool_ar()''s pool (stay-length '
                    'platforms «شهري», every other site «سنوي» ×12). A silent period is judged from the price '
                    '(owner 2026-09-28) or stays NULL. NEVER applied to a sale listing.',
        'why', 'sync_search_listings_ar (+ trigger enforce_rent_period_judgment) is the only writer of '
               'search_listings_ar.rent_period_ar, which Normal Filter, Advanced Filter, the AI/backend search, '
               'city/district/Trending counts, totals and pagination all read.',
        'do_not', 'Do NOT fix a breach by writing a period into the scraper tables - that fabricates a source '
                  'value. The classification belongs in the sync and its trigger.'));
  else
    perform public.mon_resolve_key('rent_period_contract', 'rent_period_contract');
  end if;

  return n;
end
$function$;

-- 5. Repair the rows the old upsert left with a stale flag / stray ids (the trigger accepts these explicit
--    flags only through the rule above; the next hourly sync would converge on the same values).
update public.search_listings_ar s
   set rent_period_judged = false
  from public.listing_native_location_v2 lv
 where lv.source_table = s.source_table and lv.listing_id = s.listing_id
   and s.rent_period_judged and lv.rent_period is not null;

update public.search_listings_ar s
   set rent_period_judged = true
  from public.listing_native_location_v2 lv
 where lv.source_table = s.source_table and lv.listing_id = s.listing_id
   and s.deal_ar = 'إيجار' and not s.rent_period_judged and lv.rent_period is null
   and s.rent_period_ar is not null and s.platform not in ('gathern','aqarmonthly')
   and public.rent_period_judgment_holds(true, s.rent_period_ar, s.price_annual, s.price_total, s.type_ar, s.platform);

update public.search_listings_ar
   set match_city_ids = null
 where city_id is null and match_city_ids is not null and cardinality(match_city_ids) > 0;

-- 6. aqar_residential_listings:161046 — the 2026-08-15 probe recorded no period; the production enricher's
--    own capture of the listing page (raw_captured_at 2026-10-30, schema aqar.v2-fulltext) reads
--    «45,000 ريال / سنوي» beside this listing's figure. Record that newer observation, as
--    mon_detect_rent_period_contradicts_probe's adjudication asks; the old probe is kept.
insert into public.ops_rent_period_source_probe
  (source_table, listing_id, probed_at, http_status, observed_subtype, method, evidence)
select 'aqar_residential_listings', 161046, a.raw_captured_at, 200, 'annual',
       'production enricher capture (source_capture.source_text, aqar.v2-fulltext): period word beside the price',
       'captured ' || a.raw_captured_at::text || ': «شقة للإيجار 45,000 ريال / سنوي» — the period aqar prints beside '
       || 'this listing''s own figure; supersedes the 2026-08-15 «none» probe'
  from public.aqar_residential_listings a
 where a.id = 161046
   and a.source_capture->>'source_text' like '%45,000 § ريال / سنوي%'
on conflict do nothing;
