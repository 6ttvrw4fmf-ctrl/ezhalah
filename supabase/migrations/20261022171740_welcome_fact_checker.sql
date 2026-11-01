-- A SECOND, INDEPENDENT CHECKER FOR THE HEADLINE FACTS (owner 2026-10-22: «I need u to be confident with all answers
-- and create someone that checks»). Reading the builder for that request found three ways a fact could be untrue:
--   1. Some facts grouped towns by NAME. 16 names belong to two different towns (الدرب, بيش, القويعية …), so 27 of that
--      day's facts mixed two towns' numbers — the «الدرب 1 vs 30» the Filter check had dropped.
--   2. "New this week" counted a site's first load as new. Haraj joined on 2026-10-17 and all 12,345 of its ads read as
--      new that week. An ad now counts as new only once we have been reading its site for 7 days.
--   3. The apartment-rent medians included Gathern / Aqar Monthly, whose stays are priced by length and show no price.
-- Two lines are retired because their claim cannot be proven every time: «أقل إيجار» (the lowest across every source)
-- and «مكاتب عقارية محلية» (a judgement about what a website is, not a count).
-- The checker, audit_welcome_insights(), recomputes EVERY fact from the listings by town ID — its own code, not the
-- builder's — on the same snapshot the builder read (both run in one REPEATABLE READ transaction), drops any fact it
-- cannot reproduce exactly, and records why. Any disagreement is a builder bug: mon_detect_welcome_insights_audit
-- raises it (P1 above 1%), and raises when the checker did not run.
set local statement_timeout = '10min';

-- prices are the displayed ASKING price (owner 2026-10-22: «we focus on the displayed asking price, we never recommend»)
update public.welcome_template set
  ar = '{g} {n}، تدري إن متوسط السعر المعروض لمتر الأرض في {city} ب{region} {a} ريال؟ اكتشف أراضيها مع إزهله.',
  en = '{g} {n}, did you know the median asking price for land in {city}, {region} is {a} SAR per m²? Discover its land with Ezhalah.'
 where id = 6;
update public.welcome_template set
  ar = '{g} {n}، تدري إن متوسط السعر المعروض لمتر الأرض في {district} ب{city} {a} ريال، بينما في {district2} {b} ريال؟ اكتشف الفرق مع إزهله.',
  en = '{g} {n}, did you know the median asking land price in {district}, {city} is {a} SAR per m², while in {district2} it is {b} SAR? Discover the difference with Ezhalah.'
 where id = 8;
update public.welcome_template set
  ar = '{g} {n}، تدري إن متوسط الإيجار السنوي المعروض للشقق في {district} ب{city} {a} ريال؟ اكتشفها مع إزهله.',
  en = '{g} {n}, did you know the median asking annual rent for apartments in {district}, {city} is {a} SAR? Discover them with Ezhalah.'
 where id = 10;
update public.welcome_template set
  ar = '{g} {n}، تدري إن متوسط الإيجار السنوي المعروض للشقق في {district} ب{city} {a} ريال، بينما في {district2} {b} ريال؟ اكتشف الفرق مع إزهله.',
  en = '{g} {n}, did you know the median asking annual apartment rent in {district}, {city} is {a} SAR, while in {district2} it is {b} SAR? Discover the difference with Ezhalah.'
 where id = 11;
update public.welcome_template set
  ar = '{g} {n}، تدري إن متوسط السعر المعروض لمتر الفلل في {district} ب{city} {a} ريال؟ اكتشفها مع إزهله.',
  en = '{g} {n}, did you know the median asking villa price in {district}, {city} is {a} SAR per m²? Discover them with Ezhalah.'
 where id = 16;
update public.welcome_template set
  ar = '{g} {n}، تدري إن متوسط الإيجار السنوي المعروض للمحلات في {district} ب{city} {a} ريال؟ اكتشفها مع إزهله.',
  en = '{g} {n}, did you know the median asking annual rent for shops in {district}, {city} is {a} SAR? Discover them with Ezhalah.'
 where id = 20;
