-- «منذ …» DATES, PART 2: A BRACKET, EVERY FLIP LOGGED, AND A SITE SWITCHED OFF THE MOMENT ITS COUNT STOPS BEING
-- THE REAL AGE (owner 2026-11-11: «make it a 10/10 … make it a rule … i never want to go back to this»).
--
-- Part 1 (20261111233249) stored a FLOOR — «posted no earlier than» — and served it to the «نُشر خلال» window. This adds:
--   1. posted_latest_at, the CEILING — «posted no later than»: the tightest of every reading's (read time − shortest
--      age the text allows) and the time we first stored the ad. Floor and ceiling bracket the posting day; for a
--      «N يوم» ad the bracket is about two days, and it narrows every time the text flips.
--   2. ops_relative_age_event: every change of a row's «منذ …» text (a flip) and every reading that contradicts what
--      we already proved (a reset — the site restarted its count), with the text and the read time. Nothing else
--      is logged, so it grows by flips only.
--   3. ops_relative_age_site: which sites may serve a floor at all. ialqarawi is enabled (proof in
--      scrapers/common/posting_date.py AGO_COUNT_IS_REAL_AGE). mon_detect_relative_posting_floor_unsafe() switches a
--      site OFF by itself when its resets reach 5 in 7 days and 1 % of its dated ads: its ads leave every «نُشر خلال»
--      window (unknown, never «new») until someone re-proves it and sets enabled = true with the proof.
-- The window still counts by the floor alone, so an ad is never called newer than proven.

set local lock_timeout = '3s';

alter table public.ialqarawi_residential_listings add column if not exists posted_latest_at timestamptz;
alter table public.ialqarawi_commercial_listings  add column if not exists posted_latest_at timestamptz;
comment on column public.ialqarawi_residential_listings.posted_latest_at is
  'The site prints only «منذ N …»: the LATEST instant the ad can have been posted (a ceiling). With posted_earliest_at it brackets the posting day; narrowed by every reading and by scraped_at (trg_keep_tightest_posted_earliest).';
comment on column public.ialqarawi_commercial_listings.posted_latest_at is
  'The site prints only «منذ N …»: the LATEST instant the ad can have been posted (a ceiling). With posted_earliest_at it brackets the posting day; narrowed by every reading and by scraped_at (trg_keep_tightest_posted_earliest).';

create table if not exists public.ops_relative_age_site (
  platform        text primary key,
  enabled         boolean not null,
  proof           text not null,
  disabled_reason text,
  changed_at      timestamptz not null default now(),
  constraint relative_age_site_off_says_why check (enabled or disabled_reason is not null)
);
comment on table public.ops_relative_age_site is
  'Sites whose «منذ …» count may serve a floor to the «نُشر خلال» window. mon_detect_relative_posting_floor_unsafe() sets enabled = false by itself when the count starts resetting; only a new proof turns it back on.';
revoke all on table public.ops_relative_age_site from public, anon, authenticated;
grant select, insert, update on table public.ops_relative_age_site to service_role;
insert into public.ops_relative_age_site (platform, enabled, proof) values
  ('ialqarawi', true, '2026-11-11: every ad saying «N يوم» was first stored exactly N days earlier (2,629 ads); no exact date anywhere on the ad page (ad 3846 read live)')
on conflict (platform) do nothing;

create table if not exists public.ops_relative_age_event (
  id            bigint generated always as identity primary key,
  platform      text not null,
  source_table  text not null,
  listing_id    bigint not null,
  kind          text not null check (kind in ('flip', 'reset')),
  prev_text     text,
  new_text      text,
  read_at       timestamptz not null default now(),
  floor_before  timestamptz,
  ceiling_before timestamptz,
  floor_read    timestamptz,
  ceiling_read  timestamptz
);
create index if not exists ops_relative_age_event_recent on public.ops_relative_age_event (platform, kind, read_at desc);
comment on table public.ops_relative_age_event is
  'Every change of a listing''s «منذ …» text (flip) and every reading that contradicts the bracket already proved (reset), with the read time. The flips are the evidence for a site''s exact counting rule; the resets switch a site off.';
