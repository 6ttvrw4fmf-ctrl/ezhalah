-- Companion detector for 20261025105747 (the amenity reader's leftovers): a furnished = yes stored on tuba, dealapp,
-- ibaax, sirdab or dwelleo while the ad's own label answers «لا» (ibaax's structured «Furnished» chip excepted). It
-- shipped separately because a function change reloads PostgREST's schema cache and the API was busy when the
-- data-only repair landed. The repair already ran, so the raise path is proven by planting one repaired tuba row back
-- to yes inside a sub-block that rolls itself back.

create or replace function public.mon_detect_labelled_no_served_as_furnished()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n        int := 0;
  live     text[] := '{}';
  v_seen   bigint;
  v_bad    bigint;
  v_sample jsonb;
  -- the muhaysini detector's predicate, on the other sites that print the same generated template
  re_label constant text := '(مفروش|مؤثث)[ء-ي]{0,4}[ \t*]*[:：][ \t*]*';
  re_no    constant text := '(مفروش|مؤثث)[ء-ي]{0,4}[ \t*]*[:：][ \t*]*(لا(?![ \t]*[يت]وجد[ \t]+(تفاصيل|معلومات|بيانات))|لايوجد|لاتوجد|بدون)([^ء-ي]|$)';
begin
  with t as (
    select 'tuba_residential_listings' tbl, id, furnished, coalesce(description, '') d, false chip
      from public.tuba_residential_listings where active
    union all
    select 'tuba_commercial_listings' tbl, id, furnished, coalesce(description, '') d, false chip
      from public.tuba_commercial_listings where active
    union all
    select 'dealapp_residential_listings' tbl, id, furnished, coalesce(description, '') d, false chip
      from public.dealapp_residential_listings where active
    union all
    select 'ibaax_residential_listings' tbl, id, furnished, coalesce(description, '') d, coalesce(additional_info->'amenity_words', '[]'::jsonb) ? 'Furnished' chip
      from public.ibaax_residential_listings where active
    union all
    select 'sirdab_commercial_listings' tbl, id, furnished, coalesce(description, '') d, false chip
      from public.sirdab_commercial_listings where active
    union all
    select 'dwelleo_residential_listings' tbl, id, furnished, coalesce(description, '') d, false chip
      from public.dwelleo_residential_listings where active
    union all
    select 'dwelleo_commercial_listings' tbl, id, furnished, coalesce(description, '') d, false chip
      from public.dwelleo_commercial_listings where active)
  select count(*) filter (where d ~ re_label),
         count(*) filter (where furnished and d ~ re_no and not chip),
         jsonb_agg(jsonb_build_object('t', tbl, 'id', id)) filter (where furnished and d ~ re_no and not chip)
    into v_seen, v_bad, v_sample
    from t;

  if v_seen = 0 then
    live := live || 'labelled_no_served_as_furnished:BLIND'::text;
    n := n + public.mon_raise('P2', 'labelled_no_served_as_furnished', null,
      'labelled_no_served_as_furnished:BLIND',
      jsonb_build_object('blind', true,
        'why', 'No active ad on tuba / dealapp / ibaax / sirdab / dwelleo carries a «مفروشة: …» label, so a labelled no served as yes cannot be seen.',
        'action', 'Check those sites still store their description.'));
  elsif v_bad > 0 then
    live := live || 'labelled_no_served_as_furnished:yes_served'::text;
    n := n + public.mon_raise('P1', 'labelled_no_served_as_furnished', null,
      'labelled_no_served_as_furnished:yes_served',
      jsonb_build_object('rows', v_bad, 'labelled', v_seen,
        'sample', (select jsonb_agg(x) from (select x from jsonb_array_elements(v_sample) x limit 10) z),
        'why', 'The ad''s own label says «مفروشة: لا» yet furnished = yes is stored (no structured «Furnished» chip), so a customer asking for furnished gets it.',
        'action', 'scrapers/common/normalize.py label reader (_LABEL_RE / _LABEL_NO_RE); dwelleo _amenities status-vs-text; sirdab amenities_from_lines. Replay old vs new and repair.'));
  end if;

  perform public.mon_resolve_stale_keys('labelled_no_served_as_furnished', live);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_labelled_no_served_as_furnished' in src) > 0 then
    raise notice 'mon_detect_labelled_no_served_as_furnished already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_muhaysini_labelled_no_read_as_furnished'',',
    E'    ''mon_detect_muhaysini_labelled_no_read_as_furnished'',\n    ''mon_detect_labelled_no_served_as_furnished'',');
  if out_def = src then
    raise exception 'roster anchor not found, refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- Raise path, proven on a real repaired row (tuba 13260202: «**مفروشة:** لا (غير مفروشة)»), rolled back.
do $p$
declare k int;
begin
  begin
    update public.tuba_residential_listings set furnished = true where id = 13260202 and active;
    perform public.mon_detect_labelled_no_served_as_furnished();
    select count(*) into k from public.alert_event
     where kind = 'labelled_no_served_as_furnished' and resolved_at is null
       and dedup_key = 'labelled_no_served_as_furnished:yes_served';
    raise exception 'probe_done:%', k;
  exception when others then
    if sqlerrm <> 'probe_done:1' then
      raise exception 'detector did not raise on a planted labelled-no yes (%)', sqlerrm;
    end if;
  end;
end $p$;

-- And it is clean on the repaired data.
do $c$
declare k int;
begin
  perform public.mon_detect_labelled_no_served_as_furnished();
  select count(*) into k from public.alert_event
   where kind = 'labelled_no_served_as_furnished' and resolved_at is null;
  if k <> 0 then raise exception 'detector reports % open alert(s) on the repaired data', k; end if;
end $c$;

-- Enroll repair 20261025105747 (the amenity reader's leftovers: «لا تأتي … مفروشة», «عدم وجود مصعد», multi-word labels,
-- «مفروشة: لا» on tuba / dealapp / ibaax / sirdab, dwelleo status vs text) in the repair-guarantee registry.
insert into public.ops_repair_guarantee_registry
  (repair_version, repair_name, invariant, detector, registered_by, last_verified_at, last_verdict, last_detail)
values
  ('20261025105747',
   'amenity_reader_leftovers_not_a_yes',
   'No active tuba, dealapp, ibaax, sirdab or dwelleo ad stores furnished = true while its own description answers '
   || 'a furnished label with a negator («مفروشة: لا», «مؤثثة: لا يوجد», «بدون»), unless the platform''s own '
   || 'structured «Furnished» chip says so (ibaax). The shared reader reads a label''s value, «لا تأتي … مفروشة» and '
   || '«عدم وجود …» since PR 8656; dwelleo stores unknown when its furnishing status and its text disagree.',
   'mon_detect_labelled_no_served_as_furnished',
   'amenity reader leftovers repair 2026-10-25 (author of the repair)',
   now(), 'holds',
   jsonb_build_object(
     'checked', 'production, at enrollment',
     'rows_changed', 253,
     'detector_rows_before', 45,
     'detector_rows_after', 0,
     'detector_on_roster', true,
     'detector_raise_path_executed', true,
     'forward_fix', 'PR 8656: scrapers/common/normalize.py (_LABEL_RE, _ABSENT_BEFORE_RE, settled labels), '
                 || 'scrapers/sirdab/run.py (amenities_from_lines), scrapers/dwelleo/run.py (status vs text), '
                 || 'pinned by scripts/verify-labelled-no-is-not-a-yes.ts (8 mutants caught)'))
on conflict do nothing;
