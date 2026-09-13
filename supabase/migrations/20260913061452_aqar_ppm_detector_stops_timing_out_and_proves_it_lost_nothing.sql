-- The aqar PPM-as-total price-fidelity detector (pg_cron jobid 63, mon-aqar-ppm-as-total) has been
-- ABORTING roughly twice a day on `canceling statement due to statement timeout`, at
-- mon_detect_aqar_ppm_as_total() line 4 — the `select count(*) from public.mon_aqar_ppm_as_total`.
-- Each abort is one hour in which the highest-severity price-fidelity question in the system
-- ("is a per-meter rate being served as a total price?") was NOT asked, while every point-in-time
-- health read still looked green. A monitor that cannot fire reads as a clean bill of health.
--
-- CAUSE, measured 2026-09-13: the view evaluated aqar_published_ppm(txt) plus a second
-- regexp_match over source_capture->>'source_text' for EVERY active aqar Buy row carrying a
-- capture — 60,828 rows, averaging 2,730 characters each. Typical run 24 s; the tail exceeds the
-- 120 s statement_timeout.
--
-- FIX: a literal-substring prefilter that is a NECESSARY CONDITION of both regexes, so it cannot
-- change which rows the view returns:
--   * labeled_total matches 'السعر\s*:?\s*(\d...)' — the row MUST contain the literal «السعر».
--   * published_ppm matches 'سعر\s*المتر...' — the row MUST contain the literal «المتر».
-- Neither is disturbed by the two rewrites applied inside the expressions: translate() maps only
-- Arabic-Indic DIGITS, and aqar_published_ppm's replace() rewrites «متوسط سعر» → «متوسط ***», a
-- substring that contains neither «السعر» nor «المتر» and whose replacement introduces no Arabic
-- letters. So no post-rewrite match can exist without the raw text carrying the literal.
-- Selectivity measured on live data: 4,074 of 60,828 rows (6.7%) survive the prefilter.
--
-- PROVEN EMPIRICALLY BEFORE THE WRITE, on the full live population: of the 56,754 rows the
-- prefilter excludes, ZERO satisfy the view's qualifying predicate (residential 0, commercial 0).
-- Both halves are re-asserted at the bottom of this migration, and a standing detector re-proves
-- it on a rotating slice of real rows forever after.

CREATE OR REPLACE VIEW public.mon_aqar_ppm_as_total AS
 WITH src AS (
         SELECT 'aqar_residential_listings'::text AS source_table,
            aqar_residential_listings.id,
            aqar_residential_listings.price_total,
            aqar_residential_listings.area_m2,
            aqar_residential_listings.source_capture ->> 'source_text'::text AS txt
           FROM aqar_residential_listings
          WHERE aqar_residential_listings.active AND aqar_residential_listings.transaction_type = 'Buy'::text AND aqar_residential_listings.price_total IS NOT NULL AND (aqar_residential_listings.source_capture ->> 'source_text'::text) IS NOT NULL
            AND (aqar_residential_listings.source_capture ->> 'source_text'::text) LIKE '%المتر%'
            AND (aqar_residential_listings.source_capture ->> 'source_text'::text) LIKE '%السعر%'
        UNION ALL
         SELECT 'aqar_commercial_listings'::text AS text,
            aqar_commercial_listings.id,
            aqar_commercial_listings.price_total,
            aqar_commercial_listings.area_m2,
            aqar_commercial_listings.source_capture ->> 'source_text'::text
           FROM aqar_commercial_listings
          WHERE aqar_commercial_listings.active AND aqar_commercial_listings.transaction_type = 'Buy'::text AND aqar_commercial_listings.price_total IS NOT NULL AND (aqar_commercial_listings.source_capture ->> 'source_text'::text) IS NOT NULL
            AND (aqar_commercial_listings.source_capture ->> 'source_text'::text) LIKE '%المتر%'
            AND (aqar_commercial_listings.source_capture ->> 'source_text'::text) LIKE '%السعر%'
        ), calc AS (
         SELECT src.source_table,
            src.id,
            src.price_total,
            src.area_m2,
            aqar_published_ppm(src.txt) AS published_ppm,
            round(safe_numeric(regexp_replace((regexp_match(translate(src.txt, '٠١٢٣٤٥٦٧٨٩'::text, '0123456789'::text), 'السعر\s*:?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:§|ريال|﷼)'::text))[1], ','::text, ''::text, 'g'::text)))::bigint AS labeled_total
           FROM src
        )
 SELECT source_table,
    id,
    price_total,
    published_ppm,
    labeled_total,
    area_m2
   FROM calc
  WHERE published_ppm IS NOT NULL AND price_total = published_ppm AND labeled_total IS NOT NULL AND labeled_total <> price_total;

