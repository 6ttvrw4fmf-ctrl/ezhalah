-- A TABLE TOO SMALL TO PROVE ITS PLATFORM'S URL GRANULARITY MUST NOT BE TOLD IT PROVED THE OPPOSITE
-- (routine-4-search-qa, 2026-09-27).
--
-- mon_detect_card_link_identity classifies a same-URL collision inside one table three ways. The
-- coarse-source branch is guarded by `v_rows >= c_min_rows` (50) for a good reason it states itself:
-- "c_min_rows keeps a brand-new table with a handful of rows from being called coarse on no
-- evidence." That caution is right and is kept.
--
-- THE DEFECT is what happens when that guard declines. The run falls through to the per-listing
-- branch, which asserts as fact:
--
--     "on this platform a per-listing URL is the norm (100.0% of rows collide), so this is an
--      anomaly rather than the source's page granularity"
--
-- With 100% of rows colliding, "a per-listing URL is the norm" is the opposite of what was measured.
-- The detector hands the adjudicator a false premise, at P2, in the sentence they use to decide
-- whether to drop a row - and §30/§36 both turn on that judgement.
--
-- MEASURED 2026-09-27 over every *_listings table carrying listing_url (Condition A, unchanged):
--
--   MISCLASSIFIED - high share, under 50 rows, NO repeated ad_number:
--     alajlan_residential  10 rows,   1 url,  share 1.0000, repeat_ads 0
--     rawaf_residential    19 rows,   1 url,  share 1.0000, repeat_ads 0
--     hasaad_residential   12 rows,   6 urls, share 0.9167, repeat_ads 0
--     azure_residential    32 rows,  11 urls, share 0.9063, repeat_ads 0
--   STRUCTURALLY IDENTICAL and correctly P3 today, only because they cleared 50 rows:
--     rakez 3,574/0.9922 · wahadat 968/0.9876 · razre 57/0.9825 · expattrusted 50/0.9600 ·
--     rightcompound 865/0.9572 · compoundin 186/0.9409 · nufouth_com 118/0.5085 · alsaedan 313/0.4345
--   GENUINE anomalies, unchanged at P2 (low share - a per-listing platform colliding by mistake):
--     almuteb 11/0.1818 · nufouth_res 165/0.1636 · hajer 120/0.0167
--
-- SOURCE TRUTH for the worst example, established before touching anything (§36). rawaf's 19
-- user-reachable rows carry 19 DISTINCT ad_numbers, 14 distinct areas, 11 distinct prices and 2
-- bedroom counts on the single URL https://rawaf.ai/project/114. They are 19 different published
-- units of one project, not 19 copies of one ad - so by this detector's OWN discriminator
-- (rows_with_a_repeated_ad_number, which is 0) there is no duplicate defect to find, and the user
-- who clicks lands on the page that contains the unit, which §22 explicitly accepts. Nothing is
-- deleted, nothing is merged, no source value is touched.
--
-- THE FIX adds the honest third answer instead of picking the wrong one of two. When a shared URL
-- dominates a table that is still too small to prove the platform's structure, AND the source's own
-- identity (ad_number) is distinct on every colliding row, the finding is raised at P3 under its own
-- dedup key `card_link_identity:granularity_unproven:<table>` with a message that says exactly that
-- and refuses to claim either norm. NOTHING IS SUPPRESSED: the finding still raises, still appears
-- on the dashboard, and still has to be adjudicated.
--
-- THE DUPLICATE HALF STAYS ARMED, and is the only thing that can still reach P2 here:
-- `rows_with_a_repeated_ad_number > 0` - two rows sharing a URL *and* the source's own ad id - keeps
-- the P2 duplicate verdict at ANY table size, which is the one shape that is a real §30 defect.
-- Measured today: no table in the fleet has repeat_ads > 0, so this fix hides no existing finding.
--
-- The per-listing branch's sentence is also corrected: it no longer claims "a per-listing URL is the
-- norm" without checking the share it just measured.
--
-- Classification proven as a truth table before applying (11/11, including the two cases that MUST
-- stay P2: a small coarse-looking table WITH a repeated ad_number, and a table with no ad_number at
-- all). Pinned by scripts/verify-card-link-identity-classification.ts in `npm test`.

