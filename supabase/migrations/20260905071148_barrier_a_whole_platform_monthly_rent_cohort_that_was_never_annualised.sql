-- THE BUG CLASS: a rent scraper labels the period «monthly» and stores the RAW monthly figure in
-- price_annual. src/data/listings.ts then divides by 12, so every one of that platform's monthly
-- listings is advertised to users at one twelfth of its real rent. muktamel shipped this for eight
-- weeks on 130 rows (incident #38); aqarcity shipped the identical defect in 2026-07.
--
-- WHY A NEW BARRIER WHEN ONE ALREADY EXISTS. scripts/verify-rent-scrapers-annualise.ts is a CODE
-- barrier: it proves every scraper routes price_annual through the fleet converter. It went green
-- the moment muktamel's run.py was fixed — while all 130 wrong rows were still being served. That
-- is the §21 retraction trap: removing a defect from code does not retract the data the defective
-- code already wrote, and the muktamel cron is disabled, so no future crawl would ever have
-- corrected them. A code barrier cannot see stored rows. This one reads the data.
--
-- IT MEASURES A COHORT, NEVER A LISTING — and that is deliberate (§8: weird is not wrong). A
-- per-listing floor would be a magnitude heuristic and would fire on rows whose source genuinely
-- publishes a tiny figure: wasalt's cheapest monthly row implies 1 SAR/month and dealapp's 100, and
-- both are source-backed and must be preserved exactly. What no rental market produces is an entire
-- PLATFORM whose median sits there. Measured 2026-09-05, medians in SAR/month: muktamel 188 (the
-- defect) · sanadak 1,500 · aqarcity 1,900 · mustqr 2,500 · dealapp 2,500 · wasalt 2,800 · gathern
-- 6,960 · aqarmonthly 10,800. The 500 floor sits 3x below the lowest legitimate platform and 2.7x
-- above the defect, so it discriminates rather than merely alarms. n >= 20 keeps a handful of rows
-- on a small platform from swinging a median.
--
-- It raises for ADJUDICATION and changes nothing. The remedy is never to reprice a listing: it is
-- to ask whether the scraper annualises, and if it does not, to fix the scraper AND retract the
-- rows it already wrote (both halves, per §21).

create or replace function public.mon_detect_unannualised_rent_cohort()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rec record; n int := 0; live_keys text[] := '{}';
begin
  for rec in
    select s.platform,
           count(*)                                                                       as rows_n,
           round((percentile_cont(0.5) within group (order by s.price_annual))::numeric / 12.0, 2) as med_monthly,
           round(min(s.price_annual)::numeric / 12.0, 2)                                  as min_monthly,
           round(max(s.price_annual)::numeric / 12.0, 2)                                  as max_monthly
      from public.search_listings_ar s
     where s.deal_ar = 'إيجار'
       and s.rent_period_ar = 'شهري'
       and coalesce(s.price_annual, 0) > 0
     group by s.platform
    having count(*) >= 20
       and (percentile_cont(0.5) within group (order by s.price_annual))::numeric / 12.0 < 500
     order by 1
  loop
    live_keys := live_keys || ('unannualised_rent_cohort:' || rec.platform);
    n := n + public.mon_raise('P1', 'unannualised_rent_cohort', rec.platform,
      'unannualised_rent_cohort:' || rec.platform,
      jsonb_build_object(
        'why', 'Every monthly row on this platform is rendered to users at price_annual / 12. This '
             || 'platform''s MEDIAN monthly rent implies ' || rec.med_monthly || ' SAR/month over '
             || rec.rows_n || ' rows, below the ' || 500 || ' SAR floor. No rental market produces '
             || 'that as a median; the usual cause is a scraper that labels the period monthly and '
             || 'stores the raw monthly figure in price_annual, which is a YEARLY column.',
        'adjudicate', 'Read the scraper: does it route price_annual through normalize.annualize_rent '
             || '(or an inline x12) on the monthly branch? If NOT, this is the muktamel/aqarcity '
             || 'defect and BOTH halves are needed - fix the scraper AND retract the rows it already '
             || 'wrote (a code fix never repairs stored data, and it is worse when the platform''s '
             || 'cron is disabled). If it DOES annualise, do not reprice anything: go to the source '
             || 'and establish what it actually publishes. An individual cheap listing is never '
             || 'evidence - this detector deliberately measures the cohort, not the listing.',
        'platform', rec.platform, 'rows', rec.rows_n,
        'median_monthly_sar', rec.med_monthly,
        'min_monthly_sar', rec.min_monthly, 'max_monthly_sar', rec.max_monthly,
        'floor_sar', 500));
  end loop;

  -- Evaluated path only (§23a/§25a): raise and resolve share ONE predicate - the live keys are the
  -- keys this very loop produced, never an independently worded "is it still broken?" clause.
  perform public.mon_resolve_stale_keys('unannualised_rent_cohort', live_keys);
  return n;
end $function$;

comment on function public.mon_detect_unannualised_rent_cohort() is
  'P1. A platform whose ENTIRE monthly-rent cohort implies a median below 500 SAR/month - the '
  'signature of a scraper storing a raw monthly figure in the yearly price_annual column, which the '
  'app then divides by 12 (incident #38, muktamel, 130 rows, 8 weeks). Cohort-level by design: a '
  'per-listing floor would violate source truth. Measured cost ~40 ms. A standing 0 is healthy.';

-- ROSTER WIRING, in the SAME migration (§11a) - a barrier nothing calls is decoration, and
-- mon_detect_orphaned_detectors() fires on any detector nothing reaches.
--
-- Appended by rewriting the LIVE definition rather than re-emitting a snapshot of the array (§26):
-- concurrent sessions add detectors to this same roster, and a wholesale CREATE OR REPLACE from a
-- stale copy would silently drop theirs.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if v_def is null then
    raise exception 'REFUSING: mon_run_all_detectors() not found - cannot wire the barrier';
  end if;

  if position('mon_detect_unannualised_rent_cohort' in v_def) > 0 then
    raise notice 'already wired into the roster; nothing to do';
    return;
  end if;

  if position('''mon_detect_located_row_unreachable''' in v_def) = 0 then
    raise exception 'REFUSING: roster anchor not found - refusing to guess where to append';
  end if;

  v_def := replace(v_def,
    '''mon_detect_located_row_unreachable''',
    '''mon_detect_located_row_unreachable'',' || chr(10) ||
    '    ''mon_detect_unannualised_rent_cohort''');

  execute v_def;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_unannualised_rent_cohort' in v_def) = 0 then
    raise exception 'REFUSING: roster rewrite did not take';
  end if;
end $$;
