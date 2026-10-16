-- dealapp furnished: three prose phrasings read as YES are not a yes (🔬 AF engineer, 2026-10-16, backlog 593).
-- The shared reader normalize.amenities_from_lines read «… الغير مفروش» (a stated no, «غير» with the
-- article), «مفروشه جزئيا» / «نصف مفروشة» (partly furnished, which a yes/no answer cannot state) and
-- «سطح مفروش نجيلة» (a turf floor covering, not furniture) as furnished = YES. The reader is fixed in the
-- same PR (scrapers/common/tests/test_furnished_partial_covering_and_article_negator.py fails 7 of 12 on the
-- old reader). Replaying old vs new over the 1,831 active dealapp ads whose text names furnishing changed
-- exactly 33 answers, all YES -> unknown, none the other way; all 33 store true today. dealapp's af_answers()
-- omits an unstated column, so a re-crawl would NEVER clear these: the stored half is repaired here.
-- Only rows still true are touched, and only to NULL (unknown), never to false.
update public.dealapp_residential_listings
   set furnished = null
 where furnished is true
   and id = any('{1139312,1139348,1291905,1571258,1738221,6197390,6408532,7059899,8218668,10027291,13707006,14983235,14983540,15807869,16153561,16155416,16157287,16177985,16231917,16233849,16235252,16677008,16678762,17021434,17350541,17489079,17490871,17548620,17549151,17640973,17926463,17927251,17929041}'::bigint[]);

-- Barrier: a dealapp ad stored furnished = YES whose ONLY furnishing word is partial or a floor covering.
-- A sound subset of the reader (one mention, and that mention cannot be a yes); before this repair it
-- counted 7 rows, all inside the 33 above.
create or replace function public.mon_detect_dealapp_partial_furnished_as_yes()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n       int := 0;
  live    text[] := '{}';
  v_seen  bigint;
  v_bad   bigint;
begin
  select count(*) into v_seen from public.dealapp_residential_listings where active and furnished is not null;
  select count(*) into v_bad from public.dealapp_residential_listings
   where active and furnished is true
     and (length(description) - length(regexp_replace(description, '(مفروش|مؤثث)', '', 'g'))) = 5
     and (description ~ '(مفروش|مؤثث)[ةه]?\s*(جزئي|جزئيا|جزئيه|جزئية)' or description ~ 'نصف\s*(مفروش|مؤثث)'
          or description ~ 'مفروش[ةه]?\s*(ب)?(ال)?(نجيل|عشب|بلاط|رخام|سيراميك|موكيت|باركيه|بورسلان|انترلوك)');

  -- BLINDNESS GUARD: with no stored dealapp furnished answer a 0 proves nothing.
  if v_seen = 0 then
    live := live || 'dealapp_partial_furnished_as_yes:BLIND'::text;
    n := n + public.mon_raise('P2', 'dealapp_partial_furnished_as_yes', 'dealapp',
      'dealapp_partial_furnished_as_yes:BLIND',
      jsonb_build_object('blind', true,
        'why', 'No active dealapp listing stores a furnished answer, so this detector cannot see a partial one served as yes.',
        'action', 'Check scrapers/dealapp/run.py af_answers still writes furnished.'));
  elsif v_bad > 0 then
    live := live || 'dealapp_partial_furnished_as_yes:yes_served'::text;
    n := n + public.mon_raise('P1', 'dealapp_partial_furnished_as_yes', 'dealapp',
      'dealapp_partial_furnished_as_yes:yes_served',
      jsonb_build_object('rows', v_bad,
        'why', 'The ad only says partly furnished or names a floor covering, yet furnished = yes is stored, so a customer asking for furnished gets it.',
        'action', 'normalize.amenities_from_lines must suppress partial and floor covering mentions of furnished; re-run the 2026-10-16 replay and repair to NULL.'));
  end if;

  perform public.mon_resolve_stale_keys('dealapp_partial_furnished_as_yes', live);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_dealapp_partial_furnished_as_yes' in src) > 0 then
    raise notice 'mon_detect_dealapp_partial_furnished_as_yes already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_sanadak_unticked_box_as_no'',',
    E'    ''mon_detect_sanadak_unticked_box_as_no'',\n    ''mon_detect_dealapp_partial_furnished_as_yes'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

do $$
begin
  if public.mon_detect_dealapp_partial_furnished_as_yes() <> 0 then
    raise exception 'repair did not land: a dealapp partial furnishing is still stored as yes';
  end if;
end $$;