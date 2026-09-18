-- Condition A of mon_detect_card_link_identity() asked "do two user-reachable rows share a source
-- URL?" and called every yes the same defect. Its own alert text says the two cases must be told
-- apart — "if the rows are genuinely different properties this is card-A-to-listing-B (§22); if they
-- are one property it is a duplicate-results defect (§30)" — but nothing in the detector did the
-- telling apart, so a source that publishes ONE PAGE PER PROJECT read identically to a platform that
-- had duplicated an ad.
--
-- MEASURED TODAY (2026-09-15, routine-4), the two open alerts, production-ready rows only:
--
--   hajer_residential_listings   119 urls / 120 rows   1 colliding url,     2 rows   =  1.7%
--   rakez_residential_listings   211 urls / 3,676 rows 183 colliding urls, 3,648 rows = 99.2%
--
-- Those are not two degrees of one condition, they are two different facts. hajer publishes a URL
-- per listing and one pair collides — an anomaly worth chasing. rakez's URL is the PROJECT page by
-- construction: 3,648 colliding rows carry 3,648 DISTINCT ad_numbers (0 repeats), i.e. every row is
-- a separate published unit, and scrapers/rakez/run.py:405 records why the project page is used at
-- all — «THE PROJECT PAGE, deliberately — unit.link redirects to the home page». Landing the user on
-- the project page that contains the unit is the closest correct destination the source allows; it is
-- the very thing §22 asks for instead of "platform homepage instead of the listing".
--
-- So the detector now MEASURES the platform's URL granularity from the platform's own data before it
-- judges — the same shape Condition B already uses (assert only where the invariant demonstrably
-- holds). This is NOT a silencer, and AGENTS.md forbids one: it distinguishes cases and both
-- directions stay armed.
--   · per-listing granularity (collisions rare)      -> P2, exactly as before
--   · coarser-than-listing granularity (pervasive)   -> P3 naming the measurement, NOT silence
--   · AND, inside a coarse platform, rows sharing a URL *and* an ad_number are still duplicate
--     copies -> P2. A bug that DUPLICATES listings is therefore still caught at full severity on
--     every platform; only "distinct listings share a coarser source page", which cannot be told
--     from source-level project pages without fetching the source, is downgraded.
-- A table with no ad_number column keeps the old unconditional P2: no evidence, no weakening.
--
-- PROVEN BY EXECUTING THE SHIPPED FUNCTION, both directions, against a synthetic platform inside a
-- rolled-back transaction (2026-09-15):
--   60 rows / 30 shared urls, all ad ids distinct  -> granularity P3 = 1, dupe P2 = 0, share 1.0000
--   the same rows with 5 repeated ad ids           -> granularity P3 = 1, dupe P2 = 1, repeated = 5
-- and then on production: rakez's P2 self-resolved into a P3 (share 0.9924, repeated 0) while
-- hajer's P2 stayed OPEN (share 0.0167). The duplicate half is armed, not muted.
create or replace function public.mon_detect_card_link_identity()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  n int := 0;
  t text;
  v_has_ad boolean;
  v_rows int; v_urls int; v_coll_urls int; v_coll_rows int; v_repeat_ads int; v_sample jsonb;
  v_share numeric;
  v_pr int; v_ok int; v_bad int; v_bad_sample jsonb;
  -- Anchored on the two measurements above (1.7% vs 99.2%): a platform whose source publishes a URL
  -- per listing collides only by mistake, so one row in five sitting on a shared URL is a STRUCTURE,
  -- not an error rate. c_min_rows keeps a brand-new table with a handful of rows from being called
  -- coarse on no evidence.
  c_coarse_share constant numeric := 0.20;
  c_min_rows     constant int     := 50;
