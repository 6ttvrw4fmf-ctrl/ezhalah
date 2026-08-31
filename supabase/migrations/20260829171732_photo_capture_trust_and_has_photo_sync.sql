-- PHOTO PREFERENCE, tier 3 of the new MATCH -> DIVERSITY -> PHOTO PREFERENCE -> ROTATION ranking
-- hierarchy (owner, 2026-08-29). Full-fleet audit run live before this migration (49 source_tables,
-- joined production_ready rows against each raw table's own photo_urls, excluding aqar's documented
-- villa-default.png placeholder the same way remote.ts's finalize() already does): most platforms
-- capture real photos on >=90% of reachable rows, but four are clear outliers -
-- mustqr_residential_listings 32.5% (296/910), mustqr_commercial_listings 24.2% (67/277),
-- hajer_residential_listings 58.8% (70/119), souq24_residential_listings 31.0% (13/42) - and every
-- source_table under 50 reachable rows is too small a sample to trust either way.
--
-- Owner's exact rule: "UNKNOWN must remain UNKNOWN. A platform with suspicious/incomplete photo
-- capture must not have its listings demoted as no-photo." So trust is never a one-time hand-picked
-- list (that rots and can't be re-derived) - it is a STORED, RE-COMPUTABLE PROBE
-- (ops_photo_capture_trust), the same shape as ops_rent_period_source_probe: refreshed on a cron
-- cadence from live counts, and has_photo is written for a source_table ONLY while its current probe
-- says trusted. A platform that is not (yet) trusted keeps has_photo NULL forever - never FALSE - so
-- it is neutral in the photo-preference tie-break (search.ts sorts it neither before nor after a
-- known-has-photo row), not treated as confirmed no-photo. This mirrors the AF probe's
-- 'UNKNOWN must never become NO' rule the owner set for this codebase 2026-08-25 (afProbe.ts).

create table if not exists public.ops_photo_capture_trust (
  source_table text primary key,
  reachable    bigint not null,
  real_photo   bigint not null,
  rate         numeric generated always as (case when reachable > 0 then real_photo::numeric / reachable else 0 end) stored,
  -- the bar: a real sample (>=50 reachable rows) AND a real capture rate (>=70%). Both numbers are
  -- re-derived every run, so a platform's scraper improving (or regressing) moves it across the line
  -- automatically - no migration needed to "graduate" or demote a platform.
  trusted      boolean generated always as (reachable >= 50 and real_photo::numeric / greatest(reachable, 1) >= 0.70) stored,
  checked_at   timestamptz not null default now()
);

comment on table public.ops_photo_capture_trust is
  'Per-source_table photo-capture audit, refreshed by refresh_photo_capture_trust(). trusted gates '
  'whether sync_listing_photos() is allowed to write has_photo for that platform - never a hand-picked '
  'allowlist, always re-derived from live counts. See migration header for the 2026-08-29 owner rule.';

alter table public.search_listings_ar add column if not exists has_photo boolean;

comment on column public.search_listings_ar.has_photo is
  'NULL = unknown (no trusted signal yet - default, and permanent for any source_table that never '
  'clears ops_photo_capture_trust.trusted). TRUE/FALSE = a trusted platform''s row genuinely has/lacks '
  'a real, non-placeholder photo. NEVER treat NULL as FALSE - see PHOTO PREFERENCE rule, ARCHITECTURE.md.';

-- Recompute the audit fleet-wide. Dynamic per-table SQL (same technique already used by
-- listing_rich_attrs_fleet_wide_generated_branches) - every source_table already carries photo_urls
-- (confirmed live 2026-08-29: 0 of 49 missing it), so no per-platform branch logic is needed, just a
-- uniform join. A single villa-default.png exclusion mirrors remote.ts's finalize() verbatim so the
-- server-computed has_photo can never disagree with what the client already shows as "no photo".
create or replace function public.refresh_photo_capture_trust()
returns setof public.ops_photo_capture_trust
language plpgsql
as $fn$
declare t text;
begin
  for t in select distinct source_table from public.search_listings_ar order by 1 loop
    execute format($f$
      insert into public.ops_photo_capture_trust (source_table, reachable, real_photo, checked_at)
      select %L, count(*) filter (where s.production_ready),
        count(*) filter (where s.production_ready and w.photo_urls is not null and array_length(w.photo_urls,1) > 0
          and exists (select 1 from unnest(w.photo_urls) u where u not like '%%villa-default.png%%')),
        now()
      from %I w join public.search_listings_ar s
        on s.source_table = %L and s.listing_id = w.id
      on conflict (source_table) do update set
        reachable = excluded.reachable, real_photo = excluded.real_photo, checked_at = excluded.checked_at
    $f$, t, t, t);
  end loop;
  return query select * from public.ops_photo_capture_trust order by source_table;
end
$fn$;

comment on function public.refresh_photo_capture_trust() is
  'Recomputes ops_photo_capture_trust for every source_table currently in search_listings_ar. Pure '
  'read + upsert, no has_photo write - sync_listing_photos() is the only writer of that column.';

-- Batched writer, same <=25k-row-per-statement shape as sync_listing_rich_attrs (standing rule,
-- 2026-08-10 outage). No-ops (returns 0, touches nothing) for any source_table the current probe does
-- not mark trusted - this is the enforcement point of "UNKNOWN must remain UNKNOWN": has_photo simply
-- never gets written for that platform, so it stays NULL from the column default forever.
create or replace function public.sync_listing_photos(p_source_table text)
returns bigint
language plpgsql
as $fn$
declare n bigint := 0; batch bigint; lo bigint := 0; k constant int := 25000; is_trusted boolean;
begin
  if p_source_table is null or p_source_table !~ '^[a-z0-9_]+_listings$' then
    raise exception 'p_source_table must be a bare <platform>_<kind>_listings identifier, got %', p_source_table;
  end if;

  select trusted into is_trusted from public.ops_photo_capture_trust where source_table = p_source_table;
  if is_trusted is not true then
    return 0;
  end if;

  create temp table if not exists _photo_diff(listing_id bigint, has_photo boolean) on commit drop;
  truncate _photo_diff;

  execute format($f$
    insert into _photo_diff
    select w.id,
      (w.photo_urls is not null and array_length(w.photo_urls,1) > 0
        and exists (select 1 from unnest(w.photo_urls) u where u not like '%%villa-default.png%%'))
    from %I w
    join public.search_listings_ar s on s.source_table = %L and s.listing_id = w.id
    where s.has_photo is distinct from
      (w.photo_urls is not null and array_length(w.photo_urls,1) > 0
        and exists (select 1 from unnest(w.photo_urls) u where u not like '%%villa-default.png%%'))
  $f$, p_source_table, p_source_table);

  create index if not exists _photo_diff_id on _photo_diff (listing_id);

  loop
    update public.search_listings_ar s set has_photo = d.has_photo
    from _photo_diff d
    where s.source_table = p_source_table and s.listing_id = d.listing_id
      and d.listing_id > lo and d.listing_id <= lo + k;
    get diagnostics batch = row_count;
    n := n + batch;
    lo := lo + k;
    exit when lo > coalesce((select max(listing_id) from _photo_diff), 0);
  end loop;

  return n;
end
$fn$;

comment on function public.sync_listing_photos(text) is
  'Writes has_photo into search_listings_ar for ONE platform table, <=25k rows/statement, and ONLY '
  'when ops_photo_capture_trust currently marks it trusted (else a strict no-op - has_photo stays '
  'NULL, never FALSE, for an unaudited/suspect platform).';

create or replace function public.sync_all_listing_photos()
returns table(source_table text, rows_written bigint)
language plpgsql
as $fn$
declare t text; n bigint;
begin
  for t in select distinct s.source_table from public.search_listings_ar s order by 1 loop
    n := public.sync_listing_photos(t);
    if n > 0 then
      source_table := t; rows_written := n; return next;
    end if;
  end loop;
end
$fn$;

comment on function public.sync_all_listing_photos() is
  'Runs sync_listing_photos() for every source_table in search_listings_ar. New platforms are picked '
  'up automatically, same shape as sync_all_rich_attrs.';

-- One-time initial population so has_photo is live immediately, not after the next hourly tick.
select public.refresh_photo_capture_trust();
select public.sync_all_listing_photos();

-- Chain onto the existing hourly job (jobid 28) right after the rich-attrs sync, same safe-edit
-- pattern as sync_all_rich_attrs_and_cron.sql: verify current command, append, verify post-edit.
do $$
declare cur text; want text;
begin
  select command into cur from cron.job where jobid = 28;
  if cur is null or cur not like '%sync_search_listings_ar()%' then
    raise exception 'jobid 28 is not the search sync job - refusing to edit';
  end if;
  if cur like '%sync_all_listing_photos()%' then
    return; -- already wired (re-run safety)
  end if;
  want := rtrim(btrim(cur), ';')
    || '; select public.refresh_photo_capture_trust(); select * from public.sync_all_listing_photos();';
  perform cron.alter_job(28, command => want);

  select command into cur from cron.job where jobid = 28;
  if cur not like '%sync_search_listings_ar()%' or cur not like '%sync_all_rich_attrs()%'
     or cur not like '%refresh_photo_capture_trust()%' or cur not like '%sync_all_listing_photos()%' then
    raise exception 'post-edit jobid 28 is wrong: %', cur;
  end if;
end $$;

-- Monitor: a photo sync that silently stops running reads as "clean" the same way nine dark
-- detectors did on 2026-08-10 (AGENTS.md). Fires if the probe hasn't refreshed in >36h (3x the
-- hourly cadence with slack for a missed tick) while trusted rows exist to sync. Signature matches
-- the mon_run_all_detectors() contract exactly (no args, returns integer = rows raised this call).
create or replace function public.mon_detect_photo_sync_stale()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare stalest timestamptz; trusted_ct bigint; n int := 0;
begin
  select min(checked_at) into stalest from public.ops_photo_capture_trust;
  select count(*) into trusted_ct from public.ops_photo_capture_trust where trusted;
  if trusted_ct > 0 and (stalest is null or stalest < now() - interval '36 hours') then
    n := public.mon_raise('P2', 'photo_sync_stale', 'all', 'photo_sync_stale',
      jsonb_build_object('stalest', stalest, 'trusted_platforms', trusted_ct,
        'why', 'ops_photo_capture_trust has not refreshed in 36h+ while trusted platforms exist - '
               || 'jobid 28 chain may have stopped calling refresh_photo_capture_trust()/'
               || 'sync_all_listing_photos().'));
  else
    perform public.mon_resolve_key('photo_sync_stale', 'photo_sync_stale');
  end if;
  return n;
end
$fn$;

comment on function public.mon_detect_photo_sync_stale() is
  'Fires if the photo-capture probe or sync has not run in 36h+ while trusted platforms exist. '
  'Rostered in mon_run_all_detectors() in this same migration.';

-- Guarded needle-edit roster wire (the ONLY safe way to touch the roster, per
-- 20260826134525_unacknowledged_p0_detector_and_roster_wire.sql precedent): read the LIVE body,
-- splice the one new name in next to an anchor already present, execute the result.
do $roster$
declare v_body text;
begin
  select pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure) into v_body;

  if v_body not like '%mon_detect_card_link_identity%' then
    raise exception 'anchor mon_detect_card_link_identity not found in live mon_run_all_detectors body -- refusing to splice blind';
  end if;
  if v_body like '%mon_detect_photo_sync_stale%' then
    raise exception 'mon_detect_photo_sync_stale already present in the roster -- refusing to duplicate';
  end if;

  v_body := replace(v_body,
    $marker$'mon_detect_card_link_identity'$marker$,
    $marker$'mon_detect_card_link_identity', 'mon_detect_photo_sync_stale'$marker$);

  execute v_body;
end $roster$;