update public.welcome_template set active = false where kind in ('min_rent_apt', 'local_office');

-- a district name that joins two places, carries brackets/dashes/digits, or names a compound is never put in a sentence
create or replace function public.welcome_name_is_messy(p text)
returns boolean language sql immutable set search_path to 'public' as $function$
  select p is not null and (
    p ~ '[-–()/\\,،:؛0-9٠-٩A-Za-z]'
    or regexp_replace(trim(p), '^حي\s+', '') ~ '\sو'
    or regexp_replace(trim(p), '^حي\s+', '') ~ '^(مجمع|كمبوند|مخطط)'
  )
$function$;

create table if not exists public.welcome_insight_build (
  day      date primary key,
  built_at timestamptz not null
);
alter table public.welcome_insight_build enable row level security;

create table if not exists public.welcome_insight_audit (
  day        date primary key,
  checked    int not null,
  failed     int not null,
  by_reason  jsonb not null default '{}',
  examples   jsonb not null default '[]',
  audited_at timestamptz not null default now()
);
alter table public.welcome_insight_audit enable row level security;

-- the builder: settled-site "new", no stay-length prices, no shared names, no messy names, no retired kinds, a build stamp
do $m$
declare src text; out_def text;
  procedure_anchors text[] := array[
    E'  create temp table w_b on commit drop as\n',
    E'      from public.search_listings_ar s\n     where s.production_ready',
    E's.rent_now_pay_later, s.first_seen_at, s.latitude',
    E'  drop table if exists w_b, w_dname, w_town, w_rent, w_rc, w_misplaced;',
    E'where deal_ar = ''إيجار'' and type_ar = ''شقة'' and price_annual between 6000 and 500000',
    E'  select count(*) into v_total from public.welcome_insight where day = d;'];
  a text;
begin
  src := pg_get_functiondef('public.build_welcome_insights()'::regprocedure);
  if position('w_pf' in src) > 0 then return; end if;
  foreach a in array procedure_anchors loop
    if (length(src) - length(replace(src, a, ''))) / length(a) <> 1 then
      raise exception 'builder anchor not found exactly once — refusing to guess: %', left(a, 60);
    end if;
  end loop;
  out_def := src;
  out_def := replace(out_def, procedure_anchors[1],
    E'  -- an ad is "new" only once we have read its site for 7 days: a site''s first load is not new listings\n' ||
    E'  create temp table w_pf on commit drop as\n' ||
    E'    select platform, min(first_seen_at) + interval ''7 days'' settled_at from public.search_listings_ar group by 1;\n' ||
    procedure_anchors[1]);
  out_def := replace(out_def, procedure_anchors[2],
    E'      from public.search_listings_ar s\n      join w_pf p on p.platform = s.platform\n     where s.production_ready');
  out_def := replace(out_def, procedure_anchors[3],
    E's.rent_now_pay_later,\n           case when s.first_seen_at >= p.settled_at then s.first_seen_at else ''-infinity''::timestamptz end first_seen_at, s.latitude');
  out_def := replace(out_def, procedure_anchors[4],
    E'  drop table if exists w_b, w_dname, w_town, w_rent, w_rc, w_misplaced, w_pf;');
  out_def := replace(out_def, procedure_anchors[5],
    procedure_anchors[5] || E' and platform not in (''gathern'', ''aqarmonthly'')');
  out_def := replace(out_def, procedure_anchors[6],
    E'  -- never speak through a name two towns share, a messy district name, or a retired line\n' ||
    E'  delete from public.welcome_insight w where w.day = d and w.city_ar in (\n' ||
    E'    select c.city_ar from public.loc_catalog_city c group by c.city_ar having count(distinct c.city_id) > 1\n' ||
    E'    union select s.city_ar from public.search_listings_ar s where s.production_ready group by s.city_ar having count(distinct s.city_id) > 1);\n' ||
    E'  delete from public.welcome_insight w where w.day = d and (public.welcome_name_is_messy(w.district_ar) or public.welcome_name_is_messy(w.district2_ar));\n' ||
    E'  delete from public.welcome_insight w where w.day = d and not exists (select 1 from public.welcome_template t where t.kind = w.kind and t.active);\n' ||
    E'  insert into public.welcome_insight_build(day, built_at) values (d, now()) on conflict (day) do update set built_at = excluded.built_at;\n' ||
    procedure_anchors[6]);
  execute out_def;
