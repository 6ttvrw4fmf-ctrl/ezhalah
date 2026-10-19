-- sakan: a PREPARED elevator shaft («تأسيس مصعد») is not an elevator (New Listings Engineer, 2026-10-07).
--
-- scrapers/common/normalize.amenities_from_text() only looked AFTER the token for a «prepared»
-- qualifier, so the prefix form «تأسيس مصعد» read as elevator = yes. sakan prints exactly that in its
-- «مميزات العقار» prose; its structured feature chips carry no elevator for these rows. Re-read in CI
-- (source-reread run 37586895853): sakan 15854735's only elevator mention is «* تأسيس مصعد», and the
-- Advanced Filter «مصعد» returned it. Cause fixed in the same PR (normalize.py + test).
--
-- Why a data repair: db._unknown_must_not_overwrite_known() never lets a NULL overwrite a stored value
-- (owner rule 2026-08-09), so the corrected parser cannot clear the stale «yes» on a re-crawl.
--
-- Scope (measured 2026-10-07 07:45 UTC): active sakan_residential_listings with elevator = true, no
-- elevator chip («مصعد» / «اصنصير - مصاعد»), at least one prepared-prefix elevator mention and EVERY
-- «مصعد» in the description being such a mention, no English elevator/lift: 278 rows (1 first seen
-- today). sakan_commercial_listings: 0. The 3 rows that also name a plain elevator are left alone.
-- Undo: ops_daily_engineer_run phase 'new_listings_engineer:undo' (2026-10-07) lists every id.
-- Prepared is neither yes nor no, so the value becomes NULL, never false.

update public.sakan_residential_listings x
   set elevator = null
 where x.active
   and x.elevator is true
   and not coalesce((x.additional_info->'features') ? 'مصعد', false)
   and not coalesce((x.additional_info->'features') ? 'اصنصير - مصاعد', false)
   and regexp_count(coalesce(x.description,''), '(تأسيس|تاسيس|مؤسس|مؤسسة|مهيأ|مهيا)\s*ل?(ال)?مصعد') > 0
   and regexp_count(coalesce(x.description,''), '(تأسيس|تاسيس|مؤسس|مؤسسة|مهيأ|مهيا)\s*ل?(ال)?مصعد')
       = regexp_count(coalesce(x.description,''), 'مصعد')
   and regexp_count(lower(coalesce(x.description,'')), 'elevator|lift') = 0;

create or replace function public.mon_detect_sakan_prepared_elevator_as_yes()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n      int := 0;
  live   text[] := '{}';
  v_seen bigint;
  v_bad  bigint;
begin
  select count(*) into v_seen from public.sakan_residential_listings where active;
  select count(*) into v_bad
    from public.sakan_residential_listings x
   where x.active
     and x.elevator is true
     and not coalesce((x.additional_info->'features') ? 'مصعد', false)
     and not coalesce((x.additional_info->'features') ? 'اصنصير - مصاعد', false)
     and regexp_count(coalesce(x.description,''), '(تأسيس|تاسيس|مؤسس|مؤسسة|مهيأ|مهيا)\s*ل?(ال)?مصعد') > 0
     and regexp_count(coalesce(x.description,''), '(تأسيس|تاسيس|مؤسس|مؤسسة|مهيأ|مهيا)\s*ل?(ال)?مصعد')
         = regexp_count(coalesce(x.description,''), 'مصعد')
     and regexp_count(lower(coalesce(x.description,'')), 'elevator|lift') = 0;

  -- BLINDNESS GUARD: with no active sakan row a 0 proves nothing.
  if v_seen = 0 then
    live := live || 'sakan_prepared_elevator_as_yes:BLIND'::text;
    n := n + public.mon_raise('P2', 'sakan_prepared_elevator_as_yes', 'sakan',
      'sakan_prepared_elevator_as_yes:BLIND',
      jsonb_build_object('blind', true,
        'why', 'No active sakan listing, so this detector cannot see whether a prepared elevator shaft is served as an elevator.',
        'action', 'Fix the sakan crawl first.'));
  elsif v_bad > 0 then
    live := live || 'sakan_prepared_elevator_as_yes:prepared_as_yes'::text;
    n := n + public.mon_raise('P1', 'sakan_prepared_elevator_as_yes', 'sakan',
      'sakan_prepared_elevator_as_yes:prepared_as_yes',
      jsonb_build_object('rows', v_bad,
        'why', 'A sakan listing whose only elevator mention is «تأسيس مصعد» (a prepared shaft) and which has no elevator chip '
            || 'is stored elevator = yes, so the Advanced Filter «مصعد» shows a property with no elevator.',
        'action', 'normalize.amenities_from_text must leave a prepared PREFIX NULL (test_prepared_prefix_is_not_the_fixture_2026_10_07); '
            || 'then set these rows back to NULL as the 2026-10-07 sakan prepared-elevator repair did.'));
  end if;

  perform public.mon_resolve_stale_keys('sakan_prepared_elevator_as_yes', live);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_sakan_prepared_elevator_as_yes' in src) > 0 then
    raise notice 'mon_detect_sakan_prepared_elevator_as_yes already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_aldarim_saas_unfilled_block_false'',',
    E'    ''mon_detect_aldarim_saas_unfilled_block_false'',\n    ''mon_detect_sakan_prepared_elevator_as_yes'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

do $$
begin
  if public.mon_detect_sakan_prepared_elevator_as_yes() <> 0 then
    raise exception 'repair did not land: the detector still finds prepared elevators served as yes';
  end if;
end $$;
