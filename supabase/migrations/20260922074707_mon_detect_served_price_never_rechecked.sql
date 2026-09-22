-- A SERVED price whose source has not been re-read in a month cannot have been tested by the rule
-- that governs prices, and nothing was watching for that.
--
-- WHY THIS EXISTS (routine-3, 2026-09-22, ops_incident #589). aqar 59619 was served at 25,000,000
-- SAR over a 5 m2 plot while aqar itself publishes «طلب تسويق» — no price at all. The mechanism
-- meant to prevent exactly this (db.AUTHORITATIVE_NULL, owner decision 2026-08-22) is correct and
-- was never at fault: the row's last_seen_at was 2026-07-30, three weeks BEFORE that rule shipped,
-- and it has not been re-enriched since. A rule can only act on a row something re-reads. 167 aqar
-- rows sat in that state, every one of them production_ready, and 17 sampled across three
-- independent draws were 17/17 the same shape.
--
-- WHAT IT WATCHES, and what it deliberately does not claim. It does NOT claim these prices are
-- wrong — proving that needs a source fetch, which SQL cannot do. It claims something weaker and
-- checkable: this row is SERVED, it carries a price, and we have not seen its source in over a
-- month, so no price rule has been applied to it in that time. That is the precondition that made
-- #589 invisible, and it is the honest thing a detector can assert.
--
-- THE THRESHOLD IS DELIBERATELY GENEROUS. 30 days is more than 4x the longest liveness SLA any
-- platform declares (muktamel 168h; gathern 96h). A row past it is not merely late for its own
-- cadence — it has fallen out of the rotation entirely. Measured at creation, the whole fleet
-- produced 6 cohorts and 3,488 served rows: dealapp_residential 2,977 · aqar_residential 166 ·
-- dealapp_commercial 141 · gathern_residential 99 · aqarmonthly_residential 96 · aqar_commercial 9.
-- Small enough to be worked, large enough to matter, and it names the real cohort rather than
-- lighting up the fleet.
--
-- Platforms are DISCOVERED from platform_registry, never listed here, so a platform added tomorrow
-- is covered without anyone remembering to extend anything. Tables whose shape does not match are
-- skipped rather than allowed to break the sweep.
create or replace function public.mon_detect_served_price_never_rechecked()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rec record;
  v_n bigint;
  v_oldest timestamptz;
  v_sample jsonb;
  n int := 0;
begin
  for rec in
    select pr.platform, t.table_name tn
    from public.platform_registry pr
    join information_schema.tables t
      on t.table_schema = 'public' and t.table_name like pr.platform||'\_%\_listings'
    where pr.status = 'active' and pr.kind = 'source'
    order by pr.platform, t.table_name
  loop
    begin
      execute format($f$
        select count(*), min(t.last_seen_at),
               coalesce(jsonb_agg(jsonb_build_object('listing_id', t.id, 'last_seen_at', t.last_seen_at))
                          filter (where rn <= 5), '[]'::jsonb)
        from (
          select t.id, t.last_seen_at,
                 row_number() over (order by t.last_seen_at) rn
          from public.%I t
          join public.search_listings_ar s
            on s.source_table = %L and s.listing_id = t.id and s.production_ready
          where t.active
            and (t.price_total is not null or t.price_annual is not null)
            and t.last_seen_at < now() - interval '30 days'
        ) t
      $f$, rec.tn, rec.tn)
      into v_n, v_oldest, v_sample;
    exception when others then continue;   -- shape mismatch -> skip table, never block the sweep
    end;

    if v_n > 0 then
      n := n + public.mon_raise('P2', 'served_price_never_rechecked', rec.platform,
        'served_price_never_rechecked:'||rec.tn,
        jsonb_build_object(
          'table', rec.tn,
          'served_rows_with_unrechecked_price', v_n,
          'oldest_last_seen_at', v_oldest,
          'sample', v_sample,
          'why', 'These rows are SERVED to users with a price, and their source has not been read in '
                 'over 30 days — more than 4x the longest liveness SLA any platform declares. No '
                 'price rule has been applied to them in that window, so an authoritative absence '
                 '(db.AUTHORITATIVE_NULL — the source itself saying there is no price) could not '
                 'have taken effect even if the source published one. This is NOT a claim that the '
                 'prices are wrong; it is the precondition that let ops_incident #589 serve '
                 '25,000,000 SAR on an aqar listing priced «طلب تسويق» for weeks unseen.',
          'action', 'Do not repair from this alert. Read the source first — scrapers/aqar/probe_price.py '
                    'for aqar, or the platform''s own probe — and repair only what the source proves. '
                    'The durable fix is to get these rows back into the re-read rotation; a row that '
                    'is re-enriched leaves this alert by itself.'));
    else
      update public.alert_event set resolved_at = now()
      where kind = 'served_price_never_rechecked' and resolved_at is null
        and dedup_key = 'served_price_never_rechecked:'||rec.tn;
    end if;
  end loop;

  return n;
end $function$;

-- Roster it in the SAME migration: AGENTS.md — a detector outside mon_run_all_detectors() is
-- decoration, and mon_detect_orphaned_detectors() fires on any detector nothing reaches. Edited by
-- needle rather than rewritten, so every other entry and the function's catalog attributes survive.
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if v_def is null then
    raise exception 'mon_run_all_detectors() not found — refusing to strand a detector';
  end if;
  if position('mon_detect_served_price_never_rechecked' in v_def) > 0 then
    raise notice 'already rostered';
    return;
  end if;
  if position('''mon_detect_price_source_evidence_stale''' in v_def) = 0 then
    raise exception 'roster anchor not found — refusing to guess where to insert';
  end if;

  v_new := replace(v_def,
    '''mon_detect_price_source_evidence_stale''',
    '''mon_detect_served_price_never_rechecked'', ''mon_detect_price_source_evidence_stale''');
  execute v_new;
end $$;

-- Prove BOTH halves before this migration is allowed to commit: the detector exists and the roster
-- really reaches it. A roster edit that silently did nothing is the failure mode this guards.
do $$
declare v_def text;
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname='public' and p.proname='mon_detect_served_price_never_rechecked') then
    raise exception 'detector was not created';
  end if;
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='mon_run_all_detectors';
  if position('mon_detect_served_price_never_rechecked' in v_def) = 0 then
    raise exception 'detector is not on the mon_run_all_detectors roster — it would be decoration';
  end if;
end $$;
