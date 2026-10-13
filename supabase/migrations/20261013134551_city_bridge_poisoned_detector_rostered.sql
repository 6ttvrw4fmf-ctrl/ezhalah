-- 🔧 Quality & Repair 2026-10-13: the barrier for 20261013133128 — a minority mapping must never re-enter city_name_bridge.
--
-- The search RPCs accept an English city token only when city_name_bridge maps it to exactly ONE Arabic city, so a
-- single mis-resolved listing («Khobar» → جدة, n = 1 beside الخبر 16,340) made 37 English city names answer 0 to every
-- customer. refresh_city_name_bridge() now drops a mapping below 5% of its English name. Nothing watched that rule:
-- a revert, a second writer, or a by-hand insert would re-poison the bridge and every count-based check would stay
-- green (the RPCs do not error, they return nothing). This detector asks the TABLE, twice an hour, and raises P2 on the
-- first minority row; it clears when the table is clean. Rostered in mon_run_all_detectors in the same change (an
-- unrostered detector is decoration — mon_detect_orphaned_detectors would say so), by editing the live roster text
-- server-side rather than retyping the function.

create or replace function public.mon_city_bridge_poisoned_rows()
 returns table(city_en text, city_ar text, n integer, share_pct numeric)
 language sql
 stable
as $function$
  with t as (select city_en, sum(n) as tot, max(n) as mx from public.city_name_bridge group by city_en)
  select b.city_en, b.city_ar, b.n, round(100.0 * b.n / t.tot, 2)
  from public.city_name_bridge b join t using (city_en)
  where b.n <> t.mx and 100.0 * b.n / t.tot < 5
  order by b.n desc;
$function$;

create or replace function public.mon_detect_city_bridge_poisoned()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_n int := 0; sample jsonb;
begin
  select count(*), jsonb_agg(jsonb_build_object('city_en', s.city_en, 'city_ar', s.city_ar, 'n', s.n, 'share_pct', s.share_pct))
    into v_n, sample
    from (select * from public.mon_city_bridge_poisoned_rows() limit 10) s;
  if v_n > 0 then
    perform public.mon_raise('P2', 'city_bridge_poisoned', 'search', 'city_bridge_poisoned',
      jsonb_build_object('count', v_n, 'sample', sample,
        'why', 'city_name_bridge holds a mapping below 5% of its English name. The search RPCs accept an English city '
            || 'token only when it maps to ONE Arabic city, so one such row makes that English name answer 0 to every '
            || 'customer (2026-10-13: «Khobar» → جدة n=1 silenced Khobar, Riyadh, Dammam, Mecca, Medina … 37 names).',
        'fix', 'select public.refresh_city_name_bridge(); — the builder drops minority mappings (20261013133128). If the '
            || 'row comes back, find the writer that bypassed the builder; the mis-resolved LISTING behind it is a '
            || 'wrong-city row for the location pipeline, never a reason to keep the mapping.'));
  else
    perform public.mon_resolve_key('city_bridge_poisoned', 'city_bridge_poisoned');
  end if;
  return v_n;
end
$function$;

-- Roster: insert the new name right before an existing anchor in the live mon_run_all_detectors text, then execute it.
do $roster$
declare d text; anchor text := '''mon_detect_aqar_proven_wrong_resolution'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''mon_detect_city_bridge_poisoned''' in d) > 0 then
    raise notice 'already rostered';
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    d := replace(d, anchor, '''mon_detect_city_bridge_poisoned'', ' || anchor);
    execute d;
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_city_bridge_poisoned''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end
$roster$;

-- PROOF at apply, both directions. The planted minority row lives in a sub-transaction that is always rolled back.
do $proof$
declare r int;
begin
  r := public.mon_detect_city_bridge_poisoned();
  if r <> 0 then raise exception 'PROOF: the bridge is not clean after 20261013133128 (% minority rows)', r; end if;
  begin
    insert into public.city_name_bridge (city_en, city_ar, n) values ('Khobar', '__planted__', 1);
    r := (select count(*) from public.mon_city_bridge_poisoned_rows() where city_ar = '__planted__');
    if r <> 1 then raise exception 'PROOF: the planted minority row was not detected (%)', r; end if;
    raise exception 'ROLLBACK_PLANT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_PLANT' then raise; end if;
  end;
  r := (select count(*) from public.city_name_bridge where city_ar = '__planted__');
  if r <> 0 then raise exception 'PROOF: planted row survived the rollback'; end if;
  r := (select count(*) from unnest(public.mon_orphaned_detectors()) o where o = 'mon_detect_city_bridge_poisoned');
  if r <> 0 then raise exception 'PROOF: the new detector reads as orphaned'; end if;
  raise notice 'PROOF OK: clean bridge → 0; planted minority row → caught; rostered, not orphaned';
end
$proof$;