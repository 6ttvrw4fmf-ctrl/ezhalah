-- A POSTING DATE WE CANNOT TRUST NEVER MAKES A FACT (owner 2026-10-27: «make sure we make a strong guard so we never get a
-- wrong fact»). Every time-window fact («أمس», «خلال آخر 7 أيام», «خلال آخر 30 يوم») counts an ad by the date its SITE says
-- it was posted (`date_added` via source_posted_at). The builder, its independent recount and the Filter check all trust
-- that field, so a site (or our scraper for it) that starts filling it with the wrong kind of date would pass all three.
-- Two facts no true posting date can break, checked per listing table on every build over the same rows the builder
-- reads (scraped in the last 62 days, with a readable date):
--   1. it is never LATER than the day we first saw the ad (scraped_at is set once, at insert): later by more than a day
--      means the field is a «last refreshed» date, so bumped old ads would read as new;
--   2. it is not simply OUR scrape time: most dates within 15 minutes of scraped_at means the scraper stamps its own clock;
--   (3. and it is not in the future.)
-- A table that fails is DISTRUSTED for that build: the builder and the recount both leave its ads out of every dated
-- window (they fall in no window, the same as an undated site — facts can only get smaller, never wrong), and
-- mon_detect_welcome_posting_date_untrusted raises a P1 naming it. Measured when added: 19 dated tables, 0 distrusted.

create table if not exists public.welcome_posting_date_check (
  day date not null,
  source_table text not null,
  dated int not null,
  after_first_seen int not null,
  eq_scrape int not null,
  future int not null,
  distrusted boolean not null,
  checked_at timestamptz not null default now(),
  primary key (day, source_table)
);
alter table public.welcome_posting_date_check enable row level security;
revoke all on public.welcome_posting_date_check from anon, authenticated;

-- The verdict, alone so it can be proven: at least 10 dated ads, and ≥5% later than first seen, or ≥50% equal to our
-- scrape time, or ≥5% in the future.
create or replace function public.welcome_posting_date_verdict(p_dated int, p_after int, p_eq int, p_future int)
 returns boolean language sql immutable as $$
  select coalesce(p_dated, 0) >= 10
     and (coalesce(p_after, 0) * 20 >= p_dated or coalesce(p_eq, 0) * 2 >= p_dated or coalesce(p_future, 0) * 20 >= p_dated)
$$;

create or replace function public.welcome_posting_date_check_run(p_day date)
 returns int language plpgsql security definer set search_path to 'public' as $$
declare v_tbl text; r text[]; bad int := 0;
begin
  delete from public.welcome_posting_date_check where day = p_day or day < p_day - 14;
  for v_tbl in
    select c.table_name from information_schema.columns c
     where c.table_schema = 'public' and c.column_name = 'date_added' and c.table_name like '%\_listings'
       and exists (select 1 from information_schema.columns c2 where c2.table_schema = 'public' and c2.table_name = c.table_name and c2.column_name = 'scraped_at')
  loop
    begin
      execute format($q$select array[count(*)::text,
                         count(*) filter (where p > scraped_at + interval '1 day')::text,
                         count(*) filter (where abs(extract(epoch from p - scraped_at)) < 900)::text,
                         count(*) filter (where p > now() + interval '1 hour')::text]
                    from (select public.source_posted_at(date_added) p, scraped_at from public.%I
                           where scraped_at >= now() - interval '62 days' and date_added is not null) z
                   where p is not null$q$, v_tbl) into r;
    exception when others then continue;  -- a table we cannot read is not used for windows anyway (no posted rows)
    end;
    if r[1]::int > 0 then
      insert into public.welcome_posting_date_check(day, source_table, dated, after_first_seen, eq_scrape, future, distrusted)
      values (p_day, v_tbl, r[1]::int, r[2]::int, r[3]::int, r[4]::int,
              public.welcome_posting_date_verdict(r[1]::int, r[2]::int, r[3]::int, r[4]::int));
      if public.welcome_posting_date_verdict(r[1]::int, r[2]::int, r[3]::int, r[4]::int) then bad := bad + 1; end if;
    end if;
  end loop;
  return bad;
end $$;
revoke all on function public.welcome_posting_date_check_run(date) from public, anon, authenticated;

-- The builder runs the check first and reads no posting dates from a distrusted table; the recount skips the same tables.
do $patch$
declare d text; k int;
  b_old text := $a$  for v_tbl in select distinct source_table from w_b where first_seen_at >= now() - interval '61 days' loop$a$;
  b_new text := $a$  perform public.welcome_posting_date_check_run(d);
  for v_tbl in select distinct source_table from w_b where first_seen_at >= now() - interval '61 days'
                 and source_table not in (select c.source_table from public.welcome_posting_date_check c where c.day = d and c.distrusted) loop$a$;
  a_old text := $a$  for v_tbl in select distinct s.source_table from public.search_listings_ar s where s.first_seen_at >= t0 - interval '61 days' loop$a$;
  a_new text := $a$  for v_tbl in select distinct s.source_table from public.search_listings_ar s where s.first_seen_at >= t0 - interval '61 days'
                 and s.source_table not in (select c.source_table from public.welcome_posting_date_check c where c.day = d and c.distrusted) loop$a$;
