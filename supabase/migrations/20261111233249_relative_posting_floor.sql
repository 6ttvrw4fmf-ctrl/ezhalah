-- «منذ 23 يوم» → A FLOOR ON THE POSTING DAY, FOR THE «نُشر خلال» WINDOW (owner 2026-11-11: «if it says last month …
-- we need to calculate it correctly … do whatever guard to make the dates accurate»).
--
-- ialqarawi prints only how long ago an ad was added («مضاف منذ 23 يوم», «7 شهر», «1 سنة»), never the day, so its
-- 2,629 ads had no posting date and sat outside every «نُشر خلال» window. Measured before this change: every ad
-- saying «N يوم» was first stored by us exactly N days earlier, so the count is the real age, not a re-post bump.
--
-- The scraper (scrapers/common/posting_date.py posted_no_earlier_than) turns the count into a FLOOR — «posted no
-- earlier than» — and writes it to the new column posted_earliest_at. It never goes into date_added: the card prints
-- that as a day and the welcome facts count it as one. This migration:
--   1. adds posted_earliest_at to the two ialqarawi tables;
--   2. keeps the TIGHTEST floor ever read (a later, coarser «1 شهر» never loosens an earlier «23 يوم»), and refuses a
--      floor later than the day we first stored the ad — that can only be a site restarting its count;
--   3. feeds the search index: posted_at = the site's real date when there is one, else the floor. The window filter
--      (posted_at >= now() − N days) is unchanged, so an ad counts only when even its oldest possible day fits;
--   4. watches it live every sweep: mon_detect_relative_posting_floor_unsafe().
-- Offline guard: scripts/verify-relative-posting-date-is-a-floor.ts (executes the real reader and mapper).

-- Never queue behind the hourly search sync (it holds these tables for minutes): a waiting ALTER would block every
-- reader behind it. Fail fast and re-apply when the sync is done.
set local lock_timeout = '3s';

alter table public.ialqarawi_residential_listings add column if not exists posted_earliest_at timestamptz;
alter table public.ialqarawi_commercial_listings  add column if not exists posted_earliest_at timestamptz;
comment on column public.ialqarawi_residential_listings.posted_earliest_at is
  'The site prints only «منذ N …»: the EARLIEST instant the ad can have been posted (a floor, never a date — date_added stays NULL). Tightest reading kept by trg_keep_tightest_posted_earliest; read by sync_search_posted_at() for the «نُشر خلال» window.';
comment on column public.ialqarawi_commercial_listings.posted_earliest_at is
  'The site prints only «منذ N …»: the EARLIEST instant the ad can have been posted (a floor, never a date — date_added stays NULL). Tightest reading kept by trg_keep_tightest_posted_earliest; read by sync_search_posted_at() for the «نُشر خلال» window.';

create or replace function public.keep_tightest_posted_earliest()
 returns trigger
 language plpgsql
 set search_path = public
as $function$
begin
  if new.posted_earliest_at is not null
     and new.posted_earliest_at > least(coalesce(new.scraped_at, now()), now()) + interval '1 hour' then
    -- «posted no earlier than X» with X after the day we first stored the ad cannot be true: the site restarted
    -- its count (a re-post). Never a posting date — keep what we had.
    new.posted_earliest_at := case when tg_op = 'UPDATE' then old.posted_earliest_at end;
  elsif tg_op = 'UPDATE' then
    -- Each reading proves a floor; the latest floor is the tightest true one. greatest() ignores NULL, so a crawl
    -- that could not read the text never erases a floor.
    new.posted_earliest_at := greatest(old.posted_earliest_at, new.posted_earliest_at);
  end if;
  return new;
end $function$;
revoke all on function public.keep_tightest_posted_earliest() from public, anon, authenticated;

drop trigger if exists trg_keep_tightest_posted_earliest on public.ialqarawi_residential_listings;
create trigger trg_keep_tightest_posted_earliest before insert or update on public.ialqarawi_residential_listings
  for each row execute function public.keep_tightest_posted_earliest();
drop trigger if exists trg_keep_tightest_posted_earliest on public.ialqarawi_commercial_listings;
create trigger trg_keep_tightest_posted_earliest before insert or update on public.ialqarawi_commercial_listings
  for each row execute function public.keep_tightest_posted_earliest();

-- The search index's posted_at. Unchanged for every table without posted_earliest_at; a table WITH it is refreshed
-- whole every run (ialqarawi: ~2,600 rows) because its floor tightens as new readings arrive.
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
  -- Sites that print only «منذ …»: the site's real date first when it ever has one, else the floor.
  for rec in
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name ~ '_(residential|commercial)_listings$'
      and c.column_name = 'posted_earliest_at'
  loop
    execute format($f$
      update public.search_listings_ar s
         set posted_at = x.p
        from (select r.id, coalesce(
                       case when public.source_posted_at(r.date_added) <= now() + interval '1 day'
                            then public.source_posted_at(r.date_added) end,
                       case when r.posted_earliest_at <= now() then r.posted_earliest_at end) as p
                from public.%1$I r) x
       where s.source_table = %1$L
         and s.listing_id = x.id
         and s.posted_at is distinct from x.p
    $f$, rec.table_name);
    get diagnostics n = row_count;
    floored := floored + n;
  end loop;
  return recent + older + floored;
end
$function$;

-- LIVE WATCH. Every sweep, for each table that carries posted_earliest_at: the guard trigger is attached; no floor
-- is after the day we first stored the ad or in the future; the search index carries exactly the site date, else
-- the floor; and once the scraper has written floors, ads seen in the last 2 days with «منذ …» text carry one.
create or replace function public.mon_detect_relative_posting_floor_unsafe()
 returns integer
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  k constant text := 'relative_posting_floor_unsafe';
  n int := 0; t text; live text[] := '{}';
  v_trig int; v_bad bigint; v_any bigint; v_seen bigint; v_unfilled bigint; v_index bigint;