-- The standing barrier. The prefilter above is an argument about two regexes; this EXECUTES the
-- un-prefiltered qualifying predicate against the real rows the prefilter threw away, so if anyone
-- ever edits aqar_published_ppm() or the labeled-total regex such that «المتر»/«السعر» stop being
-- required, the very next sweep says so instead of the view silently going half-blind.
--
-- It walks a rotating 1/12 slice per run (~4,700 rows) so it stays far under statement_timeout and
-- covers the whole excluded population twice a day. It also refuses to be vacuously green: a slice
-- that examines ZERO rows is itself reported, because "found nothing" and "looked at nothing" are
-- the same colour otherwise.
CREATE OR REPLACE FUNCTION public.mon_detect_aqar_ppm_prefilter_lossless()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n int := 0;
  v_slice int := (extract(hour from now())::int % 12);
  v_examined bigint;
  v_lost bigint;
begin
  with excluded_rows as (
    select id, price_total, source_capture->>'source_text' as txt
      from public.aqar_residential_listings
     where active and transaction_type = 'Buy' and price_total is not null
       and (source_capture->>'source_text') is not null
       and not ((source_capture->>'source_text') like '%المتر%'
            and (source_capture->>'source_text') like '%السعر%')
       and (id % 12) = v_slice
    union all
    select id, price_total, source_capture->>'source_text'
      from public.aqar_commercial_listings
     where active and transaction_type = 'Buy' and price_total is not null
       and (source_capture->>'source_text') is not null
       and not ((source_capture->>'source_text') like '%المتر%'
            and (source_capture->>'source_text') like '%السعر%')
       and (id % 12) = v_slice
  ), judged as (
    select aqar_published_ppm(txt) as published_ppm,
           price_total,
           round(safe_numeric(regexp_replace((regexp_match(translate(txt, '٠١٢٣٤٥٦٧٨٩', '0123456789'),
             'السعر\s*:?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:§|ريال|﷼)'))[1], ',', '', 'g')))::bigint as labeled_total
      from excluded_rows
  )
  select count(*),
         count(*) filter (where published_ppm is not null
                            and price_total = published_ppm
                            and labeled_total is not null
                            and labeled_total <> price_total)
    into v_examined, v_lost
    from judged;

  if v_lost > 0 then
    n := n + public.mon_raise('P1', 'aqar_ppm_prefilter_lossy', 'aqar', 'aqar_ppm_prefilter_lossy',
      jsonb_build_object('lost', v_lost, 'slice', v_slice, 'examined', v_examined,
        'why', 'mon_aqar_ppm_as_total''s «المتر»/«السعر» cost prefilter is no longer a necessary '
            || 'condition of its own regexes: ' || v_lost || ' row(s) it EXCLUDES would qualify as '
            || 'a per-meter rate served as a total price. The view is under-reporting a P1 price '
            || 'defect right now. Re-derive the prefilter from the current aqar_published_ppm() and '
            || 'labeled-total regexes, or drop it.'));
  else
    perform public.mon_resolve_key('aqar_ppm_prefilter_lossy', 'aqar_ppm_prefilter_lossy');
  end if;

  if v_examined = 0 then
    n := n + public.mon_raise('P2', 'aqar_ppm_prefilter_lossy', 'aqar', 'aqar_ppm_prefilter_vacuous',
      jsonb_build_object('slice', v_slice,
        'why', 'the losslessness check examined ZERO rows on this slice, so its green verdict means '
            || '"looked at nothing", not "found nothing". Either the aqar Buy population collapsed '
            || 'or the slice expression no longer selects anything.'));
  else
    perform public.mon_resolve_key('aqar_ppm_prefilter_lossy', 'aqar_ppm_prefilter_vacuous');
  end if;

  return n;