begin
  -- ~20h gate: this walks every *_listings table. See ops_detector_last_full_run /
  -- mon_detect_stalled_daily_detector, which watches that this gate cannot silently wedge shut.
  if not public.mon_claim_daily_slot('mon_detect_card_link_identity') then
    return 0;
  end if;

  for t in
    select c.table_name
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name like '%\_listings'
       and c.column_name = 'listing_url'
     order by 1
  loop
    select exists (select 1 from information_schema.columns a
                    where a.table_schema = 'public' and a.table_name = t and a.column_name = 'ad_number')
      into v_has_ad;

    ------------------------------------------------------------------ CONDITION A
    -- Two or more USER-REACHABLE rows in ONE table carrying the same source URL — judged against
    -- what this platform's URLs demonstrably ARE.
    execute format($sql$
      with base as (
        select l.id, l.listing_url u, %s as ad
          from public.%I l
          join public.search_listings_ar s
            on s.source_table = %L and s.listing_id = l.id and s.production_ready
         where l.listing_url is not null and btrim(l.listing_url) <> ''),
      d as (
        select u, count(distinct id) k, count(distinct ad) ads
          from base group by u having count(distinct id) > 1)
      select (select count(*) from base)::int,
             (select count(distinct u) from base)::int,
             (select count(*) from d)::int,
             (select coalesce(sum(k), 0) from d)::int,
             (select coalesce(sum(k - ads), 0) from d)::int,
             coalesce((select jsonb_agg(u) from (select u from d order by u limit 5) x), '[]'::jsonb)
    $sql$, case when v_has_ad then 'l.ad_number::text' else 'l.id::text' end, t, t)
      into v_rows, v_urls, v_coll_urls, v_coll_rows, v_repeat_ads, v_sample;

    v_share := case when coalesce(v_rows, 0) = 0 then 0
                    else v_coll_rows::numeric / v_rows end;

    if coalesce(v_coll_urls, 0) = 0 then
      perform public.mon_resolve_key('card_link_identity', 'card_link_identity:dupe:' || t);
      perform public.mon_resolve_key('card_link_identity', 'card_link_identity:granularity:' || t);

    elsif v_has_ad and v_rows >= c_min_rows and v_share > c_coarse_share then
      -- COARSER THAN A LISTING. Report the structural fact at P3 — visible and adjudicable, never
      -- hidden — and keep the duplicate half armed on the identity the source itself publishes.
      n := n + public.mon_raise(
        'P3', 'card_link_identity', t, 'card_link_identity:granularity:' || t,
        jsonb_build_object(
          'source_table', t,
          'user_reachable_rows', v_rows,
          'distinct_urls', v_urls,
          'colliding_urls', v_coll_urls,
          'rows_in_collisions', v_coll_rows,
          'collision_share', round(v_share, 4),
          'rows_with_a_repeated_ad_number', v_repeat_ads,
          'sample_urls', v_sample,
          'why', 'On this platform a shared listing_url is the NORM, not an anomaly: ' ||
                 round(v_share * 100, 1)::text || '% of user-reachable rows sit on a URL shared with '
              || 'another row, and the rows sharing one URL carry DISTINCT source ad ids. The source '
              || 'page is therefore coarser than a listing (a project/compound page listing many '
              || 'units), so this is a source-granularity fact, not a card-A-to-listing-B defect: '
              || 'the user lands on the page that contains the unit, which is what §22 asks for '
              || 'instead of a platform homepage.',
          'adjudicate', 'Do NOT delete rows to clear this (§36, §30 — similarity is not evidence, and '
              || 'these rows are distinct published units). DO investigate if a platform that used to '
              || 'publish one URL per listing suddenly appears here: a collapse of per-listing URLs '
              || 'onto shared pages would look identical from inside the database, and only the '
              || 'source can tell you which it is. rows_with_a_repeated_ad_number is the half that '
              || 'stays armed — any value above 0 raises the P2 duplicate finding alongside this.'));

      if coalesce(v_repeat_ads, 0) > 0 then
        n := n + public.mon_raise(
          'P2', 'card_link_identity', t, 'card_link_identity:dupe:' || t,
          jsonb_build_object(
            'source_table', t,
            'colliding_urls', v_coll_urls,
            'user_reachable_rows', v_coll_rows,
            'rows_with_a_repeated_ad_number', v_repeat_ads,
            'sample_urls', v_sample,
            'why', 'This platform''s source URL is coarser than a listing, BUT rows sharing a URL '
                || 'also share an ad_number — the source''s own identity. That is a duplicate copy '
                || 'of one ad rendered as several cards (§30), not project-page granularity.'));
      else
        perform public.mon_resolve_key('card_link_identity', 'card_link_identity:dupe:' || t);
      end if;

    else
      -- PER-LISTING granularity (or no ad_number to reason with): a collision is an anomaly.
      n := n + public.mon_raise(
        'P2', 'card_link_identity', t, 'card_link_identity:dupe:' || t,
        jsonb_build_object(
          'source_table', t,
          'colliding_urls', v_coll_urls,
          'user_reachable_rows', v_coll_rows,
          'distinct_urls', v_urls,
          'rows_checked', v_rows,
          'collision_share', round(v_share, 4),
          'rows_with_a_repeated_ad_number', v_repeat_ads,
          'sample_urls', v_sample,
          'why', 'Two or more PRODUCTION-READY rows in this single table carry the SAME source '
              || 'listing_url, so the Normal Filter renders one source ad as several independent '
              || 'cards — and on this platform a per-listing URL is the norm (' ||
                 round(v_share * 100, 1)::text || '% of rows collide), so this is an anomaly rather '
              || 'than the source''s page granularity. If the rows are genuinely different '
              || 'properties this is a card-A-to-listing-B defect (SEARCH_MATCH_QA_ENGINEER.md 22); '
              || 'if they are one property it is a duplicate-results defect (30). '
              || 'mon_detect_url_collisions_res_vs_com only intersects a platform res table against '
              || 'its com table and is blind to a collision inside ONE table. Establish SOURCE TRUTH '
              || 'before dropping either row - similarity is not evidence, but an identical source '
              || 'URL is.'));
      perform public.mon_resolve_key('card_link_identity', 'card_link_identity:granularity:' || t);
    end if;

    ------------------------------------------------------------------ CONDITION B
    -- A user-reachable row whose listing_url carries a source id that is not its own ad_number's.
    -- Only asserted where the platform demonstrably has the invariant (>=50 rows, >=95% holding).
    if v_has_ad then
      execute format($sql$
        select count(*)::int,
               count(*) filter (
                 where position((regexp_match(l.listing_url, '(\d{5,})/?$'))[1] in l.ad_number) > 0
               )::int,
               coalesce((select jsonb_agg(j) from (
                  select jsonb_build_object('id', l2.id, 'ad_number', l2.ad_number, 'url', l2.listing_url) j
                    from public.%I l2
                    join public.search_listings_ar s2
                      on s2.source_table = %L and s2.listing_id = l2.id and s2.production_ready
                   where l2.listing_url ~ '\d{5,}/?$' and l2.ad_number is not null
                     and position((regexp_match(l2.listing_url, '(\d{5,})/?$'))[1] in l2.ad_number) = 0
                   order by l2.id limit 5) y), '[]'::jsonb)
          from public.%I l
          join public.search_listings_ar s
            on s.source_table = %L and s.listing_id = l.id and s.production_ready
         where l.listing_url ~ '\d{5,}/?$' and l.ad_number is not null
      $sql$, t, t, t, t) into v_pr, v_ok, v_bad_sample;

      v_bad := coalesce(v_pr, 0) - coalesce(v_ok, 0);

      if coalesce(v_pr,0) >= 50 and v_bad > 0 and v_ok::numeric / v_pr >= 0.95 then
        n := n + public.mon_raise(
          'P1', 'card_link_identity', t, 'card_link_identity:adid:' || t,
          jsonb_build_object(
            'source_table', t,
            'user_reachable_rows_checked', v_pr,
            'rows_whose_url_is_another_ads', v_bad,
            'invariant_holds_for', v_ok,
            'sample_rows', v_bad_sample,
            'why', 'On this platform the listing_url ends in the ad''s own source id for '
                || 'essentially every row, so these rows point a user at a DIFFERENT property than '
                || 'the card shows - SEARCH_MATCH_QA_ENGINEER.md 22, card A to listing B. These are '
                || 'production_ready, i.e. reachable through the live Normal Filter. Do NOT '
                || 'fabricate a replacement URL (36): establish source truth, then repair.'));
      else
        perform public.mon_resolve_key('card_link_identity', 'card_link_identity:adid:' || t);
      end if;
    end if;
  end loop;

  return n;
end
$function$;
