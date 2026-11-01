-- SHORTER HEADLINE FACTS (owner 2026-10-28: «some are too long, I want them shorter, without losing the updated facts …
-- «المعروضة» is important»; approved from the phone-width preview of all 31). Every line drops «اكتشفها مع إزهله» and
-- filler, keeps «المعروضة» (an asking price, never a sale price) and every honesty word the wording trigger
-- (welcome_template_wording_matches_math) demands: «نص … أو أقل», «آخر 7 أيام», «آخر 30 يوم», «أمس», «على الأقل»,
-- «أكثر حي», «بانتظام», «عمرها». The trigger re-checks every line on this update.
--
-- ALL SITES, DUPLICATES ONCE (owner 2026-10-28: «it must be all, not just 1 … duplicates in the facts are considered
-- 1»). Both the builder and the independent recount read every production-ready site and count a property listed on
-- several sites once. mon_detect_welcome_facts_all_sites_once watches both on every sweep (P1): the cross-site
-- de-duplication is present in both, neither narrows the base to some sites, and no fact count exceeds the raw count of
-- what is listed (de-duplication can only lower it).
--
-- THE NAME RULE IS LIFTED (owner 2026-10-28, asked «keep اكتشفها مع إزهله or remove the name rule?» → «Remove it»): the
-- check that every line carry «إزهله» / "Ezhalah" is dropped; the rest of each check stays exactly as it was.

alter table public.welcome_template drop constraint welcome_template_ar_check;
alter table public.welcome_template add constraint welcome_template_ar_check
  check (ar like '%{g}%' and ar like '%{n}%' and ar like '%تدري إن%' and ar not like '%قارن%');
alter table public.welcome_template drop constraint welcome_template_en_check;
alter table public.welcome_template add constraint welcome_template_en_check
  check (en like '%{g}%' and en like '%{n}%');