create or replace function public.mon_detect_card_link_identity()
returns int
language plpgsql
security definer
set search_path = public
as $fn$
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
      perform public.mon_resolve_key('card_link_identity', 'card_link_identity:granularity_unproven:' || t);

    elsif v_has_ad and v_rows >= c_min_rows and v_share > c_coarse_share then
      -- COARSER THAN A LISTING. Report the structural fact at P3 — visible and adjudicable, never
      -- hidden — and keep the duplicate half armed on the identity the source itself publishes.
      perform public.mon_resolve_key('card_link_identity', 'card_link_identity:granularity_unproven:' || t);
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

    elsif v_has_ad and v_share > c_coarse_share and coalesce(v_repeat_ads, 0) = 0 then
      -- TOO SMALL TO PROVE EITHER NORM — and that is what it must say. A shared URL dominates this
      -- table, but it holds fewer than c_min_rows, so the platform's granularity is NOT established
      -- (the branch above deliberately refuses to call a young table coarse on no evidence). The one
      -- thing that IS established is the source's own identity: every colliding row carries a
      -- DISTINCT ad_number, so there is no duplicate copy of any ad here. Raised at P3 under its own
      -- key rather than asserting the false converse at P2. Nothing is suppressed.
      perform public.mon_resolve_key('card_link_identity', 'card_link_identity:dupe:' || t);
      perform public.mon_resolve_key('card_link_identity', 'card_link_identity:granularity:' || t);
      n := n + public.mon_raise(
        'P3', 'card_link_identity', t, 'card_link_identity:granularity_unproven:' || t,
        jsonb_build_object(
          'source_table', t,
          'user_reachable_rows', v_rows,
          'distinct_urls', v_urls,
          'colliding_urls', v_coll_urls,
          'rows_in_collisions', v_coll_rows,
          'collision_share', round(v_share, 4),
          'rows_with_a_repeated_ad_number', v_repeat_ads,
          'min_rows_to_declare_granularity', c_min_rows,
          'sample_urls', v_sample,
          'why', round(v_share * 100, 1)::text || '% of this table''s user-reachable rows sit on a '
              || 'URL shared with another row, which LOOKS like a project/compound page carrying '
              || 'many units — but the table holds only ' || v_rows::text || ' rows, under the '
              || c_min_rows::text || ' this detector needs before it will declare a platform''s URL '
              || 'granularity from data alone. So neither norm is proven here, and this finding '
              || 'deliberately claims NEITHER. What IS proven: every row sharing a URL carries a '
              || 'DISTINCT source ad_number (rows_with_a_repeated_ad_number = 0), so no ad is being '
              || 'served as two cards, and §30 has nothing to act on.',
          'adjudicate', 'Read the sample_urls at SOURCE. If one page lists many separately-published '
              || 'units, this is ordinary project granularity and the correct action is to leave '
              || 'every row alone (§36 — never delete rows to clear a monitor); it will reclassify '
              || 'itself to card_link_identity:granularity once the table passes ' || c_min_rows::text
              || ' rows. If instead the source publishes ONE property per page and these rows are '
              || 'copies, that is a real §30 duplicate — but prove it from the source first, because '
              || 'the ad numbers say they are different ads. Either way the P2 duplicate verdict '
              || 'stays armed on rows_with_a_repeated_ad_number, at any table size.'));

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
              || 'cards. '
              || case
                   when not v_has_ad then
                     'This table has no ad_number, so the source''s own identity cannot be used to '
                     || 'tell a duplicate copy from a coarse source page — that is why this is P2 '
                     || 'rather than a granularity finding, and it is the first thing to establish.'
                   when v_share > c_coarse_share then
                     'A shared URL is common here (' || round(v_share * 100, 1)::text || '% of rows), '
                     || 'so the page may well be coarser than a listing — but rows sharing a URL ALSO '
                     || 'share an ad_number (' || coalesce(v_repeat_ads, 0)::text || ' of them), which '
                     || 'is the source''s OWN identity. That is a duplicate copy of one ad rendered '
                     || 'as several cards (§30), not page granularity.'
                   else
                     'On this platform a per-listing URL is the norm (only ' ||
                     round(v_share * 100, 1)::text || '% of rows collide), so this is an anomaly '
                     || 'rather than the source''s page granularity.'
                 end
              || ' If the rows are genuinely different properties this is a card-A-to-listing-B '
              || 'defect (SEARCH_MATCH_QA_ENGINEER.md §22); if they are one property it is a '
              || 'duplicate-results defect (§30). mon_detect_url_collisions_res_vs_com only '
              || 'intersects a platform res table against its com table and is blind to a collision '
              || 'inside ONE table. Establish SOURCE TRUTH before dropping either row — similarity '
              || 'is not evidence, but an identical source URL is.'));
      perform public.mon_resolve_key('card_link_identity', 'card_link_identity:granularity:' || t);
      perform public.mon_resolve_key('card_link_identity', 'card_link_identity:granularity_unproven:' || t);
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
$fn$;