end $function$;

-- Roster. A detector nothing reaches is decoration (mon_detect_orphaned_detectors fires on it), so
-- it is registered in the SAME migration that creates it.
do $mig$
declare
  src text;
  new_src text;
begin
  select pg_get_functiondef('mon_run_all_detectors'::regproc) into src;
  new_src := replace(src,
    $q$'mon_detect_amlakalahsa_description_regressed'
  ];$q$,
    $q$'mon_detect_amlakalahsa_description_regressed',
    'mon_detect_aqar_ppm_prefilter_lossless'
  ];$q$);
  if new_src = src then
    raise exception 'mon_run_all_detectors roster tail changed shape — needle not found, aborting rather than guessing';
  end if;
  execute new_src;
end $mig$;

-- APPLY-TIME PROOF, residential half: the FULL excluded population, not a slice.
do $proof_res$
declare v_lost bigint;
begin
  select count(*) into v_lost
    from (select id, price_total, source_capture->>'source_text' txt
            from public.aqar_residential_listings
           where active and transaction_type = 'Buy' and price_total is not null
             and (source_capture->>'source_text') is not null
             and not ((source_capture->>'source_text') like '%المتر%'
                  and (source_capture->>'source_text') like '%السعر%')) s
   where aqar_published_ppm(txt) is not null
     and price_total = aqar_published_ppm(txt)
     and round(safe_numeric(regexp_replace((regexp_match(translate(txt, '٠١٢٣٤٥٦٧٨٩', '0123456789'),
           'السعر\s*:?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:§|ريال|﷼)'))[1], ',', '', 'g')))::bigint is not null
     and round(safe_numeric(regexp_replace((regexp_match(translate(txt, '٠١٢٣٤٥٦٧٨٩', '0123456789'),
           'السعر\s*:?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:§|ريال|﷼)'))[1], ',', '', 'g')))::bigint <> price_total;
  if v_lost <> 0 then
    raise exception 'prefilter is LOSSY on aqar_residential_listings: % excluded row(s) would qualify', v_lost;
  end if;
end $proof_res$;

-- APPLY-TIME PROOF, commercial half.
do $proof_com$
declare v_lost bigint;
begin
  select count(*) into v_lost
    from (select id, price_total, source_capture->>'source_text' txt
            from public.aqar_commercial_listings
           where active and transaction_type = 'Buy' and price_total is not null
             and (source_capture->>'source_text') is not null
             and not ((source_capture->>'source_text') like '%المتر%'
                  and (source_capture->>'source_text') like '%السعر%')) s
   where aqar_published_ppm(txt) is not null
     and price_total = aqar_published_ppm(txt)
     and round(safe_numeric(regexp_replace((regexp_match(translate(txt, '٠١٢٣٤٥٦٧٨٩', '0123456789'),
           'السعر\s*:?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:§|ريال|﷼)'))[1], ',', '', 'g')))::bigint is not null
     and round(safe_numeric(regexp_replace((regexp_match(translate(txt, '٠١٢٣٤٥٦٧٨٩', '0123456789'),
           'السعر\s*:?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:§|ريال|﷼)'))[1], ',', '', 'g')))::bigint <> price_total;
  if v_lost <> 0 then
    raise exception 'prefilter is LOSSY on aqar_commercial_listings: % excluded row(s) would qualify', v_lost;
  end if;
end $proof_com$;

-- The new detector must be green, and must NOT be green by looking at nothing.
do $verify$
declare raised int;
begin
  select public.mon_detect_aqar_ppm_prefilter_lossless() into raised;
  if raised <> 0 then
    raise exception 'mon_detect_aqar_ppm_prefilter_lossless raised % alert(s) immediately after its own proof', raised;
  end if;
end $verify$;