insert into public.welcome_template(id, kind, personal, ar, en) values
 (46, 'month_apt_ppm', false, '{g} {n}، تدري إن نص الشقق المعروضة للبيع آخر 30 يوم في {district} ب{city} مترها {a} ريال أو أقل، والـ30 يوم قبلها {b}؟',
   '{g} {n}, did you know half the apartments listed for sale in {district}, {city} in the last 30 days ask {a} SAR/m² or less, vs {b} the 30 days before?'),
 (47, 'month_land_ppm', false, '{g} {n}، تدري إن نص الأراضي المعروضة للبيع آخر 30 يوم في {city} مترها {a} ريال أو أقل، والـ30 يوم قبلها {b}؟',
   '{g} {n}, did you know half the land listed for sale in {city} in the last 30 days asks {a} SAR/m² or less, vs {b} the 30 days before?'),
 (53, 'month_bld_ppm', false, '{g} {n}، تدري إن نص العمائر المعروضة للبيع آخر 30 يوم في {city} مترها {a} ريال أو أقل، والـ30 يوم قبلها {b}؟',
   '{g} {n}, did you know half the buildings listed for sale in {city} in the last 30 days ask {a} SAR/m² or less, vs {b} the 30 days before?'),
 (8, 'land_gap', false, '{g} {n}، تدري إن نص الأراضي المعروضة للبيع في {district} ب{city} مترها {a} ريال أو أقل، وفي {district2} {b}؟',
   '{g} {n}, did you know half the land listed for sale in {district}, {city} asks {a} SAR/m² or less, vs {b} in {district2}?'),
 (11, 'rent_gap', false, '{g} {n}، تدري إن نص الشقق المعروضة للإيجار في {district} ب{city} إيجارها السنوي {a} ريال أو أقل، وفي {district2} {b}؟',
   '{g} {n}, did you know half the apartments listed for rent in {district}, {city} ask {a} SAR a year or less, vs {b} in {district2}?'),
 (38, 'wow_land_up', false, '{g} {n}، تدري إن إعلانات الأراضي الجديدة للبيع في {city} زادت {a}% آخر 7 أيام عن اللي قبلها، بالمواقع اللي نقرأها بانتظام؟',
   '{g} {n}, did you know new land-for-sale listings in {city} rose {a}% in the last 7 days vs the 7 before, on sites we read steadily?'),
 (39, 'wow_land_down', false, '{g} {n}، تدري إن إعلانات الأراضي الجديدة للبيع في {city} قلّت {a}% آخر 7 أيام عن اللي قبلها، بالمواقع اللي نقرأها بانتظام؟',
   '{g} {n}, did you know new land-for-sale listings in {city} fell {a}% in the last 7 days vs the 7 before, on sites we read steadily?'),
 (43, 'wow_apt_sale_up', false, '{g} {n}، تدري إن إعلانات الشقق الجديدة للبيع في {city} زادت {a}% آخر 7 أيام عن اللي قبلها، بالمواقع اللي نقرأها بانتظام؟',
   '{g} {n}, did you know new apartment-for-sale listings in {city} rose {a}% in the last 7 days vs the 7 before, on sites we read steadily?'),
 (44, 'wow_apt_sale_down', false, '{g} {n}، تدري إن إعلانات الشقق الجديدة للبيع في {city} قلّت {a}% آخر 7 أيام عن اللي قبلها، بالمواقع اللي نقرأها بانتظام؟',
   '{g} {n}, did you know new apartment-for-sale listings in {city} fell {a}% in the last 7 days vs the 7 before, on sites we read steadily?'),
 (50, 'wow_bld_up', false, '{g} {n}، تدري إن إعلانات العمائر الجديدة للبيع في {city} زادت {a}% آخر 7 أيام عن اللي قبلها، بالمواقع اللي نقرأها بانتظام؟',
   '{g} {n}, did you know new building-for-sale listings in {city} rose {a}% in the last 7 days vs the 7 before, on sites we read steadily?'),
 (51, 'wow_bld_down', false, '{g} {n}، تدري إن إعلانات العمائر الجديدة للبيع في {city} قلّت {a}% آخر 7 أيام عن اللي قبلها، بالمواقع اللي نقرأها بانتظام؟',
   '{g} {n}, did you know new building-for-sale listings in {city} fell {a}% in the last 7 days vs the 7 before, on sites we read steadily?'),
 (33, 'week_land', false, '{g} {n}، تدري إن {city} نزل فيها آخر 7 أيام {a} إعلان أرض جديد للبيع على الأقل، وأكثر حي فيها {district}؟',
   '{g} {n}, did you know at least {a} new land-for-sale listings went up in {city} in the last 7 days, the most in {district}?'),
 (42, 'week_apt_sale', false, '{g} {n}، تدري إن {city} نزل فيها آخر 7 أيام {a} إعلان شقة جديد للبيع على الأقل، وأكثر حي فيها {district}؟',
   '{g} {n}, did you know at least {a} new apartment-for-sale listings went up in {city} in the last 7 days, the most in {district}?'),
 (48, 'week_bld_sale', false, '{g} {n}، تدري إن {city} نزل فيها آخر 7 أيام {a} إعلان عمارة جديد للبيع على الأقل، وأكثر حي فيها {district}؟',
   '{g} {n}, did you know at least {a} new building-for-sale listings went up in {city} in the last 7 days, the most in {district}?'),
 (22, 'hot_district', false, '{g} {n}، تدري إن {district} ب{city} نزل فيه آخر 7 أيام {a} إعلان جديد على الأقل؟',
   '{g} {n}, did you know at least {a} new listings went up in {district}, {city} in the last 7 days?'),
 (28, 'hot_district', true, '{g} {n}، تدري إن {district} نزل فيه آخر 7 أيام {a} إعلان جديد على الأقل؟',
   '{g} {n}, did you know at least {a} new listings went up in {district} in the last 7 days?'),
 (23, 'yesterday', false, '{g} {n}، تدري إنه نزل أمس {a} إعلان جديد على الأقل في المملكة، منها {b} في {city}؟',
   '{g} {n}, did you know at least {a} new listings went up across the Kingdom yesterday, {b} of them in {city}?'),
 (3, 'city_new_districts', false, '{g} {n}، تدري إن {city} نزل فيها جديد آخر 7 أيام في {a} من أحيائها على الأقل؟',
   '{g} {n}, did you know {city} got new listings in at least {a} of its districts in the last 7 days?'),
 (55, 'city_sale', false, '{g} {n}، تدري إن {city} فيها {a} عقار معروض للبيع، وأكثر حي فيها {district}؟',
   '{g} {n}, did you know {city} has {a} properties listed for sale, the most in {district}?'),
 (49, 'city_bld_sale', false, '{g} {n}، تدري إن {city} فيها {a} عمارة معروضة للبيع، وأكثر حي فيها {district}؟',
   '{g} {n}, did you know {city} has {a} buildings listed for sale, the most in {district}?'),
 (32, 'city_land', false, '{g} {n}، تدري إن {city} فيها {a} أرض معروضة، وأكثر حي فيها {district}؟',
   '{g} {n}, did you know {city} has {a} land listings, the most in {district}?'),
 (6, 'land_ppm_city', false, '{g} {n}، تدري إن نص الأراضي المعروضة للبيع في {city} مترها {a} ريال أو أقل؟',
   '{g} {n}, did you know half the land listed for sale in {city} asks {a} SAR/m² or less?'),
 (45, 'apt_sale_ppm', false, '{g} {n}، تدري إن نص الشقق المعروضة للبيع في {district} ب{city} مترها {a} ريال أو أقل؟',
   '{g} {n}, did you know half the apartments listed for sale in {district}, {city} ask {a} SAR/m² or less?'),
 (10, 'rent_apt', false, '{g} {n}، تدري إن نص الشقق المعروضة للإيجار في {district} ب{city} إيجارها السنوي {a} ريال أو أقل؟',
   '{g} {n}, did you know half the apartments listed for rent in {district}, {city} ask {a} SAR a year or less?'),
 (20, 'shop_rent', false, '{g} {n}، تدري إن نص المحلات المعروضة للإيجار في {district} ب{city} إيجارها السنوي {a} ريال أو أقل؟',
   '{g} {n}, did you know half the shops listed for rent in {district}, {city} ask {a} SAR a year or less?'),
 (52, 'bld_price', false, '{g} {n}، تدري إن نص العمائر المعروضة للبيع في {district} ب{city} سعرها {a} ريال أو أقل؟',
   '{g} {n}, did you know half the buildings listed for sale in {district}, {city} ask {a} SAR or less?'),
 (54, 'villa_price', false, '{g} {n}، تدري إن نص الفلل المعروضة للبيع في {district} ب{city} سعرها {a} ريال أو أقل؟',
   '{g} {n}, did you know half the villas listed for sale in {district}, {city} ask {a} SAR or less?'),
 (15, 'villa_area', false, '{g} {n}، تدري إن نص الفلل المعروضة في {district} ب{city} مساحتها {a} م² أو أقل؟',
   '{g} {n}, did you know half the villas listed in {district}, {city} are {a} m² or smaller?'),
 (19, 'new_build', false, '{g} {n}، تدري إن {a}% من العقارات المعروضة في {district} ب{city} اللي مذكور عمرها جديدة؟',
   '{g} {n}, did you know {a}% of the properties listed in {district}, {city} that state their age are new?'),
 (30, 'new_build', true, '{g} {n}، تدري إن {a}% من العقارات المعروضة في {district} اللي مذكور عمرها جديدة؟',
   '{g} {n}, did you know {a}% of the properties listed in {district} that state their age are new?'),
 (7, 'land_share', false, '{g} {n}، تدري إن {a}% من إعلانات {city} أراضٍ؟',
   '{g} {n}, did you know {a}% of {city}''s listings are land?')
