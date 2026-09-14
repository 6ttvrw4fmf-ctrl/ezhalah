-- Barrier for the fix applied in amlakalahsa_jafr_dahiya_collapse_moves_to_the_stored_row.
--
-- The detector that already exists (mon_detect_amlakalahsa_jafr_dahiya_merge_regressed) watches the
-- DATA and did its job — it is how the 2026-09-14 regression was found. What it cannot see is the
-- thing that now prevents the regression: it only ever fires AFTER a crawl has already reverted
-- rows. This one watches the MECHANISM, so a disarmed guard is caught before it costs a single row.
--
-- It EXECUTES the invariant rather than string-matching its definition. That distinction is the
-- whole point in this repo: every barrier over the five defects of 2026-09-04 was a source-TEXT
-- tripwire and every one of them stayed green for as long as its defect was live.
create or replace function public.mon_detect_amlakalahsa_district_match_disarmed()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0;
  v_fn_problems text[] := '{}';
  v_missing text[] := '{}';
  t text;
begin
  -- (A) the rule itself, EXECUTED against the four cases that define it. The الجفر case is the
  -- owner's merge; the other three are the boundaries it must never cross — above all the NULL
  -- city, which is the exact input that produced the regression when the same test lived in the
  -- scraper and read UNKNOWN as NO.
  if public.amlakalahsa_district_match('الجفر', 'الضاحية العاشر') is distinct from 'الضاحية' then
    v_fn_problems := array_append(v_fn_problems, 'الجفر/الضاحية العاشر did not collapse'::text);
  end if;
  if public.amlakalahsa_district_match('الهفوف', 'الضاحية العاشر') is distinct from 'الضاحية العاشر' then
    v_fn_problems := array_append(v_fn_problems, 'collapse crossed into الهفوف (owner did NOT ask to merge it)'::text);
  end if;
  if public.amlakalahsa_district_match(null, 'الضاحية العاشر') is distinct from 'الضاحية العاشر' then
    v_fn_problems := array_append(v_fn_problems, 'collapse fired on an UNKNOWN city'::text);
  end if;
  if public.amlakalahsa_district_match('الجفر', 'حي النخيل') is distinct from 'حي النخيل' then
    v_fn_problems := array_append(v_fn_problems, 'collapse touched an unrelated الجفر district'::text);
  end if;

  if array_length(v_fn_problems, 1) is not null then
    n := n + public.mon_raise('P2', 'amlakalahsa_district_match_disarmed', 'amlakalahsa',
      'amlakalahsa_district_match_disarmed:rule',
      jsonb_build_object('problems', to_jsonb(v_fn_problems),
        'why', 'public.amlakalahsa_district_match() no longer returns the owner''s 2026-09-13 '
            || 'الجفر/الضاحية rule. Every amlakalahsa write is normalised through it, so the next '
            || 'geocode-silent crawl will revert the merge again exactly as on 2026-09-14.'));
  else
    perform public.mon_resolve_key('amlakalahsa_district_match_disarmed', 'amlakalahsa_district_match_disarmed:rule');
  end if;

  -- (B) a correct rule nobody calls is decoration. The trigger is what puts it on the write path,
  -- and it is the write path — not the scraper — that holds the stored city on a crawl whose
  -- geocode was silent.
  foreach t in array array['amlakalahsa_residential_listings', 'amlakalahsa_commercial_listings'] loop
    if not exists (
      select 1 from pg_trigger tg
       where tg.tgrelid = ('public.' || t)::regclass
         and tg.tgname = 'zz_amlakalahsa_district_match'
         and not tg.tgisinternal
         and tg.tgenabled <> 'D'
         and tg.tgfoid = 'public.tg_amlakalahsa_district_match'::regproc
    ) then
      v_missing := array_append(v_missing, t);
    end if;
  end loop;

  if array_length(v_missing, 1) is not null then
    n := n + public.mon_raise('P2', 'amlakalahsa_district_match_disarmed', 'amlakalahsa',
      'amlakalahsa_district_match_disarmed:trigger',
      jsonb_build_object('tables', to_jsonb(v_missing),
        'why', 'trigger zz_amlakalahsa_district_match is missing, disabled, or repointed on: '
            || array_to_string(v_missing, ', ')
            || '. The الجفر/الضاحية collapse is then off the write path and the merge will revert '
            || 'on the next crawl that cannot geocode a city.'));
  else
    perform public.mon_resolve_key('amlakalahsa_district_match_disarmed', 'amlakalahsa_district_match_disarmed:trigger');
  end if;

  return n;
end $function$;

-- Roster entry in the SAME migration (AGENTS.md): a detector nothing reaches is decoration, and
-- mon_detect_orphaned_detectors() fires on exactly that. Needle-edited so a concurrent session's
-- own roster addition fails LOUDLY instead of being clobbered by a retyped body.
do $mig$
declare
  src text;
  new_src text;
begin
  select pg_get_functiondef('mon_run_all_detectors'::regproc) into src;
  new_src := replace(src,
    $q$'mon_detect_amlakalahsa_jafr_dahiya_merge_regressed',$q$,
    $q$'mon_detect_amlakalahsa_jafr_dahiya_merge_regressed',
    'mon_detect_amlakalahsa_district_match_disarmed',$q$);
  if new_src = src then
    raise exception 'mon_run_all_detectors roster needle not found — aborting rather than guessing';
  end if;
  execute new_src;
end $mig$;

-- Prove it green now, and prove it is CAPABLE OF RED: break the rule, watch the detector say so,
-- then put it back. A barrier that has never been watched to fail is an assumption.
do $verify$
declare
  raised int;
  good_def text;
begin
  select public.mon_detect_amlakalahsa_district_match_disarmed() into raised;
  if raised <> 0 then
    raise exception 'detector raised % alert(s) against a healthy guard', raised;
  end if;

  select pg_get_functiondef('public.amlakalahsa_district_match(text,text)'::regprocedure) into good_def;

  -- mutation 1: make the rule read UNKNOWN as the الجفر case — the over-merge direction
  execute $mut$create or replace function public.amlakalahsa_district_match(p_city_ar text, p_district_ar text)
           returns text language sql immutable set search_path to 'public'
           as $m$ select case when p_district_ar like 'الضاحية%' then 'الضاحية' else p_district_ar end $m$$mut$;

  select public.mon_detect_amlakalahsa_district_match_disarmed() into raised;
  if raised = 0 then
    execute good_def;
    raise exception 'MUTATION SURVIVED: detector stayed green while the rule over-merged الهفوف';
  end if;

  -- mutation 2: the regression's own shape — the collapse simply stops happening
  execute $mut$create or replace function public.amlakalahsa_district_match(p_city_ar text, p_district_ar text)
           returns text language sql immutable set search_path to 'public'
           as $m$ select p_district_ar $m$$mut$;
  perform public.mon_resolve_key('amlakalahsa_district_match_disarmed', 'amlakalahsa_district_match_disarmed:rule');

  select public.mon_detect_amlakalahsa_district_match_disarmed() into raised;
  if raised = 0 then
    execute good_def;
    raise exception 'MUTATION SURVIVED: detector stayed green while the collapse did nothing at all';
  end if;

  execute good_def;
  perform public.mon_resolve_key('amlakalahsa_district_match_disarmed', 'amlakalahsa_district_match_disarmed:rule');

  select public.mon_detect_amlakalahsa_district_match_disarmed() into raised;
  if raised <> 0 then
    raise exception 'detector did not return to green after the rule was restored';
  end if;
end $verify$;
