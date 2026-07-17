-- ─────────────────────────────────────────────────────────────────────────────────────────
-- LIFECYCLE SAFETY — three confirmed lifecycle fixes (SQL side).
-- STAGED 2026-07-17 on branch fix/lifecycle-sql. NOT applied to prod from this branch.
-- Rehearsed end-to-end in BEGIN..ROLLBACK against live prod 2026-07-17 (rehearsal table at
-- the bottom; prod verified unchanged afterwards — function md5s + row counts identical).
--
-- Separate from supabase/migrations/20260717_purge_hardening.sql (purge_inactive_listings
-- hardening, staged concurrently on another branch). This file deliberately does NOT touch
-- purge_inactive_listings / purge_preview.
--
-- ══ FIX B3 — DROP public.reactivate_suspect_inactive() (unscheduled resurrection footgun) ══
--
-- The function sat in prod with NO scheduled caller (cron.job checked 2026-07-17: zero jobs
-- reference it; jobid 30 runs the different, guarded auto_recover_false_inactive()) and NO
-- repo reference (grep over *.sql/*.ts/*.py/*.sh/*.md: zero hits). Worse, its ACL granted
-- EXECUTE to anon + authenticated, so ONE PostgREST RPC call with the public anon key —
-- POST /rest/v1/rpc/reactivate_suspect_inactive — would have run it as SECURITY DEFINER.
--
-- One call resurrects every active=false row with missing_count < 3 across all platforms
-- except deal_/muktamel_ (live 2026-07-17: ~3,438 rows, incl. gathern 2,245 location-
-- quarantined, dealapp 907+5 legacy sold, toor 24 retired) AND FAKES last_seen_at = now(),
-- which also shields the resurrected rows from mark_stale_listings_inactive for another
-- stale_days window. Sold/retired listings back in search + forged freshness = P0 footgun.
--
-- Archived body (verbatim pg_get_functiondef, live prod 2026-07-17, md5
-- 83142f835fb0dd095194290b0d353145) for the record:
--
--   CREATE OR REPLACE FUNCTION public.reactivate_suspect_inactive()
--    RETURNS TABLE(tbl text, reactivated integer)
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO 'public'
--   AS $function$
--   declare t text; n int;
--   begin
--     for t in
--       select tablename from pg_tables
--       where schemaname='public' and tablename ~ '_(residential|commercial)_listings$'
--         and tablename not like 'deal\_%' and tablename not like 'muktamel\_%'
--     loop
--       execute format($f$
--         update public.%I
--            set active = true, missing_count = 0, last_seen_at = now()
--          where active = false
--            and coalesce(missing_count,0) < 3
--            and not ( coalesce(price_total,0)     > 1000000000
--                   or coalesce(price_per_meter,0) > 300000
--                   or coalesce(price_annual,0)    > 100000000 )
--       $f$, t);
--       get diagnostics n = row_count;
--       if n > 0 then tbl := t; reactivated := n; return next; end if;
--     end loop;
--   end $function$
--
-- ══ FIX B4 — pin the legacy sold rows missing_count 0 → 3 (backup-first) ══
--
-- PR#92 fixed the resurrection loop going FORWARD (scrapers now pin source-confirmed sold
-- rows to active=false + missing_count=3 post-upsert — see _pin_sold_inactive in
-- scrapers/dealapp/run.py). The PRE-#92 population was never repaired: rows sitting at
-- active=false AND missing_count=0 remain one recovery-tweak away from resurrection (the
-- nightly auto_recover_false_inactive() at 05:20 UTC targets exactly
-- coalesce(missing_count,0)=0 — only a stale last_seen_at protects them today, and B3's
-- function would have forged that too).
--
-- Live counts re-verified 2026-07-17 (active=false AND coalesce(missing_count,0)=0):
--   dealapp_residential_listings    907   (deactivated_at 2026-07-10 .. 2026-07-16)
--   dealapp_commercial_listings       5   (deactivated_at 2026-07-10)
--   aqaratikom_commercial_listings    3   (deactivated_at 2026-07-10)
--   TOTAL PINNED                    915
--
-- DELIBERATELY NOT TOUCHED: gathern_residential_listings' active=false/mc=0 rows (2,173 at
-- rehearsal time; ~2,245 the day before — the class churns with the live scraper). That is
-- the location-quarantined class (different semantics — hidden for unresolved location, not
-- sold on source); its retention policy is an open owner decision. Also not
-- touched: every other platform's small mc<3 residue (sanadak 77+25, aqar 64, wasalt 47,
-- toor 24, aqarmonthly 22, muktamel 20, …) — those are not the confirmed legacy-sold class.
--
-- Semantics of the pin: identical to #92's _pin_sold_inactive — missing_count=3 (the prune
-- 3-strike threshold), active stays false, last_seen_at/deactivated_at untouched. If a
-- pinned listing is ever relisted on source, the scraper's own upsert carries active=true +
-- missing_count=0 and legitimately revives it; the pin only blocks blind bulk recovery.
-- Backup-first per the permanent price-repair standard: full prior state snapshotted to
-- ops_legacy_pin_backup_20260717; the DO block hard-fails unless
-- scope count == backup count == updated count for every table.
--
-- ══ FIX B5 — mark_stale_listings_inactive(): bounded escape from breaker limbo ══
--
-- Live counterexample of the collapse-guard freeze (2026-07-17): dealapp_commercial_listings
-- has 219 active rows, 96 of them last_seen_at > 7 days old. 96 > 30% of 219, so the daily
-- circuit breaker (jobid 13, 04:00 UTC, mark_stale_listings_inactive(7)) skips the table
-- EVERY day; the prune path's 0.80 coverage floor blocks too. Nothing bounds those 96 rows —
-- the dealapp scraper is alive (ok=true runs in scrape_runs within 48h) but structurally
-- can't see them, so they never age out and never will.
--
-- BOUNDED ESCAPE added inside the existing function (same signature, cron line unchanged):
-- when a table has exceeded the breaker for >= 3 consecutive daily runs AND its platform
-- had >= 1 ok=true scrape run in the last 48h (scraper demonstrably alive), flip at most 25
-- OLDEST-stale rows per day to active=false + missing_count=3 (so auto_recover can't undo
-- it), log via the function's existing bookkeeping (RAISE NOTICE + the returned total) and
-- the new mon_stale_breaker_state row. The escape NEVER runs when the scraper is dead —
-- that is the wipe-protection case the breaker exists for. Consecutive-breaker-days are
-- counted at most once per calendar day, and at most one 25-row escape fires per table per
-- calendar day (manual re-runs cannot double-flip).
--
-- Everything else in the function body is verbatim the live prod definition
-- (md5 b8f2c7a5d4d6c74a3f2f8b6c73c014e7 before this migration).
--
-- Also revoked here: PUBLIC/anon/authenticated EXECUTE on the redefined function. It was
-- anon-callable via PostgREST RPC (same exposure class as B3); the only legitimate caller
-- is pg_cron (jobid 13) running as the function owner. service_role keeps EXECUTE.
--
-- ROLLBACK PLAN
--   B3: recreate the function from the archived body above (do not — it is the footgun).
--   B4: reverse UPDATE from ops_legacy_pin_backup_20260717 (holds exact prior
--       missing_count per row); drop the backup table only after owner review.
--   B5: restore the previous mark_stale_listings_inactive from git history;
--       drop table public.mon_stale_breaker_state.
-- ─────────────────────────────────────────────────────────────────────────────────────────


-- ═══ FIX B3 ═══════════════════════════════════════════════════════════════════════════
drop function if exists public.reactivate_suspect_inactive();


-- ═══ FIX B4 ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.ops_legacy_pin_backup_20260717 (
  source_table      text        not null,
  listing_id        bigint      not null,
  ad_number         text,
  missing_count_old integer,
  active            boolean,
  deactivated_at    timestamptz,
  pinned_at         timestamptz not null default now(),
  primary key (source_table, listing_id)
);
alter table public.ops_legacy_pin_backup_20260717 enable row level security;
revoke all on public.ops_legacy_pin_backup_20260717 from anon, authenticated;

do $pin$
declare
  t text; scope int; backed int; updated int;
begin
  foreach t in array array['dealapp_residential_listings',
                           'dealapp_commercial_listings',
                           'aqaratikom_commercial_listings']
  loop
    -- deterministic WHERE = exactly the vulnerable class on this platform/table; no id list
    execute format(
      'select count(*) from public.%I where active = false and coalesce(missing_count,0) = 0',
      t) into scope;

    execute format($f$
      insert into public.ops_legacy_pin_backup_20260717
             (source_table, listing_id, ad_number, missing_count_old, active, deactivated_at)
      select %L, id, ad_number, missing_count, active, deactivated_at
        from public.%I
       where active = false and coalesce(missing_count,0) = 0
    $f$, t, t);
    get diagnostics backed = row_count;

    execute format(
      'update public.%I set missing_count = 3 where active = false and coalesce(missing_count,0) = 0',
      t);
    get diagnostics updated = row_count;

    if scope <> backed or scope <> updated then
      raise exception 'legacy-pin scope mismatch on %: scope=% backed=% updated=%',
        t, scope, backed, updated;
    end if;
    raise notice 'legacy-pin %: % row(s) pinned missing_count 0 -> 3 (active stays false)', t, updated;
  end loop;
end $pin$;


-- ═══ FIX B5 ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.mon_stale_breaker_state (
  tbl                      text        primary key,
  consecutive_breaker_days integer     not null default 0,
  last_breaker_at          timestamptz,
  last_escape_at           timestamptz,
  total_escaped            integer     not null default 0,
  updated_at               timestamptz not null default now()
);
alter table public.mon_stale_breaker_state enable row level security;
revoke all on public.mon_stale_breaker_state from anon, authenticated;

create or replace function public.mark_stale_listings_inactive(stale_days integer default 7, max_frac numeric default 0.30)
 returns integer
 language plpgsql
as $fn$
declare
  t text; n int; act int; stale int; total int := 0; skipped int := 0;
  -- bounded-escape knobs (see migration header)
  escape_after_days constant int      := 3;
  escape_batch      constant int      := 25;
  alive_window      constant interval := interval '48 hours';
  plat text; alive boolean; st record; escaped int;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
      and tablename not like 'wasalt_%'
      and tablename <> 'aqar_residential_listings'
  loop
    execute format('select count(*) from public.%I where active = true', t) into act;
    execute format('select count(*) from public.%I where active = true and last_seen_at < now() - $1 * interval ''1 day''', t)
      using stale_days into stale;

    if act >= 8 and stale > max_frac * act then
      raise notice 'mark_stale: SKIP %  (% of % active would go stale > %%%)', t, stale, act, (max_frac*100)::int;
      skipped := skipped + 1;

      -- breaker-day bookkeeping: count at most once per calendar day
      insert into public.mon_stale_breaker_state as s
             (tbl, consecutive_breaker_days, last_breaker_at, updated_at)
      values (t, 1, now(), now())
      on conflict (tbl) do update
        set consecutive_breaker_days = case
              when s.last_breaker_at >= date_trunc('day', now()) then s.consecutive_breaker_days
              else s.consecutive_breaker_days + 1 end,
            last_breaker_at = now(),
            updated_at      = now();

      select * into st from public.mon_stale_breaker_state where tbl = t;

      -- scraper-alive gate: the escape must NEVER run when the scraper itself is dead
      -- (that is the wipe-protection case the breaker exists for)
      plat  := regexp_replace(t, '_(residential|commercial)_listings$', '');
      alive := exists (
        select 1 from public.scrape_runs r
        where r.ok
          and r.started_at > now() - alive_window
          and (r.platform = plat or r.platform ~ ('^' || plat || '[_:]'))
      );

      if st.consecutive_breaker_days >= escape_after_days
         and alive
         and (st.last_escape_at is null or st.last_escape_at < date_trunc('day', now()))
      then
        execute format(
          'update public.%1$I set active = false, missing_count = 3
            where id in (select id from public.%1$I
                          where active = true and last_seen_at < now() - $1 * interval ''1 day''
                          order by last_seen_at asc limit %2$s)',
          t, escape_batch)
        using stale_days;
        get diagnostics escaped = row_count;
        total := total + escaped;

        update public.mon_stale_breaker_state
           set last_escape_at = now(),
               total_escaped  = total_escaped + escaped,
               updated_at     = now()
         where tbl = t;

        raise notice 'mark_stale: ESCAPE % — flipped % oldest-stale row(s) (breaker day %, scraper alive)',
          t, escaped, st.consecutive_breaker_days;
      end if;

      continue;
    end if;

    -- breaker not tripped today: a healthy run resets the consecutive counter
    update public.mon_stale_breaker_state
       set consecutive_breaker_days = 0, updated_at = now()
     where tbl = t and consecutive_breaker_days <> 0;

    execute format(
      'update public.%I set active = false, missing_count = 3 where active = true and last_seen_at < now() - $1 * interval ''1 day''',
      t
    ) using stale_days;
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  if skipped > 0 then raise notice 'mark_stale: % table(s) skipped by circuit breaker', skipped; end if;
  return total;
end $fn$;

-- Same exposure class as B3: cron (owner) is the only legitimate caller.
revoke execute on function public.mark_stale_listings_inactive(integer, numeric) from public, anon, authenticated;

-- PostgREST: a public RPC was dropped and one was un-exposed above
notify pgrst, 'reload schema';


-- ─────────────────────────────────────────────────────────────────────────────────────────
-- REHEARSAL — BEGIN..ROLLBACK against live prod 2026-07-17, two transactions (both apply
-- this whole file first, then the scenario); every check is a RAISE EXCEPTION assertion, so
-- a completed run == all passed; prod re-verified unchanged after each ROLLBACK.
--
--   Txn 1 — B3/B4 (all PASSED, expected == measured):
--     reactivate_suspect_inactive dropped ......................... yes
--     ops_legacy_pin_backup_20260717 rows ......................... 915
--       dealapp_residential 907 · dealapp_commercial 5 · aqaratikom_commercial 3
--     backup rows all active=false, all missing_count IS NULL/0 ... yes
--     vulnerable rows (active=false, mc=0) remaining in scope ..... 0 / 0 / 0
--     gathern_residential active=false mc=0 (untouched) ........... 2,173 == pre-txn 2,173
--     active-row counts changed by the pin ........................ 0 (all three tables)
--     mark_stale proacl still contains anon/authenticated ......... no (revoke verified)
--
--   Txn 2 — B5 escape branch: dealapp_commercial_listings, scraper ALIVE (ok=true
--   scrape_runs within 48h), seeded consecutive_breaker_days=3 as of yesterday.
--   Live table state: 219 active, 96 of them >7d stale (breaker: 96 > 30% of 219).
--     run 1: flipped EXACTLY 25 rows, all with missing_count=3, all previously active,
--            max(last_seen_at) of flipped <= min(last_seen_at) of remaining stale
--            (oldest-first proven); active 219 -> 194;
--            state: consecutive_breaker_days 3->4, total_escaped=25, last_escape_at set
--     run 2 (same day): 0 additional flips (daily bound holds), active stays 194,
--            counter and total_escaped unchanged
--
--   Txn 2 — B5 breaker-holds branch: synthetic zzztest_residential_listings, scraper DEAD
--   (20 rows, 12 stale = 60% > 30%, zero scrape_runs rows, seeded breaker-day 5):
--     run 1 + run 2: 0 flips, all 20 rows stay active, last_escape_at stays NULL,
--     total_escaped stays 0, consecutive_breaker_days advances 5->6 exactly once
--     (counted once despite two same-day runs)
--
--   Post-ROLLBACK prod check after BOTH txns: reactivate_suspect_inactive present again
--   (md5 83142f835fb0dd095194290b0d353145), mark_stale_listings_inactive back to
--   md5 b8f2c7a5d4d6c74a3f2f8b6c73c014e7, none of the new tables exist, counts back to
--   907 / 5 / 3 mc=0 · dealapp_com 219 active / 96 stale · gathern 2,173.
-- ─────────────────────────────────────────────────────────────────────────────────────────