end $m$;

create or replace function public.audit_welcome_insights()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  d date := (select max(day) from public.welcome_insight);
  t0 timestamptz;
  wk timestamptz; y0 timestamptz; y1 timestamptz;
  r record; x numeric; y numeric; tc numeric; why text;
  checked int := 0; failed int := 0; reasons jsonb := '{}'; ex jsonb := '[]';
begin
  t0 := (select built_at from public.welcome_insight_build where day = d);
  if d is null or t0 is null then return jsonb_build_object('day', d, 'error', 'no build stamp for the latest day'); end if;
  wk := t0 - interval '7 days';
  y0 := (date_trunc('day', t0 at time zone 'Asia/Riyadh') - interval '1 day') at time zone 'Asia/Riyadh';
  y1 := date_trunc('day', t0 at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh';

  -- the checker's own copy of the listings, keyed by town ID
  drop table if exists a_b;
  create temp table a_b on commit drop as
    select s.source_table, s.listing_id, s.platform, s.region_ar, s.city_ar, s.city_id,
           nullif(nullif(trim(s.district_ar), ''), 'غير معروف') dist, s.deal_ar, s.type_ar,
           s.price_annual, s.price_total, s.price_per_meter, s.area_m2, s.furnished, s.property_age, s.maid_room, s.pool,
           s.payment_monthly, s.rent_now_pay_later, s.latitude,
           coalesce(s.first_seen_at >= wk and s.first_seen_at >= f.first_ever + interval '7 days', false) is_new,
           coalesce(s.first_seen_at >= y0 and s.first_seen_at < y1 and s.first_seen_at >= f.first_ever + interval '7 days', false) is_yday,
           exists (select 1 from public.ops_far_pin_register fp where fp.source_table = s.source_table and fp.listing_id = s.listing_id) far_pin
      from public.search_listings_ar s
      join (select platform, min(first_seen_at) first_ever from public.search_listings_ar group by 1) f on f.platform = s.platform
     where s.production_ready and s.city_ar is not null and s.city_ar <> 'غير معروف' and s.region_ar is not null;
  create index on a_b (city_id, dist);
  create index on a_b (region_ar);
  analyze a_b;
  -- town names that belong to more than one town (built once, not per fact)
  drop table if exists a_shared;
  create temp table a_shared on commit drop as
    select c.city_ar from public.loc_catalog_city c group by c.city_ar having count(distinct c.city_id) > 1
    union select b.city_ar from a_b b group by b.city_ar having count(distinct b.city_id) > 1;

  for r in select * from public.welcome_insight where day = d loop
    checked := checked + 1; why := null; x := null; y := null;

    if r.city_ar is not null and exists (select 1 from a_shared z where z.city_ar = r.city_ar) then
      why := 'town_name_shared';
    elsif public.welcome_name_is_messy(r.district_ar) or public.welcome_name_is_messy(r.district2_ar) then
      why := 'messy_district_name';
    elsif not exists (select 1 from public.welcome_template t where t.kind = r.kind and t.active) then
      why := 'no_active_line';
    elsif r.city_id is not null and exists (select 1 from a_b b where b.city_id = r.city_id and b.region_ar <> r.region_ar) then
      why := 'town_in_two_regions';
    elsif r.district_ar is not null and not exists (select 1 from a_b b where b.city_id = r.city_id and b.dist = r.district_ar) then
      why := 'district_not_in_town';
    end if;

    if why is null then
      case r.kind
      when 'town_single', 'town_few' then
        select count(*) into x from a_b b where b.city_id = r.city_id and b.type_ar <> 'غير معروف' and not b.far_pin;
        select max(c) into tc from (select count(*) c from a_b b where b.city_id = r.city_id and b.type_ar <> 'غير معروف' and not b.far_pin group by b.type_ar) z;
        if (select count(*) from a_b b where b.city_id = r.city_id and b.type_ar = r.type_ar and not b.far_pin) <> tc then why := 'type_not_most_common';
        elsif (r.kind = 'town_single') <> (x = 1) then why := 'single_vs_few';
        elsif exists (select 1 from public.search_listings_ar s where s.production_ready and s.city_id = r.city_id and s.latitude is null) then why := 'town_has_unpinned_ad';
        end if;
      when 'city_new_districts' then
        select count(distinct b.dist) into x from a_b b where b.city_id = r.city_id and b.is_new and b.dist is not null;
      when 'region_week' then
        select count(*) into x from a_b b where b.region_ar = r.region_ar and b.is_new;
        if (select count(*) from a_b b where b.region_ar = r.region_ar and b.city_ar = r.city_ar and b.is_new)
           < (select max(c) from (select count(*) c from a_b b where b.region_ar = r.region_ar and b.is_new group by b.city_ar) z) then why := 'not_the_top_town'; end if;
      when 'land_ppm_city' then
        select percentile_cont(0.5) within group (order by b.price_per_meter) into x from a_b b
         where b.city_id = r.city_id and b.deal_ar = 'بيع' and b.type_ar like 'أرض%' and b.price_per_meter between 10 and 50000;
      when 'land_share' then
        select round(100.0 * count(*) filter (where b.type_ar like 'أرض%') / nullif(count(*), 0)) into x from a_b b where b.city_id = r.city_id;
      when 'region_land' then
        select count(*) into x from a_b b where b.region_ar = r.region_ar and b.type_ar like 'أرض%';
        if (select count(*) from a_b b where b.region_ar = r.region_ar and b.city_ar = r.city_ar and b.type_ar like 'أرض%')
           < (select max(c) from (select count(*) c from a_b b where b.region_ar = r.region_ar and b.type_ar like 'أرض%' group by b.city_ar) z) then why := 'not_the_top_town'; end if;
      when 'land_gap' then
        select percentile_cont(0.5) within group (order by b.price_per_meter) into x from a_b b
         where b.city_id = r.city_id and b.dist = r.district_ar and b.deal_ar = 'بيع' and b.type_ar like 'أرض%' and b.price_per_meter between 10 and 50000;
        select percentile_cont(0.5) within group (order by b.price_per_meter) into y from a_b b
         where b.city_id = r.city_id and b.dist = r.district2_ar and b.deal_ar = 'بيع' and b.type_ar like 'أرض%' and b.price_per_meter between 10 and 50000;
      when 'rent_apt', 'rent_gap' then
        select percentile_cont(0.5) within group (order by b.price_annual) into x from a_b b
         where b.city_id = r.city_id and b.dist = r.district_ar and b.deal_ar = 'إيجار' and b.type_ar = 'شقة'
           and b.price_annual between 6000 and 500000 and b.platform not in ('gathern', 'aqarmonthly');
        if r.kind = 'rent_gap' then
          select percentile_cont(0.5) within group (order by b.price_annual) into y from a_b b
           where b.city_id = r.city_id and b.dist = r.district2_ar and b.deal_ar = 'إيجار' and b.type_ar = 'شقة'
             and b.price_annual between 6000 and 500000 and b.platform not in ('gathern', 'aqarmonthly');
        end if;
      when 'rent_share' then
        select round(100.0 * count(*) filter (where b.deal_ar = 'إيجار') / nullif(count(*), 0)) into x from a_b b where b.city_id = r.city_id;
      when 'monthly' then
        select count(*) into x from a_b b where b.city_id = r.city_id and b.deal_ar = 'إيجار' and (b.payment_monthly or b.rent_now_pay_later);
      when 'commercial_count' then
        select count(*) into x from a_b b where b.city_id = r.city_id and b.deal_ar = 'إيجار' and b.type_ar in ('محل', 'مكتب');
      when 'furnished' then
        select round(100.0 * count(*) filter (where b.furnished) / nullif(count(*), 0)) into x from a_b b
         where b.city_id = r.city_id and b.dist = r.district_ar and b.deal_ar = 'إيجار' and b.type_ar = 'شقة' and b.furnished is not null;
      when 'villa_area' then
        select percentile_cont(0.5) within group (order by b.area_m2) into x from a_b b
         where b.city_id = r.city_id and b.dist = r.district_ar and b.type_ar = 'فيلا' and b.area_m2 between 100 and 5000;
      when 'villa_ppm' then
        select percentile_cont(0.5) within group (order by b.price_total / b.area_m2) into x from a_b b
         where b.city_id = r.city_id and b.dist = r.district_ar and b.deal_ar = 'بيع' and b.type_ar = 'فيلا'
           and b.price_total between 200000 and 50000000 and b.area_m2 between 100 and 5000;
      when 'maid' then
        select round(100.0 * count(*) filter (where b.maid_room) / nullif(count(*), 0)) into x from a_b b
         where b.city_id = r.city_id and b.dist = r.district_ar and b.type_ar = 'فيلا' and b.maid_room is not null;
      when 'pool' then
        select count(*) into x from a_b b where b.city_id = r.city_id and b.dist = r.district_ar and b.pool;
      when 'new_build' then
        select round(100.0 * count(*) filter (where b.property_age = 0) / nullif(count(*), 0)) into x from a_b b
         where b.city_id = r.city_id and b.dist = r.district_ar and b.property_age is not null;
      when 'shop_rent' then
        select percentile_cont(0.5) within group (order by b.price_annual) into x from a_b b
         where b.city_id = r.city_id and b.dist = r.district_ar and b.deal_ar = 'إيجار' and b.type_ar = 'محل' and b.price_annual between 3000 and 2000000;
      when 'hot_district' then
        select count(*) filter (where b.is_new), round(100.0 * count(*) filter (where b.is_new) / nullif(count(*), 0)) into x, y
          from a_b b where b.city_id = r.city_id and b.dist = r.district_ar;
      when 'district_sites' then
        select count(distinct b.platform) into x from a_b b where b.city_id = r.city_id and b.dist = r.district_ar;
      when 'yesterday' then
        select count(*) into x from a_b b where b.is_yday;
        select count(*) into y from a_b b where b.is_yday and b.region_ar = r.region_ar;
      when 'town_week' then
        select count(*) filter (where b.is_new), count(*) filter (where not b.is_new) into x, y from a_b b where b.city_id = r.city_id;
      when 'region_sites' then
        select count(distinct b.platform) into x from a_b b where b.region_ar = r.region_ar;
      else
        why := 'unknown_kind';
      end case;
    end if;

    if why is null and (x is null or round(x) <> r.a or (r.b is not null and (y is null or round(y) <> r.b))) then
      why := 'number_differs';
    end if;

    if why is not null then
      failed := failed + 1;
      reasons := jsonb_set(reasons, array[why], to_jsonb(coalesce((reasons ->> why)::int, 0) + 1));
      if jsonb_array_length(ex) < 25 then
        ex := ex || jsonb_build_object('why', why, 'kind', r.kind, 'region', r.region_ar, 'city', r.city_ar, 'district', r.district_ar,
                                       'district2', r.district2_ar, 'fact_a', r.a, 'fact_b', r.b, 'checker_a', round(x), 'checker_b', round(y));
      end if;
      delete from public.welcome_insight where id = r.id;
    end if;
  end loop;

  insert into public.welcome_insight_audit(day, checked, failed, by_reason, examples, audited_at)
  values (d, checked, failed, reasons, ex, now())
  on conflict (day) do update set checked = excluded.checked, failed = excluded.failed, by_reason = excluded.by_reason,
    examples = excluded.examples, audited_at = excluded.audited_at;
  return jsonb_build_object('day', d, 'checked', checked, 'failed', failed, 'by_reason', reasons);
end
$function$;
revoke execute on function public.audit_welcome_insights() from public, anon, authenticated;

-- nightly at 00:40 Riyadh: build and check on ONE snapshot, then the Filter check on live search
select cron.alter_job((select jobid from cron.job where jobname = 'build-welcome-insights'),
  command := $$set statement_timeout to '900s'; begin isolation level repeatable read; select public.build_welcome_insights(); select public.audit_welcome_insights(); commit; select public.verify_welcome_insights();$$);

create or replace function public.mon_detect_welcome_insights_audit()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; live text[] := '{}'; b record; a record;
begin
  select * into b from public.welcome_insight_build order by day desc limit 1;
  select * into a from public.welcome_insight_audit where day = b.day;
  if b.day is null or a.day is null or a.audited_at < b.built_at then
    live := live || 'welcome_insights_audit:not_run'::text;
    n := n + public.mon_raise('P2', 'welcome_insights_audit', 'fleet', 'welcome_insights_audit:not_run',
      jsonb_build_object('built_day', b.day, 'why', 'The independent checker did not check the latest headline facts.',
        'action', 'Check cron job build-welcome-insights; run select public.audit_welcome_insights();'));
  elsif a.failed > 0 then
    live := live || 'welcome_insights_audit:disagree'::text;
    n := n + public.mon_raise(case when a.failed * 100 > a.checked then 'P1' else 'P2' end, 'welcome_insights_audit', 'fleet',
      'welcome_insights_audit:disagree',
      jsonb_build_object('day', a.day, 'checked', a.checked, 'failed', a.failed, 'by_reason', a.by_reason, 'examples', a.examples,
        'why', 'The independent checker could not reproduce some headline facts; they were removed before users saw them, but the builder is wrong somewhere.',
        'action', 'Compare build_welcome_insights() with audit_welcome_insights() for the kinds in examples; fix the builder, never the checker.'));
  end if;
  perform public.mon_resolve_stale_keys('welcome_insights_audit', live);
  return n;
end
$function$;
revoke execute on function public.mon_detect_welcome_insights_audit() from public, anon, authenticated;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_welcome_insights_audit' in src) > 0 then return; end if;
  out_def := replace(src,
    E'    ''mon_detect_welcome_insights_unconfirmed'',',
    E'    ''mon_detect_welcome_insights_unconfirmed'',\n    ''mon_detect_welcome_insights_audit'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- Proof: the code is in place. The nightly job itself (build + checker on one snapshot, then the Filter check) is run
-- right after this migration and its results are read from welcome_insight_audit / welcome_insight_check.
do $proof$
declare src text;
begin
  src := pg_get_functiondef('public.build_welcome_insights()'::regprocedure);
  if position('join w_pf p' in src) = 0 or position('aqarmonthly' in src) = 0 or position('welcome_name_is_messy' in src) = 0
     or position('welcome_insight_build' in src) = 0 then
    raise exception 'PROOF: the builder was not patched';
  end if;
  if not public.welcome_name_is_messy('حي هجره الذيبيه وخضراء') or not public.welcome_name_is_messy('حي الحمراء و ام الجود')
     or public.welcome_name_is_messy('حي ولي العهد') or public.welcome_name_is_messy('حي وسط المدينة') then
    raise exception 'PROOF: the messy-name rule misjudges a known name';
  end if;
  if position('audit_welcome_insights' in (select command from cron.job where jobname = 'build-welcome-insights')) = 0 then
    raise exception 'PROOF: the nightly job does not run the checker';
  end if;
end $proof$;
