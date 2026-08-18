-- BARRIER: the Gathern rating in the search index must equal what the source publishes, and the
-- three source-truth rules must hold on every row, forever. Ratings are about to become a user-facing
-- filter; a drifted or fabricated rating is worse than no rating at all.
--
-- Checks (all measured against the RAW table, which is the only truth):
--   1. PARITY — index rating/reviews/subtype == raw additional_info, recomputed with the same rules.
--   2. LABEL RULE — «لا يوجد تقييم» ⇒ index rating IS NULL. Gathern is declining to publish; the 444
--      Monthly rows carrying a stale numeric behind that label must never be searchable as rated.
--   3. NO FABRICATION — no non-Gathern row may ever carry a rating. No other platform publishes one
--      (and wasalt packageScore is PAID PLACEMENT — never a star rating; see project memory).
--   4. PAIRING — reviews_count is never present without a rating, so a threshold like "9.0+ with 10+
--      reviews" can never silently match a row whose rating we do not actually know.
--   5. SCALE — the source declares bestRating 10 / worstRating 1. Anything outside 1..10 is a parser
--      fault, not a rating.
--   6. FRESH CAPTURE COLLAPSE — if fresh Gathern listings suddenly stop carrying ratings while the
--      back catalogue keeps them, the scraper has broken. Measured on the fresh band only, and only
--      once there are enough fresh rows for the ratio to mean anything.
create or replace function public.mon_detect_gathern_rating_source_truth()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_parity bigint; v_label bigint; v_nongathern bigint; v_pairing bigint; v_scale bigint;
  v_fresh_total bigint; v_fresh_rated bigint; v_fresh_pct numeric; n int := 0; bad jsonb := '[]'::jsonb;
begin
  with raw as (
    select g.id,
      case when btrim(coalesce(g.additional_info->>'rate_text','')) = 'لا يوجد تقييم' then null
           when g.additional_info->>'rating' ~ '^[0-9]+(\.[0-9]+)?$'
            and (g.additional_info->>'rating')::numeric between 1 and 10
             then round((g.additional_info->>'rating')::numeric,1) end r,
      case when btrim(coalesce(g.additional_info->>'rate_text','')) = 'لا يوجد تقييم' then null
           when g.additional_info->>'rating' ~ '^[0-9]+(\.[0-9]+)?$'
            and (g.additional_info->>'rating')::numeric between 1 and 10
            and g.additional_info->>'reviews_count' ~ '^[0-9]+$'
             then (g.additional_info->>'reviews_count')::int end rc,
      nullif(btrim(coalesce(g.additional_info->>'unit_type_ar','')),'') st,
      btrim(coalesce(g.additional_info->>'rate_text','')) label
    from gathern_residential_listings g
  )
  select
    count(*) filter (where s.rating is distinct from raw.r
                        or s.reviews_count is distinct from raw.rc
                        or s.unit_subtype_ar is distinct from raw.st),
    count(*) filter (where raw.label = 'لا يوجد تقييم' and s.rating is not null)
  into v_parity, v_label
  from search_listings_ar s join raw on raw.id = s.listing_id
  where s.source_table = 'gathern_residential_listings';

  select count(*) into v_nongathern from search_listings_ar
   where rating is not null and source_table <> 'gathern_residential_listings';
  select count(*) into v_pairing from search_listings_ar
   where reviews_count is not null and rating is null;
  select count(*) into v_scale from search_listings_ar
   where rating is not null and (rating < 1 or rating > 10);

  if v_parity > 0 then bad := bad || jsonb_build_object('kind','index_diverges_from_source','rows',v_parity); end if;
  if v_label  > 0 then bad := bad || jsonb_build_object('kind','no_rating_label_ignored','rows',v_label); end if;
  if v_nongathern > 0 then bad := bad || jsonb_build_object('kind','rating_on_non_gathern_platform','rows',v_nongathern); end if;
  if v_pairing > 0 then bad := bad || jsonb_build_object('kind','reviews_without_rating','rows',v_pairing); end if;
  if v_scale > 0 then bad := bad || jsonb_build_object('kind','rating_outside_source_scale','rows',v_scale); end if;

  -- 6. fresh-capture collapse
  select count(*), count(*) filter (where rating is not null)
    into v_fresh_total, v_fresh_rated
  from search_listings_ar
  where source_table='gathern_residential_listings' and production_ready
    and first_seen_at >= now() - interval '7 days';
  if v_fresh_total >= 100 then
    v_fresh_pct := round(100.0 * v_fresh_rated / v_fresh_total, 1);
    -- The standing all-time rate is ~85%. Fresh listings legitimately start unrated (no reviews yet),
    -- so this is a COLLAPSE detector, not a coverage target: it fires only if essentially nothing
    -- fresh carries a rating, which means the capture broke rather than the market changed.
    if v_fresh_pct < 15 then
      bad := bad || jsonb_build_object('kind','fresh_rating_capture_collapse',
        'fresh_rows', v_fresh_total, 'fresh_rated', v_fresh_rated, 'pct', v_fresh_pct);
    end if;
  end if;

  if jsonb_array_length(bad) > 0 then
    n := public.mon_raise('P1','gathern_rating_source_truth','gathern','gathern_rating_source_truth',
      jsonb_build_object('failures', bad,
        'why','The Gathern rating is a user-facing filter. It must equal the source exactly, must be '
           || 'NULL whenever Gathern says «لا يوجد تقييم», must never appear on a platform that does '
           || 'not publish ratings, and UNKNOWN must never be searchable as rated. Fix the sync or '
           || 'the parser — never the displayed number.'));
  else
    perform public.mon_resolve_key('gathern_rating_source_truth','gathern_rating_source_truth');
  end if;
  return n;
end $$;

-- Roster wiring in the SAME migration (AGENTS.md: a detector nothing reaches is decoration, and
-- mon_detect_orphaned_detectors() fires on it). Needle-edit of the LIVE body so the rest of the
-- roster — which concurrent sessions also touch — is preserved byte-for-byte.
do $$
declare src text; newsrc text;
begin
  select prosrc into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='mon_run_all_detectors';
  if src is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('mon_detect_gathern_rating_source_truth' in src) > 0 then
    raise notice 'already on the roster — no-op'; return;
  end if;
  if position('''mon_detect_rent_period_source_mismatch''' in src) = 0 then
    raise exception 'anchor mon_detect_rent_period_source_mismatch missing from roster';
  end if;
  newsrc := replace(src,
    '''mon_detect_rent_period_source_mismatch''',
    '''mon_detect_rent_period_source_mismatch'',' || chr(10) ||
    '    ''mon_detect_gathern_rating_source_truth''');
  execute format(
    'create or replace function public.mon_run_all_detectors() returns jsonb '
    'language plpgsql security definer set search_path to ''public'' as %L', newsrc);
end $$;

select public.mon_detect_gathern_rating_source_truth() as fired_now;