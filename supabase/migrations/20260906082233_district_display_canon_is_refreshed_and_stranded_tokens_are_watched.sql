-- The canonical district-display table has been frozen since the day it was created.
--
-- `loc_display_district_canon` holds the ONE user-visible rendering per (city_id, normalised
-- district) that SEARCH_MATCH_QA_ENGINEER.md §42.1 requires, and `loc_display_district_ar()`
-- falls back to the RAW label whenever the pair has no row. `refresh_loc_display_district_canon()`
-- exists to keep it current — and nothing has ever called it: every one of its 3,690 rows carries
-- refreshed_at = 2026-08-22 14:24:18, the migration that created it. Fourteen days later 92 of the
-- 3,599 (city, district) pairs the live index actually serves have no canon row at all, so for
-- those districts the "one rendering" guarantee is simply absent, and one of them has already
-- split: city 3525, token «سلام», served as both «السلام» and «حي السلام» — which is the open P2
-- `card_label_contract` (district_rendered_two_ways = 1, alert_event #1459, standing since
-- 2026-09-05).
--
-- Measured before writing (the §42.2 safety question — a relabel must never move the eligible set):
--   candidates 3,599 · brand-new canon rows 92 · CHANGED existing canon rows 0 ·
--   index rows whose served label changes 1 · candidates dropped by the token-preserving guard 1.
-- The refresh is purely additive today: no district that is already canonical moves, and
-- `refresh_loc_display_district_canon()`'s own `where norm_district_tok(display_ar) = tok` clause
-- makes every write token-preserving by construction, so no district search can change its answer.
--
-- Cost: the aggregate is a single seq scan of the 195,783 production-ready rows, 1.09 s measured.
-- Scheduled at :08 so it lands BEFORE the :14 index sync (jobid 28) that writes the labels, clear
-- of the :00/:15/:20 slots AGENTS.md reserves, and not stacked on :10, which jobid 45
-- (district-recovery-pipeline) already holds — PR #1722 is separately unstacking this instance.

select cron.schedule(
  'refresh-district-display-canon',
  '8 * * * *',
  $cron$select public.refresh_loc_display_district_canon();$cron$);

-- ---------------------------------------------------------------------------------------------
-- Barrier 1 — the refresh stopping is what caused this, so watch the refresh, not only its damage.
-- `card_label_contract` already catches the SPLIT. It cannot catch the cause: a canon table that
-- silently stops tracking the index reads as perfectly healthy right up until two spellings of one
-- حي happen to arrive, which took fourteen days here and could take months elsewhere.
-- ---------------------------------------------------------------------------------------------
create or replace function public.mon_detect_district_canon_stale()
returns int language plpgsql as $function$
declare
  v_last    timestamptz;
  v_missing bigint;
  v_rows    bigint;
  n int := 0;
begin
  select max(refreshed_at), count(*) into v_last, v_rows from public.loc_display_district_canon;

  select count(*) into v_missing
    from (select distinct s.city_id, norm_district_tok(s.district_ar) as tok
            from public.search_listings_ar s
           where s.production_ready and s.district_ar is not null and s.city_id is not null) i
    left join public.loc_display_district_canon k
      on k.city_id = i.city_id and k.district_norm = i.tok
   where k.city_id is null;

  -- The refresh runs hourly at :08; three hours is two missed runs, never a timing artefact.
  if v_last is not null and v_last > now() - interval '3 hours' then
    perform public.mon_resolve_key('district_canon_stale','district_canon_stale');
    return 0;
  end if;

  n := public.mon_raise('P2','district_canon_stale','search_index','district_canon_stale',
    jsonb_build_object(
      'canon_rows', v_rows,
      'last_refreshed_at', v_last,
      'index_pairs_with_no_canon_row', v_missing,
      'why','loc_display_district_canon has not been refreshed for over three hours, so the ONE '
            'canonical rendering per (city, district) that SEARCH_MATCH_QA_ENGINEER.md 42.1 '
            'promises is only guaranteed for districts that existed at the last refresh. Every '
            'district that arrives afterwards falls back to whatever raw label its source '
            'published, and the first time two sources spell one district differently a single '
            'result list renders one place two ways. It has no user-visible symptom until then, '
            'which is exactly why it needs its own watch.',
      'fix','pg_cron job refresh-district-display-canon (:08 hourly) runs '
            'refresh_loc_display_district_canon(). Check that the job still exists and is active, '
            'then run the function once by hand; the :14 sync writes the corrected labels. The '
            'refresh is token-preserving by construction and cannot move any search answer.'));
  return n;
end $function$;

