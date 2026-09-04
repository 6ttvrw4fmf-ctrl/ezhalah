-- loc_rel refresh for dealapp_residential_listings had not completed since 2026-08-27 16:34.
-- loc_rel_refresh_state read last_status='running' from the 09:34 tick, which pg_cron killed at
-- EXACTLY 120.000s (the ambient statement_timeout; a query_canceled cannot be caught by the
-- function's own EXCEPTION WHEN OTHERS, so the claim is never rewritten to 'error').
--
-- THREE HYPOTHESES WERE MEASURED AND ALL THREE WERE WRONG, recorded so the next run does not
-- repeat them:
--   1. "The 600s cron override on jobid 22 went missing." It did not go missing -- it was
--      DELIBERATELY removed by 20260812115022. loc_rel_refresh_tick() is a PROCEDURE with an
--      internal COMMIT, which Postgres allows only when CALL is the SOLE top-level statement, so
--      prefixing a SET reproduces the 2026-08-06 "invalid transaction termination" outage.
--      scripts/verify-loc-rel-tick-single-statement-cron.ts pins this. Restoring the prefix would
--      have re-created a known outage. (The stale comment inside loc_rel_refresh_tick() still
--      claims that override is live; it is corrected in the same change as this migration.)
--   2. "The dirty batch is too large." It is not: the dirty set was 23 rows, and the batch has
--      been capped at 2500 since 20260812. The cost is BATCH-INDEPENDENT.
--   3. "Statistics are stale / missing." reltuples was accurate to ~5% and every table had full
--      column statistics. A fresh ANALYZE moved wall-clock 15.2s -> 8.6s (buffer warmth) and left
--      the pathological plan completely unchanged.
--
-- ACTUAL ROOT CAUSE: listing_native_location_v2 is a UNION view whose arms cannot see the batch
-- restriction. loc_rel_upsert_table filtered only `t.id = any($1)`, so the planner evaluated the
-- ENTIRE view for the source_table (14,642 rows) and applied the id restriction last, as a top
-- hash join. Inside the view that produced a Nested Loop Left Join with
-- `Join Filter: ("*SELECT* 14".listing_id = v1.listing_id)` over a Materialize of 6,903 rows
-- looped 14,642 times -- measured: Rows Removed by Join Filter = 101,066,837, for a batch of THREE
-- listings. The tick evaluates the view twice in this function alone, so it blew 120s regardless of
-- batch size. It is not a regression in this function: it flipped when dealapp_residential_listings
-- autoanalyzed at 2026-08-28 02:47, between the last success (08-27 16:34, 8.2s) and the first
-- failure (08-28 09:34).
--
-- FIX: also restrict the view side by the same id array. `a.listing_id = any($1)` is LOGICALLY
-- IMPLIED by the existing `a.listing_id = t.id and t.id = any($1)`, so it cannot change the result
-- set -- it only hands the optimizer a predicate it can push into each UNION arm. Measured on the
-- identical 3-id batch, same rows returned (2):
--     before 8,619 ms  ->  after 211 ms   (41x), Rows Removed by Join Filter 101,066,837 -> 20,707
-- and the view's arms switch to `Index Scan using lnl_v1_pk`.
--
-- This touches ONLY loc_rel (proximity-ranking signals via loc_rel_rank). It does NOT touch
-- listing_native_location_v2, search_listings_ar, or location_search_candidates_ar, so no Normal
-- Filter result, count or ordering can move: SS18 digest parity is not engaged by this change.

create or replace function public.loc_rel_upsert_table(p_src text, p_ids bigint[] DEFAULT NULL::bigint[])
 returns bigint
 language plpgsql
as $function$
declare r record; v_sql text; v_proc text; n bigint; cap_expr text; id_filter text;
begin
  select * into r from loc_rel_scope_tables() where source_table = p_src;
  if not found then raise exception 'loc_rel_upsert_table: % not in scope', p_src; end if;

  cap_expr  := case when r.has_capture then 't.source_capture' else 'null::jsonb' end;
  -- BATCH PREDICATE PUSHDOWN (2026-08-28): `a.listing_id = any($1)` is implied by
  -- `a.listing_id = t.id and t.id = any($1)` and is therefore result-preserving. Without it the
  -- planner materialises the whole listing_native_location_v2 UNION for the source_table before
  -- applying the batch restriction (101M-row join filter for a 3-row batch). Do not remove.
  id_filter := case when p_ids is null then ''
                    else 'and t.id = any($1) and a.listing_id = any($1)' end;

  v_sql := format($f$
    insert into listing_location_relations
      (platform, source_table, category_group, listing_id, country,
       region_id, city_id, district_id, region_ar, city_ar, district_ar,
       relationship_group, original_relationship_phrase, landmark_category,
       landmark_category_en, specific_landmark_name, specific_landmark_norm,
       matched_text, matched_field, evidence_strength, confidence, source_text_hash)
    select %L, %L, %L, t.id, 'السعودية',
           a.region_id, a.city_id,
           (select d.district_id from loc_catalog_district d
             where d.city_id = a.city_id
               and normalize_ar(loc_rel_strip_hayy(d.district_ar))
                 = normalize_ar(loc_rel_strip_hayy(a.district_ar))
             limit 1),
           a.region_ar, a.city_ar, a.district_ar,
           x.relationship_group, x.original_relationship_phrase, x.landmark_category,
           x.landmark_category_en, x.specific_landmark_name, normalize_ar(x.specific_landmark_name),
           x.matched_text, x.matched_field, x.evidence_strength, x.confidence,
           loc_rel_source_hash(t.title, t.description, %s)
    from %I t
    join active_listing_ids_v2 s
      on s.source_table = %L and s.listing_id = t.id
    join listing_native_location_v2 a
      on a.source_table = %L and a.listing_id = t.id and a.production_ready
    cross join lateral extract_location_relations_for(t.title, t.description, %s) x
    where coalesce(t.active, true) %s
    on conflict on constraint ux_llr_signal do nothing
  $f$, r.platform, r.source_table, r.category_group, cap_expr,
       r.source_table, r.source_table, r.source_table, cap_expr, id_filter);

  if p_ids is null then execute v_sql; else execute v_sql using p_ids; end if;
  get diagnostics n = row_count;

  -- DISTINCT ON (t.id): listing_native_location_v2 may return multiple rows per
  -- listing (multiple location matches). The DO UPDATE path in the processed
  -- upsert would then try to update the same row twice → "cannot affect row a
  -- second time". One processed record per listing is all we need.
  v_proc := format($p$
    insert into loc_rel_processed (source_table, listing_id, source_text_hash)
    select distinct on (t.id) %L, t.id, loc_rel_source_hash(t.title, t.description, %s)
    from %I t
    join active_listing_ids_v2 s
      on s.source_table = %L and s.listing_id = t.id
    join listing_native_location_v2 a
      on a.source_table = %L and a.listing_id = t.id and a.production_ready
    where coalesce(t.active, true) %s
    order by t.id
    on conflict (source_table, listing_id)
      do update set source_text_hash = excluded.source_text_hash, processed_at = now()
  $p$, r.source_table, cap_expr, r.source_table, r.source_table, r.source_table, id_filter);
  if p_ids is null then execute v_proc; else execute v_proc using p_ids; end if;

  return n;
end $function$;
