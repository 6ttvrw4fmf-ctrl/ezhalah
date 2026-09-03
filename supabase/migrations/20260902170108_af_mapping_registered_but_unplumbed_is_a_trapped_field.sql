-- A SOURCE KEY THE REGISTRY NAMES BUT NOTHING CARRIES IS A TRAPPED FIELD.
--
-- docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md §1 forbids two failure modes equally: fabrication and
-- TRAPPING — "a value the source DID publish that stops somewhere upstream ... and never reaches the
-- user". Found 2026-09-02 during the owner's deep verification: af_platform_mapping records that
-- sanadak publishes property_age as source_capture.buildingAge (683 of 942 active residential rows
-- carry a numeric value), yet search_listings_ar.property_age is NULL on every one of sanadak's
-- 1,099 served rows. The value never leaves the JSON capture: the scraper does not write the raw
-- property_age column, so listing_age_resolved has no sanadak branch, age_source_registry has no
-- sanadak row, and mon_detect_age_resolver_platform_gap — which counts the RAW column — sees
-- nothing to report. Every barrier was green while a protected field sat trapped for a whole platform.
--
-- This detector asks the registry's own question generically: for every (platform, canonical_key)
-- whose source_location is a real capture (not 'not_captured'), if the platform has >= 50 served
-- rows and the index column for that key is NULL on ALL of them, the mapping is decoration. It
-- does not decide what the value means — that judgment belongs to the age registry / field owner —
-- it only refuses to let the gap stay silent. Measured at apply time it flags exactly one row.

create or replace function public.af_mapping_unplumbed()
returns table(platform text, canonical_key text, source text, active_rows bigint)
language plpgsql stable as $fn$
declare r record; v_n bigint; v_rows bigint;
begin
  for r in
    select p.platform, p.canonical_key, p.source_location || '.' || p.source_key as src
      from public.af_platform_mapping p
     where p.source_location <> 'not_captured'
       and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = 'search_listings_ar'
                      and c.column_name = p.canonical_key)
     order by 1, 2
  loop
    execute format('select count(*), count(%I) from public.search_listings_ar where platform = %L',
                   r.canonical_key, r.platform) into v_rows, v_n;
    if v_rows >= 50 and v_n = 0 then
      platform := r.platform; canonical_key := r.canonical_key; source := r.src; active_rows := v_rows;
      return next;
    end if;
  end loop;
end $fn$;

create or replace function public.mon_detect_af_mapping_unplumbed()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_bad jsonb; v_n int;
begin
  select coalesce(jsonb_agg(jsonb_build_object('platform', u.platform, 'field', u.canonical_key,
                                               'registered_source', u.source, 'served_rows', u.active_rows)), '[]'::jsonb),
         count(*)
    into v_bad, v_n
    from public.af_mapping_unplumbed() u;
  if v_n = 0 then
    perform public.mon_resolve_key('af_mapping_unplumbed', 'af_mapping_unplumbed');
    return 0;
  end if;
  return public.mon_raise('P2', 'af_mapping_unplumbed', 'all', 'af_mapping_unplumbed',
    jsonb_build_object('mappings', v_n, 'offenders', v_bad,
      'why', 'af_platform_mapping says this platform publishes the field at the named source key, '
          || 'but the search index carries NO value for it on any served row of that platform. The '
          || 'source published it and nothing carries it to the user - the TRAPPING failure mode of '
          || 'ADVANCED_FILTER_SOURCE_TRUTH.md §1. Every count-based barrier stays green because the '
          || 'column is uniformly NULL, which is also what "the source never said" looks like.',
      'adjudicate', 'Read the captured payload for that platform and confirm the key really carries '
          || 'values. If it does, plumb it end to end (scraper raw column -> view branch -> registry '
          || 'row where a registry exists, e.g. age_source_registry for property_age) in ONE change, '
          || 'with the field''s meaning judged and recorded. If the platform genuinely stopped '
          || 'publishing it, retire the mapping row with a dated note. Never NULL-fill or guess.'));
end $fn$;

comment on function public.mon_detect_af_mapping_unplumbed() is
  'P2: an af_platform_mapping row naming a captured source key while the index carries no value for that platform/field on any served row (a trapped field).';

-- Reach it from the twice-hourly sweep.
do $mig$
declare v_def text; v_new text;
  v_needle constant text := '''mon_detect_af_chip_vs_db_truth'',';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('mon_detect_af_mapping_unplumbed' in v_def) > 0 then return; end if;
  if position(v_needle in v_def) = 0 then raise exception 'anchor not found — refusing to guess'; end if;
  v_new := replace(v_def, v_needle, v_needle || E'\n    ''mon_detect_af_mapping_unplumbed'',');
  if length(v_new) <= length(v_def) then raise exception 'edit did not grow the body'; end if;
  execute v_new;
end
$mig$;

-- MUTATION PROOF. It must fire on the live sanadak gap (a detector that cannot fire is decoration),
-- must NOT fire on a platform whose mapping is plumbed (aqar.elevator carries tens of thousands of
-- values), and must be reachable from the roster.
do $proof$
begin
  if not exists (select 1 from public.af_mapping_unplumbed() where platform = 'sanadak' and canonical_key = 'property_age') then
    raise exception 'expected the live sanadak property_age gap to be flagged';
  end if;
  if exists (select 1 from public.af_mapping_unplumbed() where platform = 'aqar' and canonical_key = 'elevator') then
    raise exception 'a plumbed mapping must not be flagged';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors'
                    and position('mon_detect_af_mapping_unplumbed' in pg_get_functiondef(p.oid)) > 0) then
    raise exception 'detector not on the roster';
  end if;
end
$proof$;
