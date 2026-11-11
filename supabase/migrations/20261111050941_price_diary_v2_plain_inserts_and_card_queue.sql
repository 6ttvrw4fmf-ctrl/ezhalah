-- PRICE DIARY v2 (2026-11-11, CodeRabbit review of PR #11776 — all four findings).
--
-- 1. MAJOR — no subtransaction per row. The first trigger wrapped each row in an EXCEPTION block, which opens a
--    subtransaction per fired row; a scraper batch of 300 new ads (deal sends 300) overflows Postgres's 64-entry
--    per-backend subtransaction cache and pushes every concurrent visibility check onto pg_subtrans. The trigger now
--    does only TWO PLAIN INSERTS per event (the diary line + a queue row) with typed values — no casts, no upsert, no
--    exception block. The comparables card is built OUT of the write path by listing_cards_refresh(), set-based, one
--    subtransaction per TABLE per run, called from the hourly detector sweep. A card lags up to an hour; the diary
--    line (price before → after, with its date) is written in the same transaction as the change.
-- 2. MAJOR — a new site is connected the moment its table exists: event trigger listing_price_diary_born_attached on
--    CREATE TABLE attaches the diary before any write can reach it. The watcher stays as the safety net.
-- 3. lock_timeout 5s on listing_price_diary_attach(): run from the sweep, it must never queue scraper writes
--    behind a trigger DDL that waits on a long transaction.
-- 4. REVOKE ALL on every diary table and sequence from public, anon, authenticated (RLS does not cover TRUNCATE).

set lock_timeout = '5s';

create table if not exists public.listing_card_queue (
  id           bigserial primary key,
  source_table text        not null,
  listing_id   bigint      not null,
  at           timestamptz not null default now()
);
create index if not exists listing_card_queue_table_idx on public.listing_card_queue (source_table, id);
alter table public.listing_card_queue enable row level security;
comment on table public.listing_card_queue is
  'Ads whose comparables card must be rebuilt. Written by tg_listing_price_diary() (one plain insert per event), '
  'drained by listing_cards_refresh() from the hourly detector sweep. A row older than 6 hours raises price_diary_unhealthy.';

revoke all on public.listing_price_history, public.listing_comparables, public.listing_price_diary_errors,
              public.listing_card_queue from public, anon, authenticated;
revoke all on sequence public.listing_price_history_id_seq, public.listing_price_diary_errors_id_seq,
              public.listing_card_queue_id_seq from public, anon, authenticated;

create or replace function public.tg_listing_price_diary()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.listing_price_history (source_table, listing_id, event, price_total, price_annual)
    values (TG_TABLE_NAME, new.id, 'first', new.price_total, new.price_annual);
    insert into public.listing_card_queue (source_table, listing_id) values (TG_TABLE_NAME, new.id);
    return new;
  elsif TG_OP = 'UPDATE' then
    if old.price_total is distinct from new.price_total or old.price_annual is distinct from new.price_annual then
      insert into public.listing_price_history
        (source_table, listing_id, event, price_total, price_annual, old_price_total, old_price_annual)
      values (TG_TABLE_NAME, new.id, 'price', new.price_total, new.price_annual, old.price_total, old.price_annual);
    end if;
    if old.active is distinct from new.active then
      insert into public.listing_price_history (source_table, listing_id, event, price_total, price_annual)
      values (TG_TABLE_NAME, new.id, case when new.active is true then 'back' else 'gone' end,
              new.price_total, new.price_annual);
    end if;
    insert into public.listing_card_queue (source_table, listing_id) values (TG_TABLE_NAME, new.id);
    return new;
  else
    insert into public.listing_price_history (source_table, listing_id, event, price_total, price_annual)
    values (TG_TABLE_NAME, old.id, 'removed', old.price_total, old.price_annual);
    insert into public.listing_card_queue (source_table, listing_id) values (TG_TABLE_NAME, old.id);
    return old;
  end if;
end
$$;

comment on function public.tg_listing_price_diary() is
  'AFTER INSERT / UPDATE (price or active changed) / DELETE on every listing table: one diary line '
  '(listing_price_history) + one listing_card_queue row. Two plain inserts, no exception block — a per-row '
  'subtransaction overflows the 64-entry cache on batch writes (CodeRabbit, PR #11776). Owner 2026-11-11.';

drop function if exists public.listing_card_upsert(text, jsonb, timestamptz, timestamptz, boolean);

create or replace function public.listing_price_diary_attach(p_table text)
returns void
language plpgsql
security definer
set search_path to 'public'
set lock_timeout to '5s'
as $$
begin
  execute format('drop trigger if exists trg_listing_price_diary_ins on public.%I', p_table);
  execute format('drop trigger if exists trg_listing_price_diary_upd on public.%I', p_table);
  execute format('drop trigger if exists trg_listing_price_diary_del on public.%I', p_table);
  execute format('create trigger trg_listing_price_diary_ins after insert on public.%I '
                 'for each row execute function public.tg_listing_price_diary()', p_table);
  execute format('create trigger trg_listing_price_diary_upd after update on public.%I '
                 'for each row when (old.price_total is distinct from new.price_total '
                 'or old.price_annual is distinct from new.price_annual '
                 'or old.active is distinct from new.active) '
                 'execute function public.tg_listing_price_diary()', p_table);
  execute format('create trigger trg_listing_price_diary_del after delete on public.%I '
                 'for each row execute function public.tg_listing_price_diary()', p_table);
end
$$;

-- A new listing table gets the diary the moment it is created, before any write can reach it.
create or replace function public.listing_price_diary_born_attached()
returns event_trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare r record;
begin
  for r in select k.relname from pg_event_trigger_ddl_commands() c
            join pg_class k on k.oid = c.objid
           where c.classid = 'pg_class'::regclass and k.relnamespace = 'public'::regnamespace
             and k.relkind = 'r' and k.relname ~ '_(residential|commercial)_listings$' loop
    begin
      perform public.listing_price_diary_attach(r.relname);
    exception when others then
      insert into public.listing_price_diary_errors (source_table, op, err) values (r.relname, 'attach', sqlerrm);
    end;
  end loop;
end $$;
drop event trigger if exists listing_price_diary_born_attached;
create event trigger listing_price_diary_born_attached on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.listing_price_diary_born_attached();

-- Rebuild the cards of every queued ad, set-based, one table at a time. Called from the hourly detector sweep.
create or replace function public.listing_cards_refresh(p_limit integer default 100000)
returns integer
language plpgsql
security definer
set search_path to 'public'
set lock_timeout to '5s'
as $$
declare t text; n int := 0; k int;
begin
  if not pg_try_advisory_xact_lock(hashtext('listing_cards_refresh')) then
    return 0;
  end if;
  for t in select distinct q.source_table from public.listing_card_queue q loop
    begin
      execute format($f$
        with d as (
          delete from public.listing_card_queue q
           where q.id in (select id from public.listing_card_queue
                           where source_table = %2$L order by id limit %3$s)
          returning q.listing_id
        ), ids as (
          select distinct listing_id from d
        ), live as (
          insert into public.listing_comparables as c (
            source_table, listing_id, source, transaction_type, rent_period, property_type, region, city,
            neighborhood, area_m2, bedrooms, bathrooms, property_age, listing_url, site_date_added, first_seen_at,
            first_price_total, first_price_annual, last_price_total, last_price_annual, price_changes,
            last_seen_at, gone_at, removed_at, updated_at)
          select %2$L, x.id, x.source, x.transaction_type, x.rent_period, x.property_type, x.region, x.city,
                 x.neighborhood, x.area_m2, x.bedrooms, x.bathrooms, x.property_age, x.listing_url, x.date_added,
                 coalesce(x.scraped_at, now()),
                 coalesce(fp.p_total, x.price_total), coalesce(fp.p_annual, x.price_annual),
                 x.price_total, x.price_annual,
                 (select count(*) from public.listing_price_history h
                   where h.source_table = %2$L and h.listing_id = x.id and h.event = 'price'),
                 x.last_seen_at,
                 case when x.active is not true then coalesce(x.deactivated_at, x.last_seen_at, now()) end,
                 null, now()
            from ids join public.%1$I x on x.id = ids.listing_id
            left join lateral (
              select case when h.event = 'price' then h.old_price_total else h.price_total end as p_total,
                     case when h.event = 'price' then h.old_price_annual else h.price_annual end as p_annual
                from public.listing_price_history h
               where h.source_table = %2$L and h.listing_id = x.id
               order by h.at, h.id limit 1) fp on true
          on conflict (source_table, listing_id) do update set
            source = excluded.source, transaction_type = excluded.transaction_type,
            rent_period = excluded.rent_period, property_type = excluded.property_type, region = excluded.region,
            city = excluded.city, neighborhood = excluded.neighborhood, area_m2 = excluded.area_m2,
            bedrooms = excluded.bedrooms, bathrooms = excluded.bathrooms, property_age = excluded.property_age,
            listing_url = excluded.listing_url, site_date_added = excluded.site_date_added,
            first_seen_at = least(c.first_seen_at, excluded.first_seen_at),
            last_price_total = excluded.last_price_total, last_price_annual = excluded.last_price_annual,
            price_changes = excluded.price_changes,
            last_seen_at = greatest(c.last_seen_at, excluded.last_seen_at),
            gone_at = excluded.gone_at, removed_at = null, updated_at = now()
          returning c.listing_id
        ), arch as (
          insert into public.listing_comparables as c (
            source_table, listing_id, source, transaction_type, rent_period, property_type, region, city,
            neighborhood, area_m2, bedrooms, bathrooms, property_age, listing_url, site_date_added, first_seen_at,
            first_price_total, first_price_annual, last_price_total, last_price_annual, price_changes,
            last_seen_at, gone_at, removed_at, updated_at)
          select %2$L, a.listing_id, a.row_data->>'source', a.row_data->>'transaction_type',
                 a.row_data->>'rent_period', a.row_data->>'property_type', a.row_data->>'region',
                 a.row_data->>'city', a.row_data->>'neighborhood', (a.row_data->>'area_m2')::numeric::integer,
                 (a.row_data->>'bedrooms')::numeric::smallint, (a.row_data->>'bathrooms')::numeric::smallint,
                 (a.row_data->>'property_age')::numeric::smallint, a.row_data->>'listing_url',
                 a.row_data->>'date_added', coalesce((a.row_data->>'scraped_at')::timestamptz, a.deleted_at),
                 (a.row_data->>'price_total')::numeric::bigint, (a.row_data->>'price_annual')::numeric::bigint,
                 (a.row_data->>'price_total')::numeric::bigint, (a.row_data->>'price_annual')::numeric::bigint,
                 (select count(*) from public.listing_price_history h
                   where h.source_table = %2$L and h.listing_id = a.listing_id and h.event = 'price'),
                 (a.row_data->>'last_seen_at')::timestamptz, coalesce(a.deactivated_at, a.deleted_at),
                 a.deleted_at, now()
            from (select distinct on (p.listing_id) p.*
                    from public.purged_listings_archive p join ids on ids.listing_id = p.listing_id
                   where p.source_table = %2$L
                     and not exists (select 1 from public.%1$I x where x.id = p.listing_id)
                   order by p.listing_id, p.deleted_at desc) a
          on conflict (source_table, listing_id) do update set
            last_price_total = excluded.last_price_total, last_price_annual = excluded.last_price_annual,
            price_changes = excluded.price_changes,
            gone_at = coalesce(c.gone_at, excluded.gone_at),
            removed_at = excluded.removed_at, updated_at = now()
          returning c.listing_id
        ), lost as (
          update public.listing_comparables c
             set removed_at = coalesce(c.removed_at, now()), gone_at = coalesce(c.gone_at, now()), updated_at = now()
            from ids
           where c.source_table = %2$L and c.listing_id = ids.listing_id
             and not exists (select 1 from public.%1$I x where x.id = ids.listing_id)
             and not exists (select 1 from public.purged_listings_archive p
                              where p.source_table = %2$L and p.listing_id = ids.listing_id)
          returning 1
        )
        select count(*)::int from ids$f$, t, t, p_limit) into k;
      n := n + k;
    exception when query_canceled then
      raise;
    when others then
      insert into public.listing_price_diary_errors (source_table, op, err) values (t, 'refresh', sqlerrm);
    end;
  end loop;
  return n;
end
$$;

comment on function public.listing_cards_refresh(integer) is
  'Drains listing_card_queue: rebuilds each queued ad''s comparables card from its live row, or — once the retention '
  'engine removed it — from purged_listings_archive. Set-based, one subtransaction per table. Errors go to '
  'listing_price_diary_errors. Called by mon_detect_price_diary_health() every sweep.';

create or replace function public.mon_detect_price_diary_health()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare n int := 0; missing text[]; t text; errs int; oldest interval;
begin
  foreach t in array public.mon_price_diary_missing() loop
    begin
      perform public.listing_price_diary_attach(t);
    exception when others then null;
    end;
  end loop;
  begin
    perform public.listing_cards_refresh();
  exception when query_canceled then
    raise;
  when others then
    insert into public.listing_price_diary_errors (op, err) values ('refresh', sqlerrm);
  end;
  missing := public.mon_price_diary_missing();
  select count(*) into errs from public.listing_price_diary_errors where at > now() - interval '1 day';
  select now() - min(at) into oldest from public.listing_card_queue;
  if cardinality(missing) > 0 or errs > 0 or coalesce(oldest, interval '0') > interval '6 hours' then
    n := public.mon_raise('P2', 'price_diary_unhealthy', 'all', 'price_diary_unhealthy',
      jsonb_build_object('tables_without_diary', to_jsonb(missing), 'errors_last_day', errs,
        'oldest_queued', oldest::text,
        'why', 'the price diary (listing_price_history / listing_comparables, owner 2026-11-11) is not recording '
            || 'every listing table, its card refresh is failing or falling behind — price changes and dates are '
            || 'being lost or left unread.',
        'fix', 'read listing_price_diary_errors; select listing_price_diary_attach(<table>); '
            || 'select listing_cards_refresh(); never drop the triggers or empty the queue to clear this.'));
  else
    perform public.mon_resolve('price_diary_unhealthy', 'all');
  end if;
  return n;
end $$;