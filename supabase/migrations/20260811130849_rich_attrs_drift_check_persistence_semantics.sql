-- Check C fired on NORMAL freshness lag: listing_rich_attrs is a LIVE view over the raw tables,
-- while search_listings_ar converges hourly at :14 — so any scraper sweep between syncs (here the
-- 13:05 aqar sweep, 6,699 rows) makes the two disagree until the next sync. That is the pipeline
-- WORKING, not failing, and a barrier that alarms on it trains people to ignore alarms.
--
-- New semantics: drift is a violation only when it PERSISTS across two consecutive barrier runs
-- (the barrier is daily; a working hourly sync clears any lag long before the next reading, so two
-- consecutive positives mean the sync is not converging) — or when it exceeds 50,000 rows at once
-- (the sync is plainly dead; do not wait a day to say so).
create table if not exists public.mon_rich_attrs_drift_state (
  id int primary key default 1 check (id = 1),
  drift_n bigint not null,
  seen_at timestamptz not null default now()
);

do $$
declare def text;
begin
  select pg_get_functiondef(p.oid) into strict def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_rich_attrs_barrier' and p.prokind = 'f';

  if position('rich_attrs_index_drift' in def) = 0 then
    raise exception 'check C anchor not found';
  end if;

  def := replace(def,
$old$  if v > 0 then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('rich_attrs_index_drift', v,
            format('%s listings whose rich columns disagree with listing_rich_attrs.', v));
  end if;$old$,
$new$  -- drift is a violation only if it PERSISTED since the previous run (sync not converging) or is
  -- catastrophic; plain between-sync freshness lag is the pipeline working.
  if v > 50000 or (v > 0 and (select ds.drift_n from public.mon_rich_attrs_drift_state ds where ds.id = 1) > 0) then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('rich_attrs_index_drift', v,
            format('%s listings whose rich columns disagree with listing_rich_attrs AND the previous '
                || 'barrier run also saw drift — sync_all_rich_attrs is not converging.', v));
  end if;
  insert into public.mon_rich_attrs_drift_state(id, drift_n, seen_at) values (1, v, now())
  on conflict (id) do update set drift_n = excluded.drift_n, seen_at = now();$new$);

  if position('mon_rich_attrs_drift_state' in def) = 0 then
    raise exception 'rewrite did not take';
  end if;
  execute def;
end $$;

-- converge now, then the state row starts from a clean reading
select * from public.sync_all_rich_attrs();
do $$
declare v int;
begin
  v := public.mon_rich_attrs_barrier();
  if v <> 0 then raise exception 'rich barrier still reports % after convergence', v; end if;
end $$;

-- the one transient alert raised under the old flapping semantics
delete from public.location_pipeline_alerts where alert_type = 'rich_attrs_index_drift';