begin
  for t in
    select c.table_name from information_schema.columns c
     where c.table_schema = 'public' and c.column_name = 'posted_earliest_at'
       and c.table_name ~ '_(residential|commercial)_listings$'
     order by 1
  loop
    select count(*) into v_trig from pg_trigger
     where tgrelid = format('public.%I', t)::regclass
       and tgname = 'trg_keep_tightest_posted_earliest' and tgenabled <> 'D';
    execute format($q$
      select count(*) filter (where posted_earliest_at > scraped_at + interval '1 hour' or posted_earliest_at > now()),
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
               case when r.posted_earliest_at <= now() then r.posted_earliest_at end)$q$, t)
      into v_index;
    if v_trig = 0 or v_bad > 0 or v_index > 0 or (v_any > 0 and v_seen >= 20 and v_unfilled * 2 > v_seen) then
      n := n + public.mon_raise('P1', k, split_part(t, '_', 1), k || ':' || t, jsonb_build_object(
        'table', t,
        'guard_trigger_attached', v_trig > 0,
        'floor_after_first_stored_or_future', v_bad,
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

-- Roster: needle-inserted into the LIVE definition (a full copy would clobber a peer's entry).
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_relative_posting_floor_unsafe' in src) > 0 then
    raise notice 'mon_detect_relative_posting_floor_unsafe already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_source_posting_date_fill_regressed'',',
    E'    ''mon_detect_source_posting_date_fill_regressed'',\n    ''mon_detect_relative_posting_floor_unsafe'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- Lane: a scraper reading the site's «منذ …» count is the Scraping Engineer's.
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.ops_engineer_for_alert(text,text)'::regprocedure);
  if position('relative_posting_floor_unsafe' in src) > 0 then
    raise notice 'ops_engineer_for_alert already routes relative_posting_floor_unsafe';
    return;
  end if;
  out_def := replace(src,
    $n$when p_kind ~ '^(source_posting_date_fill_regressed|$n$,
    $n$when p_kind ~ '^(relative_posting_floor_unsafe|source_posting_date_fill_regressed|$n$);
  if out_def = src then
    raise exception 'ops_engineer_for_alert anchor not found — refusing to guess';
  end if;
  execute out_def;
end $$;

-- PROOF at apply, every write rolled back: a looser floor never replaces a tighter one; a floor after the day we
-- first stored the ad is refused; a planted search-index disagreement is caught; routed; on the roster.
do $$
declare v_id bigint; v_floor timestamptz; v_hit int;
begin
  if (select count(*) from pg_trigger where tgname = 'trg_keep_tightest_posted_earliest' and tgenabled <> 'D'
        and tgrelid in ('public.ialqarawi_residential_listings'::regclass, 'public.ialqarawi_commercial_listings'::regclass)) <> 2 then
    raise exception 'PROOF: the guard trigger is not on both ialqarawi tables';
  end if;
  begin
    select id into v_id from public.ialqarawi_residential_listings
     where scraped_at < now() - interval '3 days' order by id limit 1;
    if v_id is null then raise exception 'PROOF: no ialqarawi row older than 3 days to test on'; end if;
    update public.ialqarawi_residential_listings set posted_earliest_at = now() - interval '400 days' where id = v_id;
    update public.ialqarawi_residential_listings set posted_earliest_at = now() - interval '500 days' where id = v_id;
    select posted_earliest_at into v_floor from public.ialqarawi_residential_listings where id = v_id;
    if v_floor < now() - interval '401 days' then
      raise exception 'PROOF: a looser floor replaced a tighter one (%)', v_floor;
    end if;
    update public.ialqarawi_residential_listings set posted_earliest_at = now() - interval '1 day' where id = v_id;
    select posted_earliest_at into v_floor from public.ialqarawi_residential_listings where id = v_id;
    if v_floor > now() - interval '399 days' then
      raise exception 'PROOF: a floor after the day we first stored the ad was accepted (%)', v_floor;
    end if;
    update public.search_listings_ar set posted_at = now()
     where source_table = 'ialqarawi_residential_listings' and listing_id = v_id;
    if not found then raise exception 'PROOF: test row is not in the search index'; end if;
    perform public.mon_detect_relative_posting_floor_unsafe();
    if not exists (select 1 from public.alert_event
                    where kind = 'relative_posting_floor_unsafe' and resolved_at is null
                      and (detail->>'search_index_disagrees')::bigint > 0) then
      raise exception 'PROOF: a search row newer than its floor was not caught';
    end if;
    raise exception '__floor_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__floor_selftest_rollback__' then raise; end if;
  end;
  if public.ops_engineer_for_alert('relative_posting_floor_unsafe', null) <> 'scraping-engineer' then
    raise exception 'PROOF: relative_posting_floor_unsafe is not routed to the scraping lane';
  end if;
  if position('mon_detect_relative_posting_floor_unsafe'
              in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'PROOF: the detector is not on the roster';
  end if;
  -- The search index is filled by the 10-minute sync_search_posted_at() cron, not here: a full sync inside the
  -- migration outlives the statement timeout.
  perform public.mon_detect_relative_posting_floor_unsafe();
  select count(*) into v_hit from public.alert_event where kind = 'relative_posting_floor_unsafe' and resolved_at is null;
  raise notice 'PROOF: tighter floor kept, re-post floor refused, planted index disagreement caught and rolled back, routed, on the roster. Open alerts of this kind now: %', v_hit;
end $$;
