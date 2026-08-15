-- RE-APPLY + PROTECT the 'كلاهما' (both periods) branch.
--
-- WHY THIS EXISTS. Migration 20260815012506 added the branch and was live-proven. Seven minutes later
-- 20260815013213 (guided_counts_add_direction_and_street_width, another session) re-created the same
-- readers from a body captured BEFORE mine and silently dropped it — the exact full-body-replace revert
-- hazard. Symptom: p_rent_period='كلاهما' returned 0 rows for أبها while monthly=1935 and annual=195.
-- A repo-side test cannot see this: the migration file was still in git and still correct. Only the LIVE
-- body was wrong. So this migration does two things — restore, and make the loss LOUD next time.
--
-- 1) Whitespace-tolerant re-apply. The rebuild also re-indented the clause (11→12 spaces), so a literal
--    needle would silently no-op. This matches on structure via regexp_replace and preserves the file's
--    own indentation through the \1 backreference. Guarded: exactly one match required, else RAISE.
-- 2) mon_detect_rent_period_both_branch() + its roster entry, in this SAME migration (an unrostered
--    detector is decoration — mon_detect_orphaned_detectors would fire on it). It asserts the branch in
--    every live body AND asserts the behaviour (union math), so a future rebuild raises P1 within the
--    hour instead of quietly serving 0 results to anyone who picked "both".
do $mig$
declare
  fn text; def text; newdef text; hits int;
  pat  constant text := '(\n)(\s*)or \(p_rent_period not in \(''شهري'',''سنوي''\) and s\.rent_period_ar = p_rent_period\)';
  repl constant text := E'\\1\\2or (p_rent_period = ''كلاهما'' and (s.payment_monthly = true or s.rent_period_ar = ''سنوي'' or (s.rent_period_ar = ''شهري'' and coalesce(s.rent_now_pay_later, false))))'
                     || E'\\1\\2or (p_rent_period not in (''شهري'',''سنوي'',''كلاهما'') and s.rent_period_ar = p_rent_period)';
begin
  foreach fn in array array['location_search_candidates_ar','apartment_guided_counts_ar','property_age_option_counts_ar'] loop
    def := pg_get_functiondef(('public.' || fn)::regproc);
    if def like '%كلاهما%' then
      raise notice 'SKIP % — already carries the كلاهما branch', fn;
      continue;
    end if;
    select count(*) into hits from regexp_matches(def, pat, 'g');
    if hits <> 1 then
      raise exception 'ABORT %: period-clause pattern matched % time(s), expected exactly 1', fn, hits;
    end if;
    newdef := regexp_replace(def, pat, repl);
    if newdef not like '%كلاهما%' then
      raise exception 'ABORT %: replacement produced no كلاهما branch', fn;
    end if;
    execute newdef;
    raise notice 'RE-PATCHED %', fn;
  end loop;
end $mig$;

-- ── detector: the branch must exist in every reader, and must behave as a true union ───────────────
create or replace function public.mon_detect_rent_period_both_branch()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  fn text; missing text[] := '{}'; n int := 0;
  m bigint; a bigint; b bigint;
begin
  foreach fn in array array['location_search_candidates_ar','apartment_guided_counts_ar','property_age_option_counts_ar'] loop
    if pg_get_functiondef(('public.' || fn)::regproc) not like '%كلاهما%' then
      missing := missing || fn;
    end if;
  end loop;

  if array_length(missing, 1) > 0 then
    n := n + public.mon_raise('P1', 'rent_period_both_branch_missing', 'search',
      'rent_period_both_branch_missing',
      jsonb_build_object(
        'missing_from', to_jsonb(missing),
        'impact', 'A user who picks BOTH monthly+annual gets ZERO results (the token matches no branch).',
        'cause', 'Almost certainly a full-body CREATE OR REPLACE built from a stale copy of the function.',
        'fix', 'Re-run migration rent_period_both_reapply_and_detector — it is idempotent and whitespace-tolerant.'));
  end if;

  -- Behavioural half: the union must equal monthly + annual over the live index. Cheap (indexed counts),
  -- and it catches a branch that EXISTS but was rewritten into something that no longer unions.
  select count(*) filter (where payment_monthly = true),
         count(*) filter (where rent_period_ar = 'سنوي' or (rent_period_ar = 'شهري' and coalesce(rent_now_pay_later, false))),
         count(*) filter (where payment_monthly = true or rent_period_ar = 'سنوي' or (rent_period_ar = 'شهري' and coalesce(rent_now_pay_later, false)))
    into m, a, b
    from public.search_listings_ar where deal_ar = 'إيجار';

  if m + a <> b then
    n := n + public.mon_raise('P2', 'rent_period_both_union_drift', 'search',
      'rent_period_both_union_drift',
      jsonb_build_object('monthly', m, 'annual', a, 'both_union', b,
        'note', 'monthly + annual no longer equals the both-union — the two period predicates now overlap.'));
  else
    update public.alert_event set resolved_at = now()
     where kind = 'rent_period_both_union_drift' and resolved_at is null;
  end if;

  if array_length(missing, 1) is null then
    update public.alert_event set resolved_at = now()
     where kind = 'rent_period_both_branch_missing' and resolved_at is null;
  end if;

  return n;
end $fn$;

-- roster it in the SAME migration (an unrostered detector never runs)
do $roster$
declare src text;
begin
  select prosrc into src from pg_proc where proname = 'mon_run_all_detectors' and pronamespace = 'public'::regnamespace;
  if src like '%mon_detect_rent_period_both_branch%' then
    raise notice 'roster already contains mon_detect_rent_period_both_branch';
  else
    execute replace(
      pg_get_functiondef('public.mon_run_all_detectors'::regproc),
      '''mon_detect_rent_period_unreachable''',
      '''mon_detect_rent_period_both_branch'',''mon_detect_rent_period_unreachable''');
    raise notice 'rostered mon_detect_rent_period_both_branch';
  end if;
end $roster$;

notify pgrst, 'reload schema';