revoke all on table public.ops_relative_age_event from public, anon, authenticated;
grant select on table public.ops_relative_age_event to service_role;

create or replace function public.keep_tightest_posted_earliest()
 returns trigger
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_seen      timestamptz := least(coalesce(new.scraped_at, now()), now());   -- the ad existed when we first stored it
  v_floor     timestamptz := new.posted_earliest_at;
  v_ceil      timestamptz := new.posted_latest_at;
  v_old_floor timestamptz;
  v_old_ceil  timestamptz;
  v_prev      text;
  v_text      text := new.additional_info->>'added_ago_raw';
begin
  if tg_op = 'UPDATE' then
    v_old_floor := old.posted_earliest_at;
    v_old_ceil  := old.posted_latest_at;
    v_prev      := old.additional_info->>'added_ago_raw';
  end if;
  if coalesce(v_floor, v_old_floor) is null then
    return new;                                    -- no «منذ …» reading, ever: nothing to bracket
  end if;
  v_old_ceil := least(v_old_ceil, v_seen);
  if v_floor is not null
     and (v_floor > v_old_ceil + interval '1 hour'
          or (v_ceil is not null and v_old_floor is not null and v_ceil < v_old_floor - interval '1 hour')) then
    -- This reading contradicts what is already proved: the site restarted its count (a re-post), or the text is not
    -- the age. Never a posting date. Keep the proven bracket and log it — enough of these switch the site off.
    insert into public.ops_relative_age_event (platform, source_table, listing_id, kind, prev_text, new_text,
                                               floor_before, ceiling_before, floor_read, ceiling_read)
    values (split_part(tg_table_name, '_', 1), tg_table_name, new.id, 'reset', v_prev, v_text,
            v_old_floor, v_old_ceil, v_floor, v_ceil);
    new.posted_earliest_at := v_old_floor;
    new.posted_latest_at   := case when v_old_floor is not null then v_old_ceil end;
    return new;
  end if;
  -- Each reading proves a floor and a ceiling; keep the tightest of each. greatest/least ignore NULL, so a crawl
  -- that could not read the text never loosens anything.
  new.posted_earliest_at := greatest(v_old_floor, v_floor);
  new.posted_latest_at   := least(v_old_ceil, v_ceil, v_seen);
  if tg_op = 'UPDATE' and v_text is not null and v_prev is not null and v_text is distinct from v_prev then
    insert into public.ops_relative_age_event (platform, source_table, listing_id, kind, prev_text, new_text,
                                               floor_before, ceiling_before, floor_read, ceiling_read)
    values (split_part(tg_table_name, '_', 1), tg_table_name, new.id, 'flip', v_prev, v_text,
            v_old_floor, v_old_ceil, v_floor, v_ceil);
  end if;
  return new;
end $function$;
revoke all on function public.keep_tightest_posted_earliest() from public, anon, authenticated;

-- The search index serves a floor only for a site that is still enabled.
create or replace function public.sync_search_posted_at()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  rec record;
  recent int := 0;
  older int := 0;
  floored int := 0;
  n int;
  v_on boolean;
