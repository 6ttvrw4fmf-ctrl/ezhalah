-- EVERY DATED WELCOME FACT COUNTS BY THE SITE'S OWN POSTING DATE, NEVER OURS (owner 2026-11-10: «it must strictly check
-- dates and no duplicates, those rules must be in guard … must must must»). Since 20261026122758 the builder
-- (build_welcome_insights) and its independent recount (audit_welcome_insights) replace first_seen_at with the site's
-- posting date for every ad first seen in the last 61 days (the widest window is 60), and an ad with no readable or a
-- future date becomes '-infinity' — in NO window. Nothing watched that rule in the LIVE functions: both are patched by
-- text replace, so a later patch could quietly fall back to our own date (coalesce(posted, first_seen_at)) and every
-- «آخر 30 يوم» / «آخر 7 أيام» / «أمس» fact would count the day WE found an ad as the day it was posted.
-- Duplicates already have four guards (mon_detect_welcome_facts_all_sites_once and the licence / repost / pack checks).
-- This P1 detector re-reads the live builder, recount and welcome_month on every sweep. Guard:
-- scripts/verify-welcome-windows-use-site-date-only.ts.
create or replace function public.mon_detect_welcome_windows_use_site_date()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int := 0; live text[] := '{}'; b text; a text; m text; bad text[] := '{}';
begin
  b := pg_get_functiondef('public.build_welcome_insights'::regproc);
  a := pg_get_functiondef('public.audit_welcome_insights'::regproc);
  m := pg_get_functiondef('public.welcome_month'::regproc);
  -- 1. the builder swaps in the site's date, an undated or future-dated ad goes to no window, over the whole 60-day reach
  if b !~ 'update w_b b set first_seen_at = coalesce\(\(select p\.posted_at from w_posted p'
     or b !~ 'p\.posted_at <= now\(\) limit 1\), ''-infinity''::timestamptz\)'
     or b !~ 'where b\.first_seen_at >= now\(\) - interval ''61 days'''
     or position('public.source_posted_at(t.date_added)' in b) = 0 then
    bad := bad || 'builder: dated windows do not strictly use the site''s posting date'::text;
  end if;
  if b ~ 'coalesce\(\(select p\.posted_at from w_posted p[^;]*\),\s*b\.first_seen_at' then
    bad := bad || 'builder: falls back to our own first-seen date'::text;
  end if;
  -- 2. the recount does the same, independently
  if (length(a) - length(replace(a, 'coalesce(ap.posted_at, ''-infinity''::timestamptz)', ''))) / length('coalesce(ap.posted_at, ''-infinity''::timestamptz)') < 2
     or position('when s.first_seen_at >= t0 - interval ''61 days'' then coalesce(ap.posted_at' in a) = 0
     or position('public.source_posted_at(t.date_added)' in a) = 0 then
    bad := bad || 'recount: dated windows do not strictly use the site''s posting date'::text;
  end if;
  if a ~ 'coalesce\(ap\.posted_at,\s*s\.(first_seen_at|scraped_at|last_seen_at)' then
    bad := bad || 'recount: falls back to our own date'::text;
  end if;
  -- 3. the 30-day windows read only that swapped date
  if position('first_seen_at >= %6$L::timestamptz - interval ''30 days''' in m) = 0
     or m ~* '(scraped_at|last_seen_at|created_at)' then
    bad := bad || 'welcome_month: windows do not read the site''s posting date'::text;
  end if;
  if cardinality(bad) > 0 then
    live := live || 'welcome_windows_use_site_date:fleet'::text;
    n := n + public.mon_raise('P1', 'welcome_windows_use_site_date', 'fleet', 'welcome_windows_use_site_date:fleet',
      jsonb_build_object('problems', to_jsonb(bad),
        'why', 'Every dated welcome fact counts by the site''s own posting date; an ad with no site date is in no window (owner 2026-11-10).',
        'action', 'Restore the w_posted / a_posted swap with ''-infinity'' in build_welcome_insights and audit_welcome_insights; never fall back to our own date.'));
  end if;
  perform public.mon_resolve_stale_keys('welcome_windows_use_site_date', live);
  return n;
end $function$;
revoke all on function public.mon_detect_welcome_windows_use_site_date() from public, anon, authenticated;

do $roster$
declare d text; anchor text := '''mon_detect_welcome_facts_all_sites_once'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_welcome_windows_use_site_date''' in d) = 0 then
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    execute replace(d, anchor, '''mon_detect_welcome_windows_use_site_date'', ' || anchor);
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_welcome_windows_use_site_date''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end $roster$;

-- Apply-time proof: the live functions pass, and the predicate catches a fallback to our own date.
do $chk$
declare r int; b text;
begin
  r := public.mon_detect_welcome_windows_use_site_date();
  if exists (select 1 from public.alert_event where dedup_key = 'welcome_windows_use_site_date:fleet' and resolved_at is null) then
    raise exception 'the live builder / recount already break the site-date rule';
  end if;
  b := replace(pg_get_functiondef('public.build_welcome_insights'::regproc), '''-infinity''::timestamptz)', 'b.first_seen_at)');
  if b ~ 'p\.posted_at <= now\(\) limit 1\), ''-infinity''::timestamptz\)' then
    raise exception 'the fallback mutation did not change the builder text';
  end if;
end $chk$;
