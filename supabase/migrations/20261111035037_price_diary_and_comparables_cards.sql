-- PRICE DIARY + COMPARABLES CARDS (owner, 2026-11-11 — permanent).
-- Owner: «let's start saving» the price before and after, with the dates, for every ad — and keep it for the
-- hidden and removed ones too, so the AI agent can do comparables later.
--
-- Two private tables, written by ONE trigger function attached to every listing table:
--   · listing_price_history — one line per EVENT: first seen, price change (old → new), gone (active→false),
--     back (active→true), removed (row deleted by the retention engine). Never updated, never deleted.
--   · listing_comparables   — one slim card per ad (what / where / size / rooms / first + last price / dates),
--     refreshed on every event and finalised on removal, so it outlives the ad. Photos, descriptions and
--     contact details are deliberately NOT kept.
-- Display only / analytics only: nothing here changes what search serves. PRICE = SOURCE: the source's own
-- price_total / price_annual are copied as stored, never re-derived.
-- The trigger can never break a scraper write: any error is swallowed into listing_price_diary_errors and
-- watched by mon_detect_price_diary_health(), which also re-attaches the trigger to any listing table that
-- lacks it (a new platform's tables) and raises if one still lacks it.

set lock_timeout = '5s';

create table if not exists public.listing_price_history (
  id               bigserial primary key,
  source_table     text        not null,
  listing_id       bigint      not null,
  event            text        not null check (event in ('start','first','price','gone','back','removed')),
  price_total      bigint,
  price_annual     bigint,
  old_price_total  bigint,
  old_price_annual bigint,
  at               timestamptz not null default now(),
  writer           text        default current_setting('application_name', true)
);
create index if not exists listing_price_history_ad_idx on public.listing_price_history (source_table, listing_id, at);
create index if not exists listing_price_history_at_idx on public.listing_price_history (at);
alter table public.listing_price_history enable row level security;
comment on table public.listing_price_history is
  'PRICE DIARY (owner 2026-11-11, permanent): one line per event of every ad — start (filled from what we knew '
  'when the diary began), first (new ad), price (old → new), gone, back, removed. Kept FOREVER, also for ads that '
  'are hidden or removed; never updated or deleted. Prices are the source''s own (PRICE = SOURCE). Written only '
  'by tg_listing_price_diary().';

create table if not exists public.listing_comparables (
  source_table       text        not null,
  listing_id         bigint      not null,
  source             text,
  transaction_type   text,
  rent_period        text,
  property_type      text,
  region             text,
  city               text,
  neighborhood       text,
  area_m2            integer,
  bedrooms           smallint,
  bathrooms          smallint,
  property_age       smallint,
  listing_url        text,
  site_date_added    text,
  first_seen_at      timestamptz,
  first_price_total  bigint,
  first_price_annual bigint,
  last_price_total   bigint,
  last_price_annual  bigint,
  price_changes      integer     not null default 0,
  last_seen_at       timestamptz,
  gone_at            timestamptz,
  removed_at         timestamptz,
  updated_at         timestamptz not null default now(),
  primary key (source_table, listing_id)
);
create index if not exists listing_comparables_place_idx on public.listing_comparables (city, neighborhood, property_type, transaction_type);
alter table public.listing_comparables enable row level security;
comment on table public.listing_comparables is
  'COMPARABLES CARD (owner 2026-11-11, permanent): one slim card per ad — what, where, size, rooms, first and last '
  'price, number of price changes, and the dates (site posted, first seen, last seen, gone, removed). Kept FOREVER, '
  'also after the ad is hidden or removed, so comparables can use sold/gone ads. No photos, descriptions or '
  'contacts. Written only by tg_listing_price_diary(); gone_at/removed_at mean the ad DISAPPEARED from the '
  'source, never proof it sold.';

create table if not exists public.listing_price_diary_errors (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  source_table text,
  listing_id   bigint,
  op           text,
  err          text
);
alter table public.listing_price_diary_errors enable row level security;

revoke delete, truncate, update on public.listing_price_history from anon, authenticated;
revoke delete, truncate on public.listing_comparables from anon, authenticated;

-- One card upsert, shared by the trigger and the backfill.
create or replace function public.listing_card_upsert(
  p_table text, r jsonb, p_gone timestamptz, p_removed timestamptz, p_price_changed boolean)
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into public.listing_comparables as c (
    source_table, listing_id, source, transaction_type, rent_period, property_type, region, city, neighborhood,
    area_m2, bedrooms, bathrooms, property_age, listing_url, site_date_added, first_seen_at,
    first_price_total, first_price_annual, last_price_total, last_price_annual, price_changes,
    last_seen_at, gone_at, removed_at, updated_at)
  values (
    p_table, (r->>'id')::bigint, r->>'source', r->>'transaction_type', r->>'rent_period', r->>'property_type',
    r->>'region', r->>'city', r->>'neighborhood', (r->>'area_m2')::integer, (r->>'bedrooms')::smallint,
    (r->>'bathrooms')::smallint, (r->>'property_age')::smallint, r->>'listing_url', r->>'date_added',
    coalesce((r->>'scraped_at')::timestamptz, now()),
    (r->>'price_total')::bigint, (r->>'price_annual')::bigint, (r->>'price_total')::bigint, (r->>'price_annual')::bigint,
    0, (r->>'last_seen_at')::timestamptz, p_gone, p_removed, now())
  on conflict (source_table, listing_id) do update set
    source = excluded.source, transaction_type = excluded.transaction_type, rent_period = excluded.rent_period,
    property_type = excluded.property_type, region = excluded.region, city = excluded.city,
    neighborhood = excluded.neighborhood, area_m2 = excluded.area_m2, bedrooms = excluded.bedrooms,
    bathrooms = excluded.bathrooms, property_age = excluded.property_age, listing_url = excluded.listing_url,
    site_date_added = excluded.site_date_added,
    first_seen_at = least(c.first_seen_at, excluded.first_seen_at),
    last_price_total = excluded.last_price_total, last_price_annual = excluded.last_price_annual,
    price_changes = c.price_changes + case when p_price_changed then 1 else 0 end,
    last_seen_at = greatest(c.last_seen_at, excluded.last_seen_at),
    gone_at = excluded.gone_at,
    removed_at = coalesce(excluded.removed_at, c.removed_at),
    updated_at = now();
$$;

create or replace function public.tg_listing_price_diary()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_changed boolean := false;
  v_id bigint;
begin
  begin
    if TG_OP = 'INSERT' then
      v_id := new.id;
      insert into public.listing_price_history (source_table, listing_id, event, price_total, price_annual)
      values (TG_TABLE_NAME, new.id, 'first', new.price_total, new.price_annual);
      perform public.listing_card_upsert(TG_TABLE_NAME, to_jsonb(new),
        case when new.active is false then coalesce(new.deactivated_at, now()) end, null, false);
    elsif TG_OP = 'UPDATE' then
      v_id := new.id;
      if old.price_total is distinct from new.price_total or old.price_annual is distinct from new.price_annual then
        v_changed := true;
        insert into public.listing_price_history
          (source_table, listing_id, event, price_total, price_annual, old_price_total, old_price_annual)
        values (TG_TABLE_NAME, new.id, 'price', new.price_total, new.price_annual, old.price_total, old.price_annual);
      end if;
      if old.active is distinct from new.active then
        insert into public.listing_price_history (source_table, listing_id, event, price_total, price_annual)
        values (TG_TABLE_NAME, new.id, case when new.active is true then 'back' else 'gone' end,
                new.price_total, new.price_annual);
      end if;
      perform public.listing_card_upsert(TG_TABLE_NAME, to_jsonb(new),
        case when new.active is not true then coalesce(new.deactivated_at, now()) end, null, v_changed);
    elsif TG_OP = 'DELETE' then
      v_id := old.id;
      insert into public.listing_price_history (source_table, listing_id, event, price_total, price_annual)
      values (TG_TABLE_NAME, old.id, 'removed', old.price_total, old.price_annual);
      perform public.listing_card_upsert(TG_TABLE_NAME, to_jsonb(old),
        coalesce(old.deactivated_at, now()), now(), false);
    end if;
  exception when others then
    -- The diary must never break a scraper write or a retention delete.
    begin
      insert into public.listing_price_diary_errors (source_table, listing_id, op, err)
      values (TG_TABLE_NAME, v_id, TG_OP, sqlerrm);
    exception when others then null;
    end;
  end;
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end
$$;

comment on function public.tg_listing_price_diary() is
  'AFTER INSERT / UPDATE (price or active changed) / DELETE on every listing table: writes the price diary '
  '(listing_price_history) and the comparables card (listing_comparables). Never raises — errors go to '
  'listing_price_diary_errors. Owner 2026-11-11.';

create or replace function public.listing_price_diary_attach(p_table text)
returns void
language plpgsql
security definer
set search_path to 'public'
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

do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
     where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
  loop
    perform public.listing_price_diary_attach(t);
  end loop;
end $$;

-- Fill the diary and the cards from what we already know (run per table after the apply; idempotent).
-- Each existing ad gets a 'start' line dated when we first saw it, plus 'gone' if it is hidden.
create or replace function public.listing_price_diary_backfill(p_table text)
returns integer
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '300s'
as $$
declare n int;
begin
  execute format($f$
    with rows as (
      select t.* from public.%1$I t
       where not exists (select 1 from public.listing_comparables c
                          where c.source_table = %2$L and c.listing_id = t.id)
    ), cards as (
      insert into public.listing_comparables (
        source_table, listing_id, source, transaction_type, rent_period, property_type, region, city, neighborhood,
        area_m2, bedrooms, bathrooms, property_age, listing_url, site_date_added, first_seen_at,
        first_price_total, first_price_annual, last_price_total, last_price_annual, last_seen_at, gone_at)
      select %2$L, id, source, transaction_type, rent_period, property_type, region, city, neighborhood,
             area_m2, bedrooms, bathrooms, property_age, listing_url, date_added, scraped_at,
             price_total, price_annual, price_total, price_annual, last_seen_at,
             case when active is not true then coalesce(deactivated_at, last_seen_at) end
        from rows
      on conflict do nothing
      returning listing_id
    ), starts as (
      insert into public.listing_price_history (source_table, listing_id, event, price_total, price_annual, at, writer)
      select %2$L, id, 'start', price_total, price_annual, coalesce(scraped_at, now()), 'backfill'
        from rows
      returning 1
    ), gones as (
      insert into public.listing_price_history (source_table, listing_id, event, price_total, price_annual, at, writer)
      select %2$L, id, 'gone', price_total, price_annual, coalesce(deactivated_at, last_seen_at, now()), 'backfill'
        from rows where active is not true
      returning 1
    )
    select count(*) from cards$f$, p_table, p_table) into n;
  return n;
end
$$;

-- Ads the retention engine already removed (their full row is in purged_listings_archive).
create or replace function public.listing_price_diary_backfill_archive()
returns integer
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '300s'
as $$
declare n int;
begin
  with a as (
    select distinct on (p.source_table, p.listing_id) p.*
      from public.purged_listings_archive p
     where not exists (select 1 from public.listing_comparables c
                        where c.source_table = p.source_table and c.listing_id = p.listing_id)
     order by p.source_table, p.listing_id, p.deleted_at desc
  ), cards as (
    insert into public.listing_comparables (
      source_table, listing_id, source, transaction_type, rent_period, property_type, region, city, neighborhood,
      area_m2, bedrooms, bathrooms, property_age, listing_url, site_date_added, first_seen_at,
      first_price_total, first_price_annual, last_price_total, last_price_annual, last_seen_at, gone_at, removed_at)
    select source_table, listing_id, row_data->>'source', row_data->>'transaction_type', row_data->>'rent_period',
           row_data->>'property_type', row_data->>'region', row_data->>'city', row_data->>'neighborhood',
           (row_data->>'area_m2')::integer, (row_data->>'bedrooms')::smallint, (row_data->>'bathrooms')::smallint,
           (row_data->>'property_age')::smallint, row_data->>'listing_url', row_data->>'date_added',
           (row_data->>'scraped_at')::timestamptz,
           (row_data->>'price_total')::bigint, (row_data->>'price_annual')::bigint,
           (row_data->>'price_total')::bigint, (row_data->>'price_annual')::bigint,
           (row_data->>'last_seen_at')::timestamptz, coalesce(deactivated_at, deleted_at), deleted_at
      from a
    on conflict do nothing
    returning 1
  ), starts as (
    insert into public.listing_price_history (source_table, listing_id, event, price_total, price_annual, at, writer)
    select source_table, listing_id, 'start', (row_data->>'price_total')::bigint, (row_data->>'price_annual')::bigint,
           coalesce((row_data->>'scraped_at')::timestamptz, deleted_at), 'backfill' from a
    returning 1
  ), removed as (
    insert into public.listing_price_history (source_table, listing_id, event, price_total, price_annual, at, writer)
    select source_table, listing_id, 'removed', (row_data->>'price_total')::bigint, (row_data->>'price_annual')::bigint,
           deleted_at, 'backfill' from a
    returning 1
  )
  select count(*) into n from cards;
  return n;
end
$$;

-- Watcher: re-attach to any listing table that lacks the diary triggers (a new platform), and raise if
-- one still lacks them or the trigger has been swallowing errors.
create or replace function public.mon_price_diary_missing()
returns text[]
language sql
stable
set search_path to 'public'
as $$
  select coalesce(array_agg(t.tablename order by t.tablename), '{}')
    from pg_tables t
   where t.schemaname = 'public'
     and t.tablename ~ '_(residential|commercial)_listings$'
     and (select count(*) from pg_trigger tg
            join pg_class c on c.oid = tg.tgrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = t.tablename and not tg.tgisinternal
             and tg.tgenabled <> 'D'
             and tg.tgname in ('trg_listing_price_diary_ins','trg_listing_price_diary_upd','trg_listing_price_diary_del')) < 3;
$$;

create or replace function public.mon_detect_price_diary_health()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare n int := 0; missing text[]; t text; errs int;
begin
  foreach t in array public.mon_price_diary_missing() loop
    begin
      perform public.listing_price_diary_attach(t);
    exception when others then null;
    end;
  end loop;
  missing := public.mon_price_diary_missing();
  select count(*) into errs from public.listing_price_diary_errors where at > now() - interval '1 day';
  if cardinality(missing) > 0 or errs > 0 then
    n := public.mon_raise('P2', 'price_diary_unhealthy', 'all', 'price_diary_unhealthy',
      jsonb_build_object('tables_without_diary', to_jsonb(missing), 'errors_last_day', errs,
        'why', 'the price diary (listing_price_history / listing_comparables, owner 2026-11-11) is not recording '
            || 'every listing table, or its trigger swallowed errors — price changes and dates are being lost for good.',
        'fix', 'read listing_price_diary_errors; select listing_price_diary_attach(<table>); never drop the triggers '
            || 'to clear this.'));
  else
    perform public.mon_resolve('price_diary_unhealthy', 'all');
  end if;
  return n;
end $$;

do $$
declare src text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors'::regproc);
  if position('mon_detect_price_diary_health' in src) = 0 then
    src := replace(src,
      $q$'mon_detect_adjudication_guard_missing',$q$,
      $q$'mon_detect_adjudication_guard_missing',
    'mon_detect_price_diary_health',$q$);
    if position('mon_detect_price_diary_health' in src) = 0 then
      raise exception 'could not splice mon_detect_price_diary_health into mon_run_all_detectors';
    end if;
    execute src;
  end if;
end $$;