begin
  if not public.search_index_writer_lock() then return null; end if;
  for rec in
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name ~ '_(residential|commercial)_listings$'
      and c.column_name = 'date_added'
      and exists (select 1 from information_schema.columns c2
                   where c2.table_schema = 'public' and c2.table_name = c.table_name and c2.column_name = 'scraped_at')
      and not exists (select 1 from information_schema.columns c3
                       where c3.table_schema = 'public' and c3.table_name = c.table_name and c3.column_name = 'posted_earliest_at')
  loop
    execute format($f$
      update public.search_listings_ar s
         set posted_at = x.p
        from (select r.id, case when public.source_posted_at(r.date_added) <= now() + interval '1 day'
                                then public.source_posted_at(r.date_added) end as p
                from public.%1$I r
               where r.scraped_at > now() - interval '8 days') x
       where s.source_table = %1$L
         and s.listing_id = x.id
         and s.posted_at is distinct from x.p
    $f$, rec.table_name);
    get diagnostics n = row_count;
    recent := recent + n;
  end loop;
  for rec in
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name ~ '_(residential|commercial)_listings$'
      and c.column_name = 'date_added'
      and not exists (select 1 from information_schema.columns c3
                       where c3.table_schema = 'public' and c3.table_name = c.table_name and c3.column_name = 'posted_earliest_at')
  loop
    exit when older >= 25000;
    execute format($f$
      update public.search_listings_ar s
         set posted_at = public.source_posted_at(r.date_added)
        from public.%1$I r
       where s.source_table = %1$L
         and s.listing_id = r.id
         and s.posted_at is null
         and s.listing_id in (
               select s2.listing_id
                 from public.search_listings_ar s2
                 join public.%1$I r2 on r2.id = s2.listing_id
                where s2.source_table = %1$L
                  and s2.posted_at is null
                  and public.source_posted_at(r2.date_added) <= now() + interval '1 day'
                limit %2$s)
    $f$, rec.table_name, 25000 - older);
    get diagnostics n = row_count;
    older := older + n;
  end loop;
  -- Sites that print only «منذ …»: the site's real date first when it ever has one, else the floor — and the floor
  -- only while the site is enabled in ops_relative_age_site.
  for rec in
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name ~ '_(residential|commercial)_listings$'
      and c.column_name = 'posted_earliest_at'
  loop
    select coalesce(bool_and(g.enabled), false) into v_on
      from public.ops_relative_age_site g where g.platform = split_part(rec.table_name, '_', 1);
    execute format($f$
      update public.search_listings_ar s
         set posted_at = x.p
        from (select r.id, coalesce(
                       case when public.source_posted_at(r.date_added) <= now() + interval '1 day'
                            then public.source_posted_at(r.date_added) end,
                       case when %2$L::boolean and r.posted_earliest_at <= now() then r.posted_earliest_at end) as p
                from public.%1$I r) x
       where s.source_table = %1$L
         and s.listing_id = x.id
         and s.posted_at is distinct from x.p
    $f$, rec.table_name, v_on);
    get diagnostics n = row_count;
    floored := floored + n;
  end loop;
  return recent + older + floored;
end
$function$;

-- LIVE WATCH, extended: the bracket is never upside down or after the day we first stored the ad, the index serves
-- the floor only for an enabled site — and a site whose count keeps resetting is switched off here, by itself.
create or replace function public.mon_detect_relative_posting_floor_unsafe()
 returns integer
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  k constant text := 'relative_posting_floor_unsafe';
  reset_min  constant int     := 5;      -- resets in 7 days before a site is switched off …
  reset_pct  constant numeric := 1;      -- … and at least this % of its dated ads
  n int := 0; t text; plat text; live text[] := '{}';
  v_trig int; v_bad bigint; v_any bigint; v_seen bigint; v_unfilled bigint; v_index bigint; v_on boolean;
  v_resets bigint; v_dated bigint;
