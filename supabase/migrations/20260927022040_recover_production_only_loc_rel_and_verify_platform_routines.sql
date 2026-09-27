-- RECOVERY, NOT A CHANGE: commit the live definitions of six production-only routines (2026-09-27).
--
-- Migration 20260927014502 (REVOKE on 47 v2-reaching routines, owner-approved) is the first committed
-- SQL to reference five routines that no committed migration creates, so
-- scripts/verify-committed-sql-defines-what-it-calls.ts correctly fails "no NEW production-only
-- object". Its baseline is a one-way ratchet, so the fix is to commit the definitions, not to baseline
-- them:
--   loc_rel_backfill, loc_rel_refresh,  created 2026-06-26 by loc_intelligence_layer,
--   loc_rel_nibble                       loc_intelligence_nibble_backfill and the loc_intelligence_refresh_*
--                                        fixes (in schema_migrations) - none of those files was committed;
--   loc_rel_backfill_large_once,
--   verify_platform_searchable           no recorded migration at all;
--   location_search_candidates           added because verify_platform_searchable calls
--                                        public.location_search_candidates(, which no committed
--                                        migration creates either (its only caller).
--
-- Each body below is pg_get_functiondef() output copied verbatim from production. Applying this is a
-- no-op: CREATE OR REPLACE keeps the owner, the ACL (including 20260927014502's revokes) and comments,
-- and the check at the end aborts the whole migration unless every recreated definition hashes exactly
-- as it did before this ran.

CREATE OR REPLACE FUNCTION public.loc_rel_backfill_large_once()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  perform loc_rel_upsert_table('aqar_residential_listings');
  perform loc_rel_upsert_table('wasalt_residential_listings');
  -- self-unschedule so this never fires again
  perform cron.unschedule('backfill-loc-rel-large-once');
end $function$
;

CREATE OR REPLACE PROCEDURE public.loc_rel_backfill()
 LANGUAGE plpgsql
AS $procedure$
declare r record; n bigint;
begin
  for r in select source_table from loc_rel_scope_tables() order by source_table loop
    n := loc_rel_upsert_table(r.source_table, null);
    raise notice 'backfill % -> % signals', r.source_table, n;
    commit;
  end loop;
end $procedure$
;

CREATE OR REPLACE PROCEDURE public.loc_rel_nibble(IN p_src text, IN p_job_name text, IN p_batch_size integer DEFAULT 10000)
 LANGUAGE plpgsql
AS $procedure$
declare
  v_ids bigint[];
  n     bigint;
begin
  -- Get next batch of listing IDs that haven't been processed yet
  execute format($f$
    select coalesce(array_agg(sub.id), '{}')
    from (
      select t.id
      from %I t
      join active_listing_ids_v2 s
        on s.source_table = %L and s.listing_id = t.id
      join listing_native_location_v2 a
        on a.source_table = %L and a.listing_id = t.id and a.production_ready
      left join loc_rel_processed p
        on p.source_table = %L and p.listing_id = t.id
      where coalesce(t.active, true)
        and p.listing_id is null   -- only unprocessed
      order by t.id
      limit %s
    ) sub
  $f$, p_src, p_src, p_src, p_src, p_batch_size)
  into v_ids;

  if v_ids is null or array_length(v_ids, 1) is null then
    -- All done — self-unschedule
    perform cron.unschedule(p_job_name);
    raise notice 'nibble %: complete, job % unscheduled', p_src, p_job_name;
    return;
  end if;

  n := loc_rel_upsert_table(p_src, v_ids);
  raise notice 'nibble %: % signals from % ids', p_src, n, array_length(v_ids, 1);
  commit;
end $procedure$
;

CREATE OR REPLACE FUNCTION public.loc_rel_refresh()
 RETURNS TABLE(source_table text, deleted_stale bigint, dirty bigint, status text)
 LANGUAGE plpgsql
AS $function$
declare sc record;
begin
  if not exists (select 1 from loc_rel_processed limit 1) then
    raise exception
      'loc_rel_refresh: loc_rel_processed is empty — CALL loc_rel_backfill() first';
  end if;
  for sc in select s.source_table from loc_rel_scope_tables() s order by s.source_table loop
    return query select * from loc_rel_refresh_one(sc.source_table);
  end loop;
end $function$
;

CREATE OR REPLACE FUNCTION public.location_search_candidates(p_purpose text DEFAULT NULL::text, p_cities text[] DEFAULT NULL::text[], p_districts text[] DEFAULT NULL::text[], p_tables text[] DEFAULT NULL::text[], p_platforms text[] DEFAULT NULL::text[], p_per_platform integer DEFAULT 400, p_limit integer DEFAULT 1500, p_region_ids integer[] DEFAULT NULL::integer[])
 RETURNS TABLE(source_table text, listing_id bigint, platform text, last_updated timestamp with time zone, region_ar text, city_ar text, district_ar text)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT source_table, listing_id, platform, last_updated, region_ar, city_ar, district_ar
  FROM (
    SELECT v.source_table, v.listing_id, v.platform, v.last_updated, v.region_ar, v.city_ar, v.district_ar,
           row_number() OVER (PARTITION BY v.platform ORDER BY v.last_updated DESC NULLS LAST) AS rn
    FROM public.listing_native_location_v2 v
    WHERE (v.production_ready OR (p_cities IS NULL AND p_districts IS NULL AND p_region_ids IS NULL))
      AND (p_purpose     IS NULL OR lower(v.transaction_type) = lower(p_purpose))
      AND (p_tables      IS NULL OR v.source_table = ANY(p_tables))
      AND (p_cities      IS NULL OR normalize_ar(v.city_ar)     IN (SELECT normalize_ar(c) FROM unnest(p_cities) c))
      AND (p_districts   IS NULL OR normalize_ar(v.district_ar) IN (SELECT normalize_ar(d) FROM unnest(p_districts) d))
      AND (p_platforms   IS NULL OR v.platform     = ANY(p_platforms))
      AND (p_region_ids  IS NULL OR v.region_id    = ANY(p_region_ids))
  ) t
  WHERE rn <= p_per_platform
  ORDER BY last_updated DESC NULLS LAST
  LIMIT p_limit;
$function$
;

CREATE OR REPLACE FUNCTION public.verify_platform_searchable(p_platform text)
 RETURNS TABLE(check_name text, ok boolean, detail text)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  res_table   text := p_platform || '_residential_listings';
  com_table   text := p_platform || '_commercial_listings';
  res_exists  boolean;
  com_exists  boolean;
  res_active  bigint := 0;
  com_active  bigint := 0;
  in_mv       bigint;
  prod_ready  bigint;
BEGIN
  SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=res_table) INTO res_exists;
  SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=com_table) INTO com_exists;
  RETURN QUERY SELECT 'source_table_exists'::text, (res_exists OR com_exists),
    format('residential: %s, commercial: %s', res_exists, com_exists);

  IF res_exists THEN EXECUTE format('SELECT count(*) FROM public.%I WHERE active = true', res_table) INTO res_active; END IF;
  IF com_exists THEN EXECUTE format('SELECT count(*) FROM public.%I WHERE active = true', com_table) INTO com_active; END IF;
  RETURN QUERY SELECT 'active_source_rows'::text, (res_active + com_active) > 0,
    format('residential_active: %s, commercial_active: %s', res_active, com_active);

  SELECT count(*) FROM public.listing_native_location_v2 WHERE platform = p_platform INTO in_mv;
  RETURN QUERY SELECT 'in_unified_search_view'::text, in_mv > 0,
    format('%s rows in listing_native_location_v2', in_mv);

  SELECT count(*) FROM public.listing_native_location_v2 WHERE platform = p_platform AND production_ready INTO prod_ready;
  RETURN QUERY SELECT 'production_ready_rows'::text, prod_ready > 0,
    format('%s rows are production_ready (have region_id AND city_id)', prod_ready);

  RETURN QUERY SELECT 'rpc_returns_rows'::text,
    EXISTS(SELECT 1 FROM public.location_search_candidates(p_platforms => ARRAY[p_platform], p_limit => 1) LIMIT 1),
    'Tests location_search_candidates(p_platforms => [platform]) returns >=1 row';
END
$function$
;

do $$
declare r record;
begin
  for r in
    select * from (values
      ('public.loc_rel_backfill_large_once()',       '4b8afadafa57e5601f40977ed1706a92'),
      ('public.loc_rel_backfill()',                  '4179a23ba9bc544dc62680dcefb068ed'),
      ('public.loc_rel_nibble(text,text,integer)',   '1feb43800efebf2452d1953cf6fca795'),
      ('public.loc_rel_refresh()',                   '9970f5b0c2193a983b24444c8b73e83c'),
      ('public.location_search_candidates(text,text[],text[],text[],text[],integer,integer,integer[])',
                                                     '6be2e7e2ed0935c45f770a24c21cbbaa'),
      ('public.verify_platform_searchable(text)',    '7d72225eb8a53f06ad24b835e602be6f')
    ) v(sig, expected)
  loop
    if md5(pg_get_functiondef(r.sig::regprocedure)) <> r.expected then
      raise exception 'recovery changed %: definition no longer hashes to %', r.sig, r.expected;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.verify_platform_searchable(text)'::regprocedure, 'execute') then
    raise exception 'CREATE OR REPLACE re-granted anon on verify_platform_searchable';
  end if;
end $$;