begin
  d := pg_get_functiondef('public.build_welcome_insights'::regproc);
  if position('welcome_posting_date_check_run' in d) = 0 then
    k := (length(d) - length(replace(d, b_old, ''))) / length(b_old);
    if k <> 1 then raise exception 'builder anchor found % times, want 1', k; end if;
    execute replace(d, b_old, b_new);
  end if;
  d := pg_get_functiondef('public.audit_welcome_insights'::regproc);
  if position('welcome_posting_date_check c' in d) = 0 then
    k := (length(d) - length(replace(d, a_old, ''))) / length(a_old);
    if k <> 1 then raise exception 'audit anchor found % times, want 1', k; end if;
    execute replace(d, a_old, a_new);
  end if;
end $patch$;

create or replace function public.mon_detect_welcome_posting_date_untrusted()
 returns integer language plpgsql security definer set search_path to 'public' as $$
declare n int := 0; live text[] := '{}'; last_day date; r record;
begin
  select max(day) into last_day from public.welcome_insight_build;
  if last_day is not null and not exists (select 1 from public.welcome_posting_date_check where day = last_day)
     and (select max(built_at) from public.welcome_insight_build) < now() - interval '10 minutes' then
    live := live || 'welcome_posting_date_untrusted:not_run'::text;
    n := n + public.mon_raise('P2', 'welcome_posting_date_untrusted', 'fleet', 'welcome_posting_date_untrusted:not_run',
      jsonb_build_object('built_day', last_day,
        'why', 'The posting-date check did not run with the last facts build, so a wrong kind of date could have reached a fact.',
        'action', 'Check build_welcome_insights calls welcome_posting_date_check_run, then rebuild.'));
  end if;
  for r in select * from public.welcome_posting_date_check where day = last_day and distrusted loop
    live := live || ('welcome_posting_date_untrusted:' || r.source_table);
    n := n + public.mon_raise('P1', 'welcome_posting_date_untrusted', r.source_table, 'welcome_posting_date_untrusted:' || r.source_table,
      jsonb_build_object('dated', r.dated, 'later_than_first_seen', r.after_first_seen, 'equal_to_scrape_time', r.eq_scrape, 'future', r.future,
        'why', 'This site''s «posting date» is not a real posting date (later than when we first saw the ad, our own scrape time, or in the future). Its ads are left out of every dated fact until fixed.',
        'action', 'Check what the scraper stores in date_added for this site against the live site; fix the scraper, never the guard.'));
  end loop;
  perform public.mon_resolve_stale_keys('welcome_posting_date_untrusted', live);
  return n;
end $$;

-- Roster: right before the welcome audit detector.
do $roster$
declare d text; anchor text := '''mon_detect_welcome_insights_audit'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_welcome_posting_date_untrusted''' in d) = 0 then
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    execute replace(d, anchor, '''mon_detect_welcome_posting_date_untrusted'', ' || anchor);
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_welcome_posting_date_untrusted''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end $roster$;

-- Apply-time proof.
do $chk$
declare bad int; today date := (now() at time zone 'Asia/Riyadh')::date;
begin
  -- the verdict, both directions
  if public.welcome_posting_date_verdict(100, 0, 0, 0) or public.welcome_posting_date_verdict(9, 9, 9, 9)
     or public.welcome_posting_date_verdict(219, 1, 0, 0) or public.welcome_posting_date_verdict(1178, 0, 2, 0) then
    raise exception 'posting-date guard: an honest site would be distrusted';
  end if;
  if not public.welcome_posting_date_verdict(100, 5, 0, 0) or not public.welcome_posting_date_verdict(100, 0, 50, 0)
     or not public.welcome_posting_date_verdict(100, 0, 0, 5) then
    raise exception 'posting-date guard: a bad date would pass';
  end if;
  -- the check runs on today's data, and nobody is distrusted today (measured 2026-10-28)
  bad := public.welcome_posting_date_check_run(today);
  if not exists (select 1 from public.welcome_posting_date_check where day = today) then raise exception 'posting-date guard: check wrote nothing'; end if;
  if bad <> 0 then raise exception 'posting-date guard: % table(s) distrusted at apply — investigate before shipping', bad; end if;
  -- both readers skip distrusted tables
  if position('welcome_posting_date_check_run(d)' in pg_get_functiondef('public.build_welcome_insights'::regproc)) = 0
     or position('c.day = d and c.distrusted' in pg_get_functiondef('public.build_welcome_insights'::regproc)) = 0
     or position('c.day = d and c.distrusted' in pg_get_functiondef('public.audit_welcome_insights'::regproc)) = 0 then
    raise exception 'posting-date guard: the builder or the recount does not skip distrusted tables';
  end if;
  perform public.mon_detect_welcome_posting_date_untrusted();
end $chk$;
