-- district_display_borrows_number: count only labels a live listing carries (amends 20260928101617).
--
-- Measured after the 11:08 refresh ran the fixed builder: every live numbered label was rewritten
-- (جازان «الرحاب 2» → «الرحاب», الطائف «حي ج7» → «حي ج»). Four rows still carry a digit, all in city
-- 2213 and all seller prose captured as a "district" («النسيم مساحه ٦٠٠»), with ZERO production-ready
-- listings: the refresh is upsert-only, so it never revisits a token nobody carries any more. The arm
-- would have raised on them forever with no customer affected. It now asks the question it exists
-- for: does a LIVE listing wear a borrowed number? (260 ms, one scan the detector already makes.)

CREATE OR REPLACE FUNCTION public.mon_detect_district_canon_stale()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare
  v_last    timestamptz;
  v_missing bigint;
  v_rows    bigint;
  v_numbered bigint;
  v_sample  jsonb;
  n int := 0;
begin
  select max(refreshed_at), count(*) into v_last, v_rows from public.loc_display_district_canon;

  -- ARM 2 (2026-09-28): a display label that still carries a number the token folds away. Such a
  -- label is stamped on every listing of the group, so a card shows a number its source never
  -- published (جازان «الرحاب 2» on wasalt's «الرحاب 1»). Independent of freshness, checked first.
  select count(*), coalesce(jsonb_agg(jsonb_build_object('city_id', k.city_id, 'label', k.display_ar))
                     filter (where k.rn <= 10), '[]'::jsonb)
    into v_numbered, v_sample
    from (select k.*, row_number() over (order by k.city_id, k.district_norm) rn
            from public.loc_display_district_canon k
           where public.loc_district_label_unnumbered(k.display_ar, k.district_norm) is distinct from k.display_ar
             and not exists (select 1 from public.loc_district_number_override o
                              where o.city_id = k.city_id and o.district_norm = k.district_norm)
             -- only a label a live listing still carries: the upsert-only refresh never rewrites an
             -- orphan row, so 4 zero-listing seller-prose rows (city 2213) would otherwise alarm forever.
             and exists (select 1 from public.search_listings_ar s
                          where s.production_ready and s.city_id = k.city_id
                            and s.district_norm_tok = k.district_norm)) k;
  if v_numbered > 0 then
    n := n + public.mon_raise('P2','district_display_borrows_number','search_index','district_display_borrows_number',
      jsonb_build_object('rows', v_numbered, 'sample', v_sample,
        'why','A district display label carries a trailing number that norm_district_tok() folds away, so '
              'every listing in that group is labelled with ONE listing''s number. Cards that fall back to '
              'this label (wasalt, English raw neighborhood) show a number the source never published.',
        'fix','refresh_loc_display_district_canon() must pass its chosen label through '
              'loc_district_label_unnumbered(); the :08 refresh then rewrites these rows.'));
  else
    perform public.mon_resolve_key('district_display_borrows_number','district_display_borrows_number');
  end if;

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
    return n;
  end if;

  n := n + public.mon_raise('P2','district_canon_stale','search_index','district_canon_stale',
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

do $check$
begin
  if position('s.district_norm_tok = k.district_norm' in
       pg_get_functiondef('public.mon_detect_district_canon_stale()'::regprocedure)) = 0 then
    raise exception 'live-listing scope missing from the arm';
  end if;
  if position('district_display_borrows_number' in
       pg_get_functiondef('public.mon_detect_district_canon_stale()'::regprocedure)) = 0 then
    raise exception 'arm missing';
  end if;
end $check$;