begin
  -- 1. a site whose «منذ …» count stopped being the real age is switched off (its floors stop serving)
  for plat in select platform from public.ops_relative_age_site where enabled order by 1
  loop
    select count(*) into v_resets from public.ops_relative_age_event
     where platform = plat and kind = 'reset' and read_at > now() - interval '7 days';
    v_dated := 0;
    for t in select c.table_name from information_schema.columns c
              where c.table_schema = 'public' and c.column_name = 'posted_earliest_at'
                and c.table_name ~ ('^' || plat || '_(residential|commercial)_listings$')
    loop
      execute format('select count(*) from public.%I where posted_earliest_at is not null', t) into n;
      v_dated := v_dated + n;
    end loop;
    n := 0;
    if v_resets >= reset_min and v_resets * 100 >= reset_pct * greatest(v_dated, 1) then
      update public.ops_relative_age_site
         set enabled = false, changed_at = now(),
             disabled_reason = format('switched off %s by mon_detect_relative_posting_floor_unsafe: %s resets in 7 days on %s dated ads — the count restarted, so it is not the real age. Re-prove it before enabling.', now()::date, v_resets, v_dated)
       where platform = plat;
    end if;
  end loop;
  for plat in select platform from public.ops_relative_age_site where not enabled order by 1
  loop
    n := n + public.mon_raise('P1', k, plat, k || ':' || plat || ':switched_off', jsonb_build_object(
      'platform', plat,
      'reason', (select disabled_reason from public.ops_relative_age_site where platform = plat),
      'rule', 'This site''s «منذ …» count restarted on re-posts, so its floors no longer serve «نُشر خلال». Re-prove the count against first-stored times before enabling; never widen anything to clear this.'));
    live := live || (k || ':' || plat || ':switched_off');
  end loop;

  -- 2. per table: guard attached, bracket sane, index in step, scraper still writing
  for t in
    select c.table_name from information_schema.columns c
     where c.table_schema = 'public' and c.column_name = 'posted_earliest_at'
       and c.table_name ~ '_(residential|commercial)_listings$'
     order by 1
  loop
    select coalesce(bool_and(g.enabled), false) into v_on
      from public.ops_relative_age_site g where g.platform = split_part(t, '_', 1);
    select count(*) into v_trig from pg_trigger
     where tgrelid = format('public.%I', t)::regclass
       and tgname = 'trg_keep_tightest_posted_earliest' and tgenabled <> 'D';
    execute format($q$
      select count(*) filter (where posted_earliest_at > scraped_at + interval '1 hour' or posted_earliest_at > now()
                                 or posted_latest_at > scraped_at + interval '1 hour'
                                 or posted_latest_at < posted_earliest_at - interval '1 hour'),
             count(*) filter (where posted_earliest_at is not null),
             count(*) filter (where active and last_seen_at > now() - interval '2 days' and additional_info ? 'added_ago_raw'),
             count(*) filter (where active and last_seen_at > now() - interval '2 days' and additional_info ? 'added_ago_raw'
                                and posted_earliest_at is null)
        from public.%I$q$, t)
      into v_bad, v_any, v_seen, v_unfilled;
    execute format($q$
      select count(*) from public.search_listings_ar s join public.%1$I r on r.id = s.listing_id
       where s.source_table = %1$L
         and r.last_seen_at < now() - interval '30 minutes'
         and s.posted_at is distinct from coalesce(
               case when public.source_posted_at(r.date_added) <= now() + interval '1 day'
                    then public.source_posted_at(r.date_added) end,
               case when %2$L::boolean and r.posted_earliest_at <= now() then r.posted_earliest_at end)$q$, t, v_on)
      into v_index;
    if v_trig = 0 or v_bad > 0 or v_index > 0 or (v_on and v_any > 0 and v_seen >= 20 and v_unfilled * 2 > v_seen) then
      n := n + public.mon_raise('P1', k, split_part(t, '_', 1), k || ':' || t, jsonb_build_object(
        'table', t,
        'guard_trigger_attached', v_trig > 0,
        'bracket_impossible', v_bad,
        'search_index_disagrees', v_index,
        'seen_2d_with_ago_text', v_seen,
        'seen_2d_without_floor', v_unfilled,
        'rule', 'A «منذ …» floor may never make an ad look newer than it is (owner 2026-11-11). Fix the reader or the sync; never widen the window or drop the floor.'));
      live := live || (k || ':' || t);
    end if;
  end loop;
  perform public.mon_resolve_stale_keys(k, live);
  return n;