on conflict (id) do update set ar = excluded.ar, en = excluded.en;

create or replace function public.mon_detect_welcome_facts_all_sites_once()
 returns integer language plpgsql security definer set search_path to 'public' as $$
declare n int := 0; live text[] := '{}'; b text; a text; seg text; bad text[] := '{}'; d date; over_n int;
begin
  b := pg_get_functiondef('public.build_welcome_insights'::regproc);
  a := pg_get_functiondef('public.audit_welcome_insights'::regproc);
  -- 1. both count a property on several sites once
  if position('delete from w_b x using w_b y' in b) = 0 or position('x.platform <> y.platform' in b) = 0 then bad := bad || 'builder: no cross-site de-duplication'::text; end if;
  if position('delete from a_b x where exists' in a) = 0 or position('y.platform <> x.platform' in a) = 0 then bad := bad || 'recount: no cross-site de-duplication'::text; end if;
  -- 2. both read every production-ready site (no list of sites narrows the base)
  seg := substring(b from 'create temp table w_b on commit drop as(.*?);');
  if seg is null or position('s.production_ready' in seg) = 0 or seg ~* 'platform\s*(in\s*\(|=\s*''|=\s*any)' then bad := bad || 'builder: base is not every production-ready site'::text; end if;
  seg := substring(a from 'join \(select platform, min\(first_seen_at\) first_ever(.*?);');
  if seg is null or position('s.production_ready' in seg) = 0 or seg ~* 's\.platform\s*(in\s*\(|=\s*''|=\s*any)' then bad := bad || 'recount: base is not every production-ready site'::text; end if;
  -- 3. no count fact exceeds the raw number listed in that city (de-duplication can only lower it)
  select max(day) into d from public.welcome_insight;
  select count(*) into over_n from public.welcome_insight w
   where w.day = d and w.kind in ('city_sale', 'city_land', 'city_bld_sale')
     and w.a::numeric > (select count(*) from public.search_listings_ar s where s.production_ready and s.city_ar = w.city_ar);
  if over_n > 0 then bad := bad || (over_n || ' count fact(s) larger than everything listed in their city')::text; end if;
  if cardinality(bad) > 0 then
    live := live || 'welcome_facts_all_sites_once:fleet'::text;
    n := n + public.mon_raise('P1', 'welcome_facts_all_sites_once', 'fleet', 'welcome_facts_all_sites_once:fleet',
      jsonb_build_object('problems', to_jsonb(bad),
        'why', 'Headline facts must count every site and a property listed on several sites once (owner 2026-10-28).',
        'action', 'Restore the cross-site de-duplication / full base in build_welcome_insights and audit_welcome_insights; never narrow the guard.'));
  end if;
  perform public.mon_resolve_stale_keys('welcome_facts_all_sites_once', live);
  return n;
end $$;

do $roster$
declare d text; anchor text := '''mon_detect_welcome_insights_audit'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_welcome_facts_all_sites_once''' in d) = 0 then
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    execute replace(d, anchor, '''mon_detect_welcome_facts_all_sites_once'', ' || anchor);
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_welcome_facts_all_sites_once''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end $roster$;

-- Apply-time proof.
do $chk$
declare r int;
begin
  if (select count(*) from public.welcome_template where active and ar like '%اكتشف%') > 0 then
    raise exception 'short lines: a line still carries «اكتشفها مع إزهله»';
  end if;
  if (select count(*) from public.welcome_template where active and kind in ('land_ppm_city','land_gap','rent_apt','rent_gap','apt_sale_ppm','villa_price','bld_price','month_apt_ppm','month_land_ppm','month_bld_ppm','shop_rent') and ar not like '%المعروضة%') > 0 then
    raise exception 'short lines: a price line lost «المعروضة»';
  end if;
  r := public.mon_detect_welcome_facts_all_sites_once();
  if exists (select 1 from public.alert_event where dedup_key = 'welcome_facts_all_sites_once:fleet' and resolved_at is null) then
    raise exception 'all-sites-once guard fires on today''s functions — investigate before shipping';
  end if;
end $chk$;