-- ---------------------------------------------------------------------------------------------
-- Barrier 2 — a listing stranded OUT of its own district by a doubled prefix.
-- Found the same way, on the same pass: `norm_district_tok()` strips exactly ONE leading «حي »,
-- so a label that carries the prefix twice («حي حي الشرفة», «حي حى الخضراء») normalises to a token
-- that STILL begins with «حي ». That token matches nothing else, so the listing sits alone in a
-- district of its own and a user filtering on the real district never sees it. Eight
-- production-ready listings across two districts are in that state today.
--
-- This detector reports it and does NOT repair it. Both available repairs are out of a QA
-- heartbeat's reach: widening norm_district_tok() to strip repeated prefixes changes the matching
-- predicate of location_search_candidates_ar and eighteen other functions plus the expression
-- index idx_slar_district_tok (AGENTS.md RED list — new search semantics), and rewriting the
-- labels needs source truth this routine cannot establish, since listing_native_location_v2 shows
-- the doubled prefix already present in the captured layer. Routed as an incident with the
-- measurement attached.
-- ---------------------------------------------------------------------------------------------
create or replace function public.mon_detect_district_token_stranded()
returns int language plpgsql as $function$
declare v_n bigint; v_sample jsonb; n int := 0;
begin
  with bad as materialized (
    select s.source_table, s.listing_id, s.platform, s.city_id, s.city_ar, s.district_ar,
           norm_district_tok(s.district_ar) as stranded_token,
           regexp_replace(regexp_replace(norm_district_tok(s.district_ar),'^(حي\s+)+',''),'^ال','')
             as district_it_belongs_to
      from public.search_listings_ar s
     where s.production_ready and s.district_ar is not null
       -- the token is already normalize_ar'd, so «حى » has become «حي » by this point
       and norm_district_tok(s.district_ar) ~ '^حي\s'
  )
  select count(*), (select jsonb_agg(to_jsonb(t)) from (select * from bad limit 10) t)
    into v_n, v_sample from bad;

  if v_n = 0 then
    perform public.mon_resolve_key('district_token_stranded','district_token_stranded');
    return 0;
  end if;

  n := public.mon_raise('P2','district_token_stranded','search_index','district_token_stranded',
    jsonb_build_object(
      'stranded_rows', v_n,
      'sample', v_sample,
      'why','norm_district_tok() strips ONE leading district prefix, so a label carrying it twice '
            'normalises to a token that still begins with that prefix. Nothing else normalises to '
            'that token, so the listing is alone in a district of its own: a user who selects the '
            'real district gets a result list these listings are not in, and the count they see is '
            'short by this many. It is a findability defect (SEARCH_MATCH_QA_ENGINEER.md 8, 16), '
            'not a display one — the served label reads correctly on the card.',
      'fix','Do NOT edit the stored label to make the token come out right: the doubled prefix is '
            'present in listing_native_location_v2 too, so whether the source published it or a '
            'parser built it is a source-truth question (36) owned by the scraping/data-integrity '
            'routines. The other repair — teaching norm_district_tok() to strip repeated prefixes — '
            'changes the matching predicate shared by location_search_candidates_ar, '
            'district_options_ar, af_eligibility_clause and 16 more, and needs the expression index '
            'idx_slar_district_tok reindexed; measured blast radius is exactly 8 rows / 2 tokens '
            'and nothing else in the 3,599-pair space, but it is a search-semantics change and '
            'belongs in a certification run, not a daily one.'));
  return n;
end $function$;

-- ---------------------------------------------------------------------------------------------
-- The card-label alert could name every breach it detects EXCEPT the one that fired.
-- `mon_detect_card_label_contract()` counts six conditions and then builds `sample` from five of
-- them: `district_rendered_two_ways` is missing from the sample's WHERE clause. So alert #1459 —
-- raised on 2026-09-05 for exactly that condition and re-affirmed hourly ever since — carries
-- "sample": null, and finding the offending row took a hand-written group-by that the alert was
-- supposed to save someone. A barrier that reports a breach it cannot point at is half a barrier.
-- ---------------------------------------------------------------------------------------------
create or replace function public.mon_detect_card_label_contract()
returns int language plpgsql as $function$
declare
  n int := 0;
  v_latin bigint; v_city_ne_id bigint; v_admin bigint; v_guessed bigint;
  v_district_ne_canon bigint; v_district_split bigint; v_sample jsonb;
