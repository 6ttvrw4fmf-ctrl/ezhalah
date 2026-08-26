-- Barrier: a searchable card must never display an ADMINISTRATIVE label where the مدينة belongs.
--
-- Found from the USER-EXPERIENCE side (Search & Matching QA, 2026-08-22): a card returned by a
-- «الرياض» search rendered its city as «امارة منطقة الرياض - الجبيله», and others render
-- «منطقة الرياض» / «منطقة جازان» — a region/emirate label stored in city_ar. Search INCLUSION is
-- correct (those rows carry a real city_id, so they belong in the result set); what is wrong is the
-- مدينة the user READS on the card. §14 of docs/ops/SEARCH_MATCH_QA_ENGINEER.md.
--
-- Why the existing barrier does not catch it: mon_detect_city_identity_contract fires only when the
-- label RESOLVES to a canonical city — (b) label→exactly-one city, or (c) label→a DIFFERENT city
-- than city_id. «امارة منطقة مكة المكرمة - الطائف» resolves to NOTHING, so it slips through every
-- branch. The 2026-08-18 P3 alert for the «منطقة الرياض» shape was a one-off mon_raise with no
-- detector behind it, so nothing re-checks it and nothing would notice the class growing (it did:
-- it has since acquired the «امارة <region> - <city>» form).
--
-- Deliberately NARROW. 1,153 searchable rows carry a city_ar the catalog cannot resolve, but 1,150
-- of those are legitimate source-published city names with no alias yet («محائل»,
-- «محافظة المذنب», «الدمام و سيهات»). Those are source truth and must NOT be flagged (§36:
-- weird-but-source-published stays). This detector matches ONLY the administrative-label shape.
--
-- This barrier does NOT repair data: the city_ar values live in the inventory, which the Data
-- Integrity engineer owns (docs/ops/DATA_INTEGRITY_ENGINEER.md); PRs #851/#814 are already open on
-- region-scoped city resolution. This makes the class permanently VISIBLE instead of rediscovered.

create or replace function public.mon_detect_city_label_is_admin_region()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; v_searchable bigint; v_total bigint; v_sample jsonb;
begin
  -- The administrative-label shape: an emirate prefix («امارة»/«إمارة», with or without hamza), or
  -- a bare «منطقة X» region label standing where a city name belongs.
  with flagged as (
    select s.source_table, s.listing_id, s.platform, s.city_ar, s.city_id, s.region_id,
           s.production_ready
      from public.search_listings_ar s
     where s.city_ar is not null
       and (s.city_ar like 'امارة%' or s.city_ar like 'إمارة%' or s.city_ar like 'منطقة %')
  )
  select count(*) filter (where production_ready), count(*) into v_searchable, v_total from flagged;

  if v_searchable = 0 then
    perform public.mon_resolve_key('city_label_is_admin_region','city_label_is_admin_region');
    return 0;
  end if;

  select jsonb_agg(t) into v_sample from (
    select s.source_table, s.listing_id, s.platform, s.city_ar, s.city_id, s.region_id
      from public.search_listings_ar s
     where s.production_ready and s.city_ar is not null
       and (s.city_ar like 'امارة%' or s.city_ar like 'إمارة%' or s.city_ar like 'منطقة %')
     order by s.source_table, s.listing_id
     limit 8) t;

  n := public.mon_raise('P3','city_label_is_admin_region','all','city_label_is_admin_region',
    jsonb_build_object(
      'why', 'A searchable listing card displays an ADMINISTRATIVE label as its مدينة '
          || '(e.g. «منطقة الرياض» or «امارة منطقة الرياض - الجبيله») instead of a city name. '
          || 'Search INCLUSION is correct — these rows carry a real city_id — so this is a card '
          || 'DISPLAY defect, not a matching defect. Repair belongs to the Data Integrity engineer '
          || '(inventory/city resolution); this detector exists so the class stays visible.',
      'searchable_rows', v_searchable,
      'rows_all', v_total,
      'not_flagged', 'city_ar values the catalog merely lacks an alias for («محائل», '
          || '«محافظة المذنب») are source truth and are deliberately NOT matched by this detector.',
      'sample', v_sample));
  return n;
end $function$;

comment on function public.mon_detect_city_label_is_admin_region() is
  'Search & Matching QA barrier (2026-08-22, §14/§26): a searchable card must never show an '
  'administrative region/emirate label where the مدينة belongs. Complements '
  'mon_detect_city_identity_contract, which only fires when the label RESOLVES to a canonical city '
  'and therefore cannot see a label that resolves to nothing.';

-- Roster wiring, in the SAME migration (roster rule: mon_detect_orphaned_detectors() fires on any
-- detector nothing reaches). Guarded splice — the pattern from
-- 20260812113005_priceless_rent_with_labelled_source_price_barrier.sql; never re-paste the whole
-- function from a stale base.
do $do$
declare
  src text;
  before_n int;
  after_n int;
  anchor text := '''mon_detect_orphaned_detectors''';
  needle text := ', ''mon_detect_city_label_is_admin_region''';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors not found - refusing to wire blindly';
  end if;

  if position('mon_detect_city_label_is_admin_region' in src) > 0 then
    raise notice 'already wired - no-op';
    return;
  end if;

  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'anchor appears % times, expected exactly 1 - refusing to splice',
      (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  end if;

  before_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');
  src := replace(src, anchor, anchor || needle);
  after_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');

  if after_n <> before_n + 1 then
    raise exception 'roster went from % to % entries, expected exactly +1 - refusing to install',
      before_n, after_n;
  end if;

  if position('mon_detect_city_label_is_admin_region' in src) = 0
     or position('mon_detect_city_identity_contract' in src) = 0
     or position('mon_detect_orphaned_detectors' in src) = 0
     or position('mon_detect_stalled_daily_detector' in src) = 0 then
    raise exception 'post-splice assertion failed - refusing to install';
  end if;

  execute src;
end
$do$;
