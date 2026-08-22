-- THE BARRIER the owner asked for: "a fetch/parser failure can NEVER blank valid known prices."
--
-- Prevention lives in the code (db.AUTHORITATIVE_NULL — a sentinel no accidental path produces,
-- mutation-proven by scripts/verify-authoritative-null-price.ts). This is the DETECTION net behind
-- it, because prevention that nothing watches is an assumption. It catches the event itself: a
-- price that went non-NULL -> NULL without anything on record saying the SOURCE retracted it.
--
-- It is a TRANSITION detector, not a state detector, and that distinction is the whole design. A
-- state detector ("row has no price and no authority record") would fire on ~5,800 aqar rows that
-- simply never had a price — noise on day one, ignored by week one. A transition detector fires
-- only on the thing that must never happen, so a single alert means a real regression.
--
-- Authority is either:
--   * a row in ops_authoritative_null_price (evidence-backed repairs), or
--   * the row's OWN latest capture saying source_capture->price_evidence->>authoritative_absent,
--     which only the AUTHORITATIVE_NULL path can write.
--
-- Scoped to the aqar tables, where the mechanism landed. Widening it is a one-line change once
-- other platforms adopt the sentinel.
--
-- The temp tables are dropped EXPLICITLY at entry, not with ON COMMIT DROP: a migration (or any
-- caller) that invokes this twice inside one transaction would otherwise hit "relation already
-- exists" — which is exactly how the first attempt at this migration failed.

create table if not exists public.ops_price_watch (
  source_table text        not null,
  listing_id   bigint      not null,
  price_total  bigint,
  price_annual bigint,
  seen_at      timestamptz not null default now(),
  primary key (source_table, listing_id)
);

comment on table public.ops_price_watch is
  'Last-known non-null prices, refreshed by mon_detect_price_blanked_without_authority() so it can '
  'see a price go NULL. Not a backup: ops_authoritative_null_price and the *_repair_backup_* tables '
  'hold repair provenance.';

create or replace function public.mon_detect_price_blanked_without_authority()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_n int := 0;
  v_cnt int;
  v_sample jsonb;
begin
  drop table if exists _live_prices;
  drop table if exists _unauthorised;

  create temp table _live_prices as
    select 'aqar_residential_listings'::text as source_table, id as listing_id,
           price_total, price_annual
      from public.aqar_residential_listings where active
    union all
    select 'aqar_commercial_listings', id, price_total, price_annual
      from public.aqar_commercial_listings where active;

  create index on _live_prices (source_table, listing_id);

  -- A price that DISAPPEARED since the last sweep, with nothing on record authorising it.
  create temp table _unauthorised as
    select w.source_table, w.listing_id,
           w.price_total  as price_total_before,
           w.price_annual as price_annual_before
      from public.ops_price_watch w
      join _live_prices l
        on l.source_table = w.source_table and l.listing_id = w.listing_id
     where ((w.price_total  is not null and l.price_total  is null)
         or (w.price_annual is not null and l.price_annual is null))
       and not exists (
             select 1 from public.ops_authoritative_null_price a
              where a.source_table = w.source_table and a.listing_id = w.listing_id)
       and not exists (
             select 1 from public.aqar_residential_listings r
              where w.source_table = 'aqar_residential_listings' and r.id = w.listing_id
                and (r.source_capture->'price_evidence'->>'authoritative_absent') = 'true')
       and not exists (
             select 1 from public.aqar_commercial_listings c
              where w.source_table = 'aqar_commercial_listings' and c.id = w.listing_id
                and (c.source_capture->'price_evidence'->>'authoritative_absent') = 'true');

  select count(*), coalesce(jsonb_agg(x order by x->>'listing_id'), '[]'::jsonb)
    into v_cnt, v_sample
    from (select jsonb_build_object('source_table', source_table, 'listing_id', listing_id,
                                    'price_total_before', price_total_before,
                                    'price_annual_before', price_annual_before) as x
            from _unauthorised limit 20) s;

  if v_cnt > 0 then
    v_n := v_n + public.mon_raise('P1', 'price_blanked_without_authority', 'aqar',
      'price_blanked_without_authority',
      jsonb_build_object(
        'rows', v_cnt,
        'sample', v_sample,
        'why', 'A listing price went from a real value to NULL with nothing recording that the '
            || 'SOURCE retracted it. Only db.AUTHORITATIVE_NULL may write that NULL, and it stamps '
            || 'price_evidence.authoritative_absent when it does; an evidence-backed repair writes '
            || 'ops_authoritative_null_price. Neither is present, so a read failure, a parser '
            || 'regression or a direct SQL write has erased a price we had verified.',
        'action', 'Restore from ops_price_watch.price_*_before or the repair backup, then find the '
            || 'writer. Do NOT resolve this by adding a ledger row after the fact — that launders '
            || 'the very event this exists to catch.'));
  else
    perform public.mon_resolve_key('price_blanked_without_authority',
                                   'price_blanked_without_authority');
  end if;

  -- Refresh the watch AFTER the comparison. Only rows that currently carry a price are worth
  -- watching; a row with no price has nothing left to lose.
  delete from public.ops_price_watch w
   using _live_prices l
   where l.source_table = w.source_table and l.listing_id = w.listing_id
     and l.price_total is null and l.price_annual is null;

  insert into public.ops_price_watch (source_table, listing_id, price_total, price_annual, seen_at)
  select source_table, listing_id, price_total, price_annual, now()
    from _live_prices
   where price_total is not null or price_annual is not null
  on conflict (source_table, listing_id) do update
    set price_total = excluded.price_total,
        price_annual = excluded.price_annual,
        seen_at = excluded.seen_at;

  drop table if exists _live_prices;
  drop table if exists _unauthorised;
  return v_n;