end $function$;
revoke all on function public.mon_detect_relative_posting_floor_unsafe() from public, anon, authenticated;
grant execute on function public.mon_detect_relative_posting_floor_unsafe() to service_role;

-- PROOF at apply, every write rolled back: the ceiling tightens to first-stored; a flip is logged; a reset is logged
-- and changes nothing; five resets switch the site off and the next sweep raises it.
do $$
declare v_id bigint; v_seen timestamptz; v_f timestamptz; v_c timestamptz; v_i int;
begin
  begin
    select id, scraped_at into v_id, v_seen from public.ialqarawi_residential_listings
     where scraped_at < now() - interval '30 days' and additional_info ? 'added_ago_raw' order by id limit 1;
    if v_id is null then raise exception 'PROOF: no ialqarawi row to test on'; end if;
    update public.ialqarawi_residential_listings
       set posted_earliest_at = now() - interval '800 days', posted_latest_at = now() - interval '10 days'
     where id = v_id;
    select posted_earliest_at, posted_latest_at into v_f, v_c from public.ialqarawi_residential_listings where id = v_id;
    if v_c > v_seen then raise exception 'PROOF: the ceiling was not tightened to first-stored (% > %)', v_c, v_seen; end if;
    update public.ialqarawi_residential_listings
       set additional_info = jsonb_set(additional_info, '{added_ago_raw}', '"__proof_flip__"'),
           posted_earliest_at = now() - interval '700 days', posted_latest_at = now() - interval '400 days'
     where id = v_id;
    if not exists (select 1 from public.ops_relative_age_event where listing_id = v_id and kind = 'flip' and new_text = '__proof_flip__') then
      raise exception 'PROOF: a flip was not logged';
    end if;
    select posted_earliest_at, posted_latest_at into v_f, v_c from public.ialqarawi_residential_listings where id = v_id;
    if v_f < now() - interval '701 days' or v_c > now() - interval '399 days' then
      raise exception 'PROOF: the bracket did not narrow to the tighter reading (% / %)', v_f, v_c;
    end if;
    for v_i in 1..5 loop
      update public.ialqarawi_residential_listings
         set posted_earliest_at = now() - interval '2 days', posted_latest_at = now() - interval '1 day'
       where id = v_id;
    end loop;
    select posted_earliest_at into v_f from public.ialqarawi_residential_listings where id = v_id;
    if v_f > now() - interval '699 days' then raise exception 'PROOF: a reset changed the floor (%)', v_f; end if;
    if (select count(*) from public.ops_relative_age_event where listing_id = v_id and kind = 'reset') < 5 then
      raise exception 'PROOF: resets were not logged';
    end if;
    perform public.mon_detect_relative_posting_floor_unsafe();
    if (select enabled from public.ops_relative_age_site where platform = 'ialqarawi') then
      raise exception 'PROOF: five resets did not switch ialqarawi off';
    end if;
    if not exists (select 1 from public.alert_event where kind = 'relative_posting_floor_unsafe' and resolved_at is null
                    and dedup_key = 'relative_posting_floor_unsafe:ialqarawi:switched_off') then
      raise exception 'PROOF: a switched-off site was not raised';
    end if;
    raise exception '__bracket_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__bracket_selftest_rollback__' then raise; end if;
  end;
  if not (select enabled from public.ops_relative_age_site where platform = 'ialqarawi') then
    raise exception 'PROOF: the rollback left ialqarawi switched off';
  end if;
  if exists (select 1 from public.ops_relative_age_event) then
    raise exception 'PROOF: proof events survived the rollback';
  end if;
  perform public.mon_detect_relative_posting_floor_unsafe();
  raise notice 'PROOF: ceiling tightened to first-stored, flip logged, resets logged and ignored, five resets switch a site off and raise it — all rolled back.';
end $$;
