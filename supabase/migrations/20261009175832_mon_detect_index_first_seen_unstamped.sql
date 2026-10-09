-- 🔧 QA 2026-10-09: index_first_seen_unstamped — barrier for 20261009171105.
-- A served listing whose source row was inserted more than 40 minutes ago must carry its Ezhalah first_seen_at (sync_search_first_seen_at runs
-- every 10 minutes). Before that fix 135,079 served rows had none, and every «new in 24 h» number
-- — the New Listings engineer's scope, the owner's feeds gate, four detectors — read a race.
create or replace function public.mon_detect_index_first_seen_unstamped()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; live text[] := '{}'; v_bad bigint := 0; v_one bigint; t record; v_ex jsonb := '[]'::jsonb;
begin
  for t in
    select c.table_name tn
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name ~ '_(residential|commercial)_listings$'
      and c.column_name = 'scraped_at'
  loop
    execute format($q$
      select count(*) from public.search_listings_ar s
      join public.%1$I r on r.id = s.listing_id
      where s.source_table = %1$L and s.first_seen_at is null
        and r.scraped_at < now() - interval '40 minutes'
    $q$, t.tn) into v_one;
    if v_one > 0 then
      v_bad := v_bad + v_one;
      if v_one >= 50 then v_ex := v_ex || jsonb_build_object('table', t.tn, 'rows', v_one); end if;
    end if;
  end loop;

  if v_bad > 500 then
    live := live || 'index_first_seen_unstamped:fleet'::text;
    n := n + public.mon_raise('P2', 'index_first_seen_unstamped', 'fleet', 'index_first_seen_unstamped:fleet',
      jsonb_build_object('rows', v_bad, 'by_table', v_ex,
        'why', 'Served listings inserted at source more than 40 min ago have no first_seen_at, so every «new in 24 h» count (New Listings scope, feeds gate, arrival detectors) undercounts.',
        'action', 'Check cron job 75 (sync_search_first_seen_at) ran and that it stamps every row, not only rows without last_updated (20261009171105).'));
  end if;
  perform public.mon_resolve_stale_keys('index_first_seen_unstamped', live);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_index_first_seen_unstamped' in src) > 0 then
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_english_city_arrival_lag'',',
    E'    ''mon_detect_english_city_arrival_lag'',\n    ''mon_detect_index_first_seen_unstamped'',');
  if out_def = src then
    raise exception 'roster anchor not found';
  end if;
  execute out_def;
end $$;