end
$function$;

-- Roster wiring by the guarded needle-edit — read the LIVE body, splice one name in, so it cannot
-- drop entries it never read.
do $$
declare
  v_def text; v_before text;
  fn constant text := 'mon_detect_price_blanked_without_authority';
  anchor constant text := '    ''mon_detect_cron_ordering_contract''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  v_before := v_def;
  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing — refusing to guess at the array shape';
  end if;
  if position('''' || fn || '''' in v_def) = 0 then
    v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n' || anchor);
  end if;
  if v_def = v_before then
    raise notice 'detector already rostered';
    return;
  end if;
  execute v_def;
end $$;

-- MUTATION PROOF against live data, both directions. A barrier that has only ever said "fine" has
-- not been shown to work.
do $$
declare
  v_raised int;
  v_before_price bigint;
  v_probe_id bigint;
begin
  perform public.mon_detect_price_blanked_without_authority();          -- prime the watch
  if (select count(*) from public.ops_price_watch) = 0 then
    raise exception 'watch table did not populate — the detector cannot see anything';
  end if;

  -- (a) steady state: nothing changed, so nothing may be raised.
  v_raised := public.mon_detect_price_blanked_without_authority();
  if v_raised <> 0 then
    raise exception 'detector raised % on an unchanged fleet — it is crying wolf', v_raised;
  end if;

  -- (b) POSITIVE CONTROL: blank a real price with no authority anywhere, and require a raise.
  select w.listing_id, w.price_total into v_probe_id, v_before_price
    from public.ops_price_watch w
    join public.aqar_residential_listings r on r.id = w.listing_id
   where w.source_table = 'aqar_residential_listings'
     and w.price_total is not null and r.active
     and not exists (select 1 from public.ops_authoritative_null_price a
                      where a.listing_id = w.listing_id)
     and coalesce(r.source_capture->'price_evidence'->>'authoritative_absent','false') <> 'true'
   limit 1;
  if v_probe_id is null then
    raise exception 'no unauthorised-blanking probe row available — cannot prove the barrier fires';
  end if;

  update public.aqar_residential_listings set price_total = null where id = v_probe_id;
  v_raised := public.mon_detect_price_blanked_without_authority();
  -- restore IMMEDIATELY, before any assertion can abort and leave the row blanked
  update public.aqar_residential_listings set price_total = v_before_price where id = v_probe_id;
  perform public.mon_detect_price_blanked_without_authority();          -- watch back to truth
  perform public.mon_resolve_key('price_blanked_without_authority',
                                 'price_blanked_without_authority');

  if v_raised < 1 then
    raise exception 'BARRIER DOES NOT FIRE: blanked aqar id % (was %) with no authority and the '
                    'detector stayed silent', v_probe_id, v_before_price;
  end if;

  if (select price_total from public.aqar_residential_listings where id = v_probe_id)
     is distinct from v_before_price then
    raise exception 'probe row % was not restored', v_probe_id;
  end if;
end $$;