begin
  select count(*) into v_latin from public.search_listings_ar s
   where s.production_ready and (
         s.city_ar ~ '[A-Za-z]' or s.district_ar ~ '[A-Za-z]' or s.region_ar ~ '[A-Za-z]'
      or s.type_ar ~ '[A-Za-z]' or s.deal_ar ~ '[A-Za-z]' or s.rent_period_ar ~ '[A-Za-z]'
      or s.direction_ar ~ '[A-Za-z]' or s.tenant_ar ~ '[A-Za-z]' or s.unit_subtype_ar ~ '[A-Za-z]');

  select count(*) into v_city_ne_id
    from public.search_listings_ar s join public.loc_catalog_city c on c.city_id = s.city_id
   where s.production_ready and s.city_ar is distinct from c.city_ar;

  select count(*) into v_admin from public.search_listings_ar s
   where s.production_ready and (s.city_ar like 'امارة%' or s.city_ar like 'إمارة%'
                                 or s.city_ar like 'منطقة %');

  select count(*) into v_guessed from public.search_listings_ar s
   where s.production_ready and s.city_id is null and s.city_ar is not null;

  select count(*) into v_district_ne_canon
    from public.search_listings_ar s
   where s.production_ready and s.district_ar is not null
     and s.district_ar is distinct from public.loc_display_district_ar(s.city_id, s.district_ar);

  select count(*) into v_district_split from (
    select 1 from public.search_listings_ar
     where production_ready and district_ar is not null
     group by city_id, norm_district_tok(district_ar)
    having count(distinct district_ar) > 1) z;

  if v_latin = 0 and v_city_ne_id = 0 and v_admin = 0 and v_guessed = 0
     and v_district_ne_canon = 0 and v_district_split = 0 then
    perform public.mon_resolve_key('card_label_contract','card_label_contract');
    return 0;
  end if;

  -- The split pairs, resolved once so the sample can name the rows rather than the condition.
  -- This is the arm that was missing: without it a run where district_rendered_two_ways is the
  -- ONLY non-zero count produces "sample": null and tells the reader nothing.
  with split as (
    select city_id, norm_district_tok(district_ar) as tok
      from public.search_listings_ar
     where production_ready and district_ar is not null
     group by city_id, norm_district_tok(district_ar)
    having count(distinct district_ar) > 1
  )
  select jsonb_agg(t) into v_sample from (
    select s.source_table, s.listing_id, s.platform, s.city_id, s.city_ar, s.district_ar, s.region_ar
      from public.search_listings_ar s
      left join public.loc_catalog_city c on c.city_id = s.city_id
     where s.production_ready and (
           s.city_ar ~ '[A-Za-z]' or s.district_ar ~ '[A-Za-z]' or s.type_ar ~ '[A-Za-z]'
        or (c.city_id is not null and s.city_ar is distinct from c.city_ar)
        or s.city_ar like 'امارة%' or s.city_ar like 'إمارة%' or s.city_ar like 'منطقة %'
        or (s.city_id is null and s.city_ar is not null)
        or (s.district_ar is not null
            and s.district_ar is distinct from public.loc_display_district_ar(s.city_id, s.district_ar))
        or exists (select 1 from split p
                    where p.city_id is not distinct from s.city_id
                      and p.tok = norm_district_tok(s.district_ar)))
     limit 8) t;

  n := public.mon_raise('P2','card_label_contract','all','card_label_contract',
    jsonb_build_object(
      'why','What the user SEES on a result card no longer matches the listing/search truth in clean canonical Arabic. Each count below is a distinct breach of the owner rule (2026-08-22).',
      'english_leak_in_arabic_field', v_latin,
      'city_text_ne_city_id',        v_city_ne_id,
      'admin_region_label_as_city',  v_admin,
      'unknown_location_guessed',    v_guessed,
      'district_ne_canonical',       v_district_ne_canon,
      'district_rendered_two_ways',  v_district_split,
      'fix','Labels are written by loc_display_city_ar()/loc_display_district_ar() in sync_search_listings_ar(); backfill_location_display_labels() repairs stored rows. A district_rendered_two_ways breach usually means loc_display_district_canon has no row for that (city, district) — see the district_canon_stale detector.',
      'sample', v_sample));
  return n;
end $function$;

-- ---------------------------------------------------------------------------------------------
-- Roster. A detector nothing calls is decoration (mon_detect_orphaned_detectors fires on it), so
-- both wrappers join the roster in this same migration.
--
-- The roster is a text[] literal inside a 13 KB function that several routines edit, so this
-- rewrites the CURRENT definition read at execution time rather than pasting a copy captured
-- earlier — a stale paste would silently drop whatever another session added in between. It is
-- idempotent: a second run finds the names already present and does nothing.
-- ---------------------------------------------------------------------------------------------
do $roster$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if def is null then
    raise exception 'mon_run_all_detectors() not found — roster entry cannot be added';
  end if;

  if position('mon_detect_district_canon_stale' in def) = 0 then
    def := replace(def,
      '''mon_detect_card_label_contract''',
      '''mon_detect_card_label_contract'',' || chr(10) ||
      '    ''mon_detect_district_canon_stale'',' || chr(10) ||
      '    ''mon_detect_district_token_stranded''');
    if position('mon_detect_district_canon_stale' in def) = 0 then
      raise exception 'anchor mon_detect_card_label_contract not found in the roster — refusing to leave the new detectors unreachable';
    end if;
    execute def;
  end if;
end $roster$;
