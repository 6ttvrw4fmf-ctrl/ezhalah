-- 🔬 AF engineer 2026-10-08: barrier for the suwar prepared-shaft repair (20261008102944).
-- Fires when a suwar listing whose own feature list names only «مؤسس مصعد» (a prepared shaft) is stored or
-- served elevator = yes again — exactly what the pre-#6434 parser writes on its next crawl.
create or replace function public.mon_detect_suwar_prepared_shaft_as_lift()
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
  select count(*) into v_seen from public.suwar_residential_listings where active;
  select count(*) into v_bad
    from public.suwar_residential_listings x
   where x.active
     and x.elevator is true
     and coalesce((x.additional_info->'features_ar') ? 'مؤسس مصعد', false)
     and not coalesce((x.additional_info->'features_ar') ?| array['مصعد','مصعدين'], false);

  if v_seen = 0 then
    live := live || 'suwar_prepared_shaft_as_lift:BLIND'::text;
    n := n + public.mon_raise('P2', 'suwar_prepared_shaft_as_lift', 'suwar',
      'suwar_prepared_shaft_as_lift:BLIND',
      jsonb_build_object('blind', true,
        'why', 'No active suwar listing, so this detector cannot see whether a prepared lift shaft is served as a lift.',
        'action', 'Fix the suwar crawl first.'));
  elsif v_bad > 0 then
    live := live || 'suwar_prepared_shaft_as_lift:shaft_as_yes'::text;
    n := n + public.mon_raise('P1', 'suwar_prepared_shaft_as_lift', 'suwar',
      'suwar_prepared_shaft_as_lift:shaft_as_yes',
      jsonb_build_object('rows', v_bad,
        'why', 'A suwar listing whose feature list names only «مؤسس مصعد» (a prepared shaft) is stored elevator = yes, '
            || 'so the Advanced Filter «مصعد» shows a building with no lift.',
        'action', 'scrapers/suwar/run.py must map the shaft to AUTHORITATIVE_NULL (PR #6434, test_suwar_source_truth.py); '
            || 'then set these rows back to NULL as 20261008102944 did.'));
  end if;

  perform public.mon_resolve_stale_keys('suwar_prepared_shaft_as_lift', live);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_suwar_prepared_shaft_as_lift' in src) > 0 then
    raise notice 'mon_detect_suwar_prepared_shaft_as_lift already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_sanadak_unticked_box_as_no'',',
    E'    ''mon_detect_sanadak_unticked_box_as_no'',\n    ''mon_detect_suwar_prepared_shaft_as_lift'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

do $$
begin
  if public.mon_detect_suwar_prepared_shaft_as_lift() <> 0 then
    raise exception 'repair did not land: the detector still finds a suwar prepared shaft served as a lift';
  end if;
end $$;
