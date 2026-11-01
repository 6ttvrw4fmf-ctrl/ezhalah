-- The weekly MoJ district-sales job (.github/workflows/moj-district-sales.yml, pg_cron gh-moj-district-sales,
-- Saturdays) raises an alert when a run goes RED, but a job that stops running raises nothing: the anon
-- policy just hides each row 120 days after its window last moved, so the card would fade out in silence.
-- This detector watches the absence instead: the newest fetched_at in moj_district_sales older than 9 days
-- (one weekly slot plus two days of slack), or an empty table, raises P2 moj_district_sales_stale.
create or replace function public.mon_detect_moj_district_sales_stale()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; live text[] := '{}'; v_last timestamptz;
begin
  select max(fetched_at) into v_last from public.moj_district_sales;
  if v_last is null or v_last < now() - interval '9 days' then
    live := live || 'moj_district_sales_stale:weekly'::text;
    n := n + public.mon_raise('P2', 'moj_district_sales_stale', null, 'moj_district_sales_stale:weekly',
      jsonb_build_object('last_fetched_at', v_last,
        'age_days', round((extract(epoch from now() - v_last) / 86400)::numeric, 1),
        'why', 'No weekly MoJ district-sales run has written moj_district_sales for more than 9 days; the ad page''s ministry half stops updating and fades out as rows pass 120 days.',
        'action', 'Check pg_cron job gh-moj-district-sales and the runs of .github/workflows/moj-district-sales.yml (dispatch it by hand: mode sync).'));
  end if;
  perform public.mon_resolve_stale_keys('moj_district_sales_stale', live);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_moj_district_sales_stale' in src) > 0 then
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_index_first_seen_unstamped'',',
    E'    ''mon_detect_index_first_seen_unstamped'',\n    ''mon_detect_moj_district_sales_stale'',');
  if out_def = src then
    raise exception 'roster anchor not found';
  end if;
  execute out_def;
end $$;

-- Proof, executed at apply time against the REAL function and the real table: every change below is made
-- inside a block that ends in a sentinel exception, so it all rolls back; only the booleans survive.
-- It must fire on a 10-day-old max, stay quiet on an 8-day-old max, and a mutant whose line moved to
-- 11 days must NOT fire on the same 10-day-old max (so the proof can tell a broken detector apart).
do $$
declare
  k constant text := 'moj_district_sales_stale:weekly';
  fired_10 boolean; quiet_8 boolean; mutant_fired_10 boolean; def text;
begin
  begin
    update public.moj_district_sales set fetched_at = now() - interval '10 days';
    perform public.mon_detect_moj_district_sales_stale();
    fired_10 := exists (select 1 from public.alert_event where dedup_key = k and resolved_at is null);
    raise exception 'moj_stale_proof_rollback';
  exception when raise_exception then
    if sqlerrm <> 'moj_stale_proof_rollback' then raise; end if;
  end;
  begin
    update public.moj_district_sales set fetched_at = now() - interval '8 days';
    perform public.mon_detect_moj_district_sales_stale();
    quiet_8 := not exists (select 1 from public.alert_event where dedup_key = k and resolved_at is null);
    raise exception 'moj_stale_proof_rollback';
  exception when raise_exception then
    if sqlerrm <> 'moj_stale_proof_rollback' then raise; end if;
  end;
  begin
    def := pg_get_functiondef('public.mon_detect_moj_district_sales_stale()'::regprocedure);
    if position('''9 days''' in def) = 0 then
      raise exception 'mutant anchor not found';
    end if;
    execute replace(def, '''9 days''', '''11 days''');
    update public.moj_district_sales set fetched_at = now() - interval '10 days';
    perform public.mon_detect_moj_district_sales_stale();
    mutant_fired_10 := exists (select 1 from public.alert_event where dedup_key = k and resolved_at is null);
    raise exception 'moj_stale_proof_rollback';
  exception when raise_exception then
    if sqlerrm <> 'moj_stale_proof_rollback' then raise; end if;
  end;
  if fired_10 is not true or quiet_8 is not true or mutant_fired_10 is not false then
    raise exception 'moj stale detector proof failed: fired at 10 d=%, quiet at 8 d=%, 11-day mutant fired at 10 d=%',
      fired_10, quiet_8, mutant_fired_10;
  end if;
end $$;
