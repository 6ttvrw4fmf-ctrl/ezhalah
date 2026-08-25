-- CARD → LISTING IDENTITY BARRIER (Search & Matching QA, 2026-08-25)
--
-- WHY THIS EXISTS. docs/ops/SEARCH_MATCH_QA_ENGINEER.md §22 makes "a user must NEVER click one
-- property and land on a different one" this routine's own contract, and §26 requires a
-- link/listing-identity barrier the first time that class is seen. Run 2026-08-25 found it:
--
--   • sanadak_residential_listings — 35 rows whose listing_url ends in a DIFFERENT ad's source id
--     than their own ad_number (25 of those URLs were each carried by two different rows). Blast
--     radius measured: 0 of the 35 are production_ready, so nothing leaked to a user. That is luck,
--     not protection — nothing was watching the invariant.
--   • abeea_residential_listings — 2 URLs each shared by TWO production_ready rows (4 user-reachable
--     cards → 2 properties). Same URL, type, city, حي, deal, price, area, beds; only ad_number
--     differs by one character (ABREA166/ABRE166, ABRE3334/ABRE334) — an ad_number instability that
--     surfaces one source ad as two independent cards (§30 duplicates).
--
-- WHY THE EXISTING DETECTOR DID NOT SEE EITHER. mon_detect_url_collisions_res_vs_com INTERSECTS a
-- platform's residential table against its commercial table. Both findings are collisions INSIDE a
-- single table, so that detector is structurally blind to them. Proven by reading its definition.
--
-- THE INVARIANT CONDITION B ASSERTS is measured, not assumed: across the 14 source tables with >50
-- production-ready rows and a numeric-id URL, the URL's trailing id appears in the row's own
-- ad_number for 200,493 of 200,493 rows — 100.0%. The 0.95 gate below therefore only ever fires on
-- a platform that demonstrably HAS the invariant, so a platform with a different URL scheme cannot
-- raise a false alarm.
--
-- SAFETY. Read-only. It raises and self-heals; it never repairs. Repair needs source truth
-- (§36: never modify data to make a test pass) and belongs to Data Integrity's probe machinery.
-- Expensive (sweeps every source table), so it takes the ~20h slot gate that AGENTS.md prescribes
-- for behavioural detectors — on 23 of 24 sweeps it costs one row read and returns 0.

create or replace function public.mon_detect_card_link_identity()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0;
  t text;
  v_dupe_urls int; v_dupe_rows int; v_sample jsonb;
  v_pr int; v_ok int; v_bad int; v_bad_sample jsonb;
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
    ------------------------------------------------------------------ CONDITION A
    -- Two or more USER-REACHABLE rows in ONE table carrying the same source URL.
    execute format($sql$
      with d as (
        select l.listing_url u, count(distinct l.id) k
          from public.%I l
          join public.search_listings_ar s
            on s.source_table = %L and s.listing_id = l.id and s.production_ready
         where l.listing_url is not null and btrim(l.listing_url) <> ''
         group by l.listing_url
        having count(distinct l.id) > 1)
      select count(*)::int, coalesce(sum(k),0)::int,
             coalesce((select jsonb_agg(u) from (select u from d order by u limit 5) x), '[]'::jsonb)
        from d
    $sql$, t, t) into v_dupe_urls, v_dupe_rows, v_sample;

    if v_dupe_urls > 0 then
      n := n + public.mon_raise(
        'P2', 'card_link_identity', t, 'card_link_identity:dupe:' || t,
        jsonb_build_object(
          'source_table', t,
          'colliding_urls', v_dupe_urls,
          'user_reachable_rows', v_dupe_rows,
          'sample_urls', v_sample,
          'why', 'Two or more PRODUCTION-READY rows in this single table carry the SAME source '
              || 'listing_url, so the Normal Filter renders one source ad as several independent '
              || 'cards. If the rows are genuinely different properties this is a card-A-to-listing-B '
              || 'defect (SEARCH_MATCH_QA_ENGINEER.md 22); if they are one property it is a '
              || 'duplicate-results defect (30). mon_detect_url_collisions_res_vs_com only intersects '
              || 'a platform res table against its com table and is blind to a collision inside ONE '
              || 'table. Establish SOURCE TRUTH before dropping either row - similarity is not '
              || 'evidence, but an identical source URL is.'));
    else
      perform public.mon_resolve_key('card_link_identity', 'card_link_identity:dupe:' || t);
    end if;

    ------------------------------------------------------------------ CONDITION B
    -- A user-reachable row whose listing_url carries a source id that is not its own ad_number's.
    -- Only asserted where the platform demonstrably has the invariant (>=50 rows, >=95% holding).
    if exists (select 1 from information_schema.columns a
                where a.table_schema = 'public' and a.table_name = t and a.column_name = 'ad_number')
    then
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

-- ROSTER ENTRY, in the SAME migration (AGENTS.md: a detector nothing reaches is decoration, and
-- mon_detect_orphaned_detectors fires on it). Appended surgically rather than by re-emitting the
-- ~120-name array, so this cannot clobber a concurrent session's roster edit. Idempotent.
do $roster$
declare src text; newsrc text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors not found - refusing to leave the detector unrostered';
  end if;

  if position('mon_detect_card_link_identity' in src) > 0 then
    return;                                   -- already rostered
  end if;

  if position('''mon_detect_unledgered_hard_delete''' in src) = 0 then
    raise exception 'roster anchor not found - refusing to guess where to append';
  end if;

  newsrc := replace(src,
    '''mon_detect_unledgered_hard_delete''',
    '''mon_detect_unledgered_hard_delete'', ''mon_detect_card_link_identity''');
  execute newsrc;

  -- prove the append actually landed
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_card_link_identity' in src) = 0 then
    raise exception 'roster append did not take effect';
  end if;
end
$roster$;
