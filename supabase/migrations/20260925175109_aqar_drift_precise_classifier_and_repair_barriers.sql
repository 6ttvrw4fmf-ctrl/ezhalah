-- Aqar drift: full 2,146-row audit, 1,322-row repair, and precise barriers (2026-09-25).
--
-- Context: mon_detect_aqar_shadow_resolution_drift() (PR #4378, this session) was a coarse
-- growth-ratchet on ANY disagreement between aqar_shadow_resolved's frozen parsed_city_id and a
-- fresh re-run of resolve_aqar_locations()'s own join logic. The owner asked for the full 2,146-row
-- set to be individually classified before any bulk action, per docs/ops/DATA_INTEGRITY_ENGINEER.md
-- §32 and this session's audit. Every row was classified into exactly one of:
--   PROVEN_WRONG     - the listing's OWN neighborhood field matches a real catalog district under
--                       the fresh city and NOT under the old (frozen) city. Concrete, per-row proof.
--   SOURCE_CONFLICT  - the reverse: neighborhood matches a district under the OLD city, not fresh.
--                       The ad's own data contradicts our fresh recompute - never auto-correct.
--   AMBIGUOUS        - neighborhood matches districts under BOTH cities, or under NEITHER and the
--                       old value isn't a recognizable region/governorate name. No reliable evidence.
--   GOVERNORATE      - old_city_ar is a real region name (e.g. "جازان") or Al-Ahsa specifically -
--                       docs/ops/DERIVED_STORE_FRESHNESS.md §3/§6 already flags «الاحساء»→«الهفوف»
--                       as "the reserved taxonomy question - owner's decision, untouched", and
--                       loc_city_cluster still actively clusters city_id 3677+12 under 'al_ahsa'
--                       (migration 20260831195108, reversing the July 20260720171946 removal) - a
--                       live, unsettled product question, never a bug to silently resolve here.
-- Result: 1,322 PROVEN_WRONG rows repaired (aqar_shadow_resolved + search_listings_ar +
-- aqar_resolver_log) and verified. 824 rows (GOVERNORATE 406 / AMBIGUOUS 335 / SOURCE_CONFLICT 83)
-- deliberately left untouched - see the session report for the full breakdown and examples.
--
-- This migration replaces the coarse ratchet with three precise, mutation-provable detectors and
-- adds a cheap, zero-noise, FLEET-WIDE (not aqar-only) city/region consistency check. A naive
-- fleet-wide "does this district exist under some OTHER city" check was tried and rejected: Saudi
-- district names repeat heavily across unrelated cities (generic names like حي النزهة), producing
-- 92,400+ false positives even restricted to cross-region matches - not a usable barrier. The
-- district-level check therefore stays scoped to aqar, where a per-listing alternate candidate
-- (the source's own raw English city field, re-resolved through the CURRENT loc_city_map) gives a
-- real, relative signal instead of a blind global join.

-- ── Reusable classifier: same logic as the session's audit, callable any time ──────────────────
create or replace function public.aqar_classify_shadow_drift()
returns table(
  src_table text, id bigint, raw_city text, neighborhood text,
  old_city_ar text, old_city_id int,
  fresh_city_ar text, fresh_city_id int, fresh_region_ar text, fresh_region_id int,
  category text
)
language sql
stable
as $function$
  with fresh_res as (
    select distinct on (a.id) 'aqar_residential_listings'::text as src_table, a.id, a.city as raw_city, a.neighborhood,
           cc.city_id as fresh_city_id, cc.city_ar as fresh_city_ar, cr.region_id as fresh_region_id, cr.region_ar as fresh_region_ar
    from aqar_residential_listings a
    join loc_city_map cm on cm.city_key = lower(btrim(a.city))
    join loc_catalog_region cr on cr.region_ar = cm.region_ar
    join loc_catalog_city cc on cc.region_id = cr.region_id
      and (normalize_ar(cc.city_ar) = normalize_ar(cm.city_ar)
           or exists (select 1 from loc_catalog_city_alias al where al.alias_norm = normalize_ar(cm.city_ar) and al.city_id = cc.city_id))
    where a.active
    order by a.id, cc.city_id
  ),
  fresh_com as (
    select distinct on (a.id) 'aqar_commercial_listings'::text as src_table, a.id, a.city as raw_city, a.neighborhood,
           cc.city_id as fresh_city_id, cc.city_ar as fresh_city_ar, cr.region_id as fresh_region_id, cr.region_ar as fresh_region_ar
    from aqar_commercial_listings a
    join loc_city_map cm on cm.city_key = lower(btrim(a.city))
    join loc_catalog_region cr on cr.region_ar = cm.region_ar
    join loc_catalog_city cc on cc.region_id = cr.region_id
      and (normalize_ar(cc.city_ar) = normalize_ar(cm.city_ar)
           or exists (select 1 from loc_catalog_city_alias al where al.alias_norm = normalize_ar(cm.city_ar) and al.city_id = cc.city_id))
    where a.active
    order by a.id, cc.city_id
  ),
  fresh as (select * from fresh_res union all select * from fresh_com),
  drift as (
    select f.*, s.city_ar_parsed as old_city_ar, s.parsed_city_id as old_city_id
    from fresh f
    join aqar_shadow_resolved s on s.src_table = f.src_table and s.id = f.id
    where s.parsed_city_id is not null
      and s.parsed_city_id <> f.fresh_city_id
      and normalize_ar(s.city_ar_parsed) <> normalize_ar(f.fresh_city_ar)
  ),
  sig as (
    select d.*,
      exists(select 1 from loc_catalog_district dd where dd.city_id = d.fresh_city_id and dd.district_norm = norm_district_tok(d.neighborhood)) as dist_matches_fresh,
      exists(select 1 from loc_catalog_district dd where dd.city_id = d.old_city_id and dd.district_norm = norm_district_tok(d.neighborhood)) as dist_matches_old,
      exists(select 1 from loc_catalog_region r where normalize_ar(regexp_replace(r.region_ar,'^(منطقة|المنطقة)\s+','')) = normalize_ar(d.old_city_ar))
        as old_is_region_capital
    from drift d
  )
  select sig.src_table, sig.id, sig.raw_city, sig.neighborhood,
         sig.old_city_ar, sig.old_city_id, sig.fresh_city_ar, sig.fresh_city_id, sig.fresh_region_ar, sig.fresh_region_id,
    case
      when dist_matches_fresh and not dist_matches_old then 'PROVEN_WRONG'
      when dist_matches_old and not dist_matches_fresh then 'SOURCE_CONFLICT'
      when dist_matches_fresh and dist_matches_old then 'AMBIGUOUS'
      when old_is_region_capital or normalize_ar(old_city_ar) = normalize_ar('الاحساء') then 'GOVERNORATE'
      else 'AMBIGUOUS'
    end as category
  from sig;
$function$;

comment on function public.aqar_classify_shadow_drift() is
  'Classifies every aqar_shadow_resolved row that disagrees with a fresh re-run of resolve_aqar_locations() into PROVEN_WRONG / SOURCE_CONFLICT / AMBIGUOUS / GOVERNORATE, using the listing''s own neighborhood field matched against loc_catalog_district as per-row evidence. See migration 20260925175109 for the full method and the 2026-09-25 audit.';

-- ── Detector 1: unambiguous new drift (must be 0 - this is a real bug when it fires) ────────────
create or replace function public.mon_detect_aqar_proven_wrong_resolution()
returns int
language plpgsql
as $function$
declare
  n int;
  sample jsonb;
begin
  select count(*) into n from public.aqar_classify_shadow_drift() where category = 'PROVEN_WRONG';

  if n > 0 then
    select jsonb_agg(jsonb_build_object(
             'src_table', src_table, 'id', id, 'raw_city', raw_city,
             'old_city_ar', old_city_ar, 'fresh_city_ar', fresh_city_ar, 'neighborhood', neighborhood))
      into sample
      from (select * from public.aqar_classify_shadow_drift() where category = 'PROVEN_WRONG' limit 10) s;
    perform public.mon_raise('P1', 'aqar_proven_wrong_resolution', 'aqar',
      'aqar_proven_wrong_resolution:' || current_date,
      jsonb_build_object('count', n, 'sample', sample,
        'why', 'the listing''s own neighborhood field matches a real catalog district under a '
            || 'DIFFERENT city than the one aqar_shadow_resolved currently serves for it - this is '
            || 'concrete, per-row proof of a wrong city, not a taxonomy question.',
        'fix', 'update aqar_shadow_resolved.{city_ar_parsed,region_ar_parsed,parsed_city_id} and '
            || 'the matching search_listings_ar row to the fresh values from '
            || 'aqar_classify_shadow_drift(), then log to aqar_resolver_log.'));
  else
    perform public.mon_resolve_key('aqar_proven_wrong_resolution', 'aqar_proven_wrong_resolution:' || current_date);
  end if;

  return n;
end;
$function$;

-- ── Detector 2: the deliberately-untouched backlog (growth ratchet, never demands 0) ────────────
create or replace function public.mon_detect_aqar_unresolved_drift_backlog()
returns int
language plpgsql
as $function$
declare
  baseline constant int := 824; -- GOVERNORATE(406) + AMBIGUOUS(335) + SOURCE_CONFLICT(83), measured
                                 -- immediately after the 2026-09-25 1,322-row PROVEN_WRONG repair.
  cur int;
  excess int;
begin
  select count(*) into cur from public.aqar_classify_shadow_drift()
    where category in ('GOVERNORATE', 'AMBIGUOUS', 'SOURCE_CONFLICT');
  excess := greatest(0, cur - baseline);

  if excess > 0 then
    perform public.mon_raise('P3', 'aqar_unresolved_drift_backlog', 'aqar',
      'aqar_unresolved_drift_backlog:' || current_date,
      jsonb_build_object('current', cur, 'baseline', baseline, 'excess', excess,
        'why', 'these rows have no per-row district proof either way, or are a live taxonomy '
            || 'question (see docs/ops/DERIVED_STORE_FRESHNESS.md) - never auto-corrected. This is '
            || 'a ratchet so the untouched backlog cannot silently grow without anyone noticing, '
            || 'not a demand that it reach zero.'));
  else
    perform public.mon_resolve_key('aqar_unresolved_drift_backlog', 'aqar_unresolved_drift_backlog:' || current_date);
  end if;

  return excess;
end;
$function$;

-- ── Detector 3: city/region agreement, FLEET-WIDE (cheap, zero-noise, every platform) ───────────
-- A naive district-level fleet-wide check was tried (see migration header) and produced 92,400+
-- false positives from ordinary district-name reuse across unrelated cities. City -> region is a
-- clean catalog FK with no such ambiguity, so this stays a hard zero-tolerance barrier.
create or replace function public.mon_detect_city_region_mismatch()
returns int
language plpgsql
as $function$
declare
  n int;
  sample jsonb;
begin
  select count(*) into n
    from search_listings_ar sl
    join loc_catalog_city c on c.city_id = sl.city_id
    where sl.production_ready and sl.city_id is not null and sl.region_id is not null
      and c.region_id <> sl.region_id;

  if n > 0 then
    select jsonb_agg(jsonb_build_object(
             'source_table', sl.source_table, 'listing_id', sl.listing_id, 'platform', sl.platform,
             'city_ar', sl.city_ar, 'served_region_ar', sl.region_ar, 'catalog_region_id', c.region_id))
      into sample
      from search_listings_ar sl
      join loc_catalog_city c on c.city_id = sl.city_id
      where sl.production_ready and sl.city_id is not null and sl.region_id is not null
        and c.region_id <> sl.region_id
      limit 10;
    perform public.mon_raise('P1', 'city_region_mismatch', 'all',
      'city_region_mismatch:' || current_date,
      jsonb_build_object('count', n, 'sample', sample,
        'why', 'a production_ready row''s served region_id does not match its own city_id''s '
            || 'region in loc_catalog_city - a district from one region cannot legitimately be '
            || 'paired with a different region''s city (rule: district must belong to the matched '
            || 'city, and city must agree with region).'));
  else
    perform public.mon_resolve_key('city_region_mismatch', 'city_region_mismatch:' || current_date);
  end if;

  return n;
end;
$function$;

-- ── Roster: swap the old coarse detector for the three precise ones, via the function's own
-- canonical source text (never hand-retyped, so this cannot silently miss or duplicate the array).
do $roster$
declare
  src text;
  new_src text;
begin
  select pg_get_functiondef(oid) into src from pg_proc where proname = 'mon_run_all_detectors';
  if src is null then
    raise exception 'mon_run_all_detectors not found';
  end if;

  new_src := replace(src,
    $Q$'mon_detect_aqar_shadow_resolution_drift',$Q$,
    $Q$'mon_detect_aqar_proven_wrong_resolution',
    'mon_detect_aqar_unresolved_drift_backlog',
    'mon_detect_city_region_mismatch',$Q$);

  if new_src = src then
    raise exception 'roster substitution matched nothing - mon_detect_aqar_shadow_resolution_drift not found in the array, aborting to avoid silently leaving the roster unchanged';
  end if;

  execute new_src;
end;
$roster$;

drop function if exists public.mon_detect_aqar_shadow_resolution_drift();

-- ── Reachability: every new detector must actually be invocable and present in the roster ───────
do $check$
declare
  fn text;
  fns text[] := array['mon_detect_aqar_proven_wrong_resolution',
                       'mon_detect_aqar_unresolved_drift_backlog',
                       'mon_detect_city_region_mismatch'];
  roster text;
begin
  select array_to_string((select fns2 from (select regexp_matches(pg_get_functiondef(oid), $R$fns text\[\] := array\[(.*?)\];$R$, 'ns') as fns2) x), ',')
    into roster
    from pg_proc where proname = 'mon_run_all_detectors';

  foreach fn in array fns loop
    perform 1 from pg_proc where proname = fn;
    if not found then
      raise exception 'detector % does not exist', fn;
    end if;
    if roster is null or position(quote_literal(fn) in roster) = 0 then
      raise exception 'detector % is not wired into mon_run_all_detectors', fn;
    end if;
    execute format('select public.%I()', fn);
  end loop;
end;
$check$;
