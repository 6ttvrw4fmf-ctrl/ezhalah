-- Layer 2 (owner rule 2026-08-30): the runtime half of the "no routine can silently skip its
-- Sentry check" guarantee. Layer 1 (docs/ops/SENTRY_ROUTING.md +
-- scripts/verify-sentry-routing-wired.ts + scripts/verify-sentry-mandate-runs-first.ts) proves
-- the mandate paragraph is present in every routine spec and appears early. This layer adds a
-- runtime heartbeat: each routine, right after reading its scoped Sentry MCP queue, calls
-- ops_record_sentry_heartbeat(<slug>, seen, claimed, resolved). The heartbeat is the observable
-- proof the routine actually did the read; a Postgres detector, mon_detect_routine_sentry_silent(),
-- runs on the sweep roster and raises P1 for any of the 7 canonical routine slugs whose latest
-- heartbeat is >30h old (or missing). Silence is observed, not trusted.
--
-- See docs/ops/SENTRY_ROUTING.md, docs/ops/ALERT_ROUTING.md, and every routine spec §S for the
-- shape. Barrier: scripts/verify-sentry-heartbeat-detector-wired.ts (excluded from `npm test`,
-- runs on .github/workflows/loader-active-platforms-check.yml — the same live schedule as the
-- loader-platforms integrity check).

-- ── 1. The heartbeat table + read policy ────────────────────────────────────────────────────────
create table if not exists public.ops_routine_sentry_heartbeat (
  id bigserial primary key,
  routine text not null,
  ran_at timestamptz not null default now(),
  issues_seen int not null default 0,
  issues_claimed int not null default 0,
  issues_resolved int not null default 0,
  note text
);

comment on table public.ops_routine_sentry_heartbeat is
  'Layer 2 (owner rule 2026-08-30). One row per routine per Sentry-MCP call. `routine` is the canonical slug from docs/ops/SENTRY_ROUTING.md §2: junior-scraping / senior-production / data-integrity / search-matching-qa / af-trending / journey-persistence / systems-seam. `barrier-probe:*` slugs are barrier writes and excluded from the detector.';

create index if not exists ops_routine_sentry_heartbeat_routine_ran_at_idx
  on public.ops_routine_sentry_heartbeat(routine, ran_at desc);

alter table public.ops_routine_sentry_heartbeat enable row level security;

drop policy if exists heartbeat_read_all on public.ops_routine_sentry_heartbeat;
create policy heartbeat_read_all on public.ops_routine_sentry_heartbeat
  for select to public using (true);

-- No INSERT policy — writes go through the security-definer RPC below, so the schema forbids
-- ad-hoc inserts from anon/authenticated while still letting the RPC record heartbeats.

-- ── 2. The heartbeat RPC (the ONE write path) ───────────────────────────────────────────────────
create or replace function public.ops_record_sentry_heartbeat(
  p_routine text,
  p_issues_seen int default 0,
  p_issues_claimed int default 0,
  p_issues_resolved int default 0,
  p_note text default null
) returns bigint
language sql
security definer
set search_path = public
as $$
  insert into public.ops_routine_sentry_heartbeat(routine, issues_seen, issues_claimed, issues_resolved, note)
  values (
    btrim(p_routine),
    coalesce(p_issues_seen, 0),
    coalesce(p_issues_claimed, 0),
    coalesce(p_issues_resolved, 0),
    p_note
  )
  returning id;
$$;

comment on function public.ops_record_sentry_heartbeat(text, int, int, int, text) is
  'Layer 2 (owner rule 2026-08-30). A routine records that it just called the Sentry MCP. mon_detect_routine_sentry_silent() reads the max(ran_at) per routine and raises P1 at >30h staleness. See docs/ops/SENTRY_ROUTING.md and every routine spec §S.';

revoke all on function public.ops_record_sentry_heartbeat(text, int, int, int, text) from public;
grant execute on function public.ops_record_sentry_heartbeat(text, int, int, int, text) to anon, authenticated;

-- ── 3. The silent-routine detector ──────────────────────────────────────────────────────────────
create or replace function public.mon_detect_routine_sentry_silent()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
  slot record;
  live_keys text[] := '{}'::text[];
  stale_after constant interval := interval '30 hours';
  -- Fixed roster of routine slugs. If a new routine is added, this list MUST be updated in the
  -- same PR that adds the routine's spec — the shared barrier
  -- scripts/verify-sentry-heartbeat-detector-wired.ts names the same seven, so the two cannot
  -- silently drift.
  canonical_slugs constant text[] := array[
    'junior-scraping', 'senior-production', 'data-integrity',
    'search-matching-qa', 'af-trending', 'journey-persistence', 'systems-seam'
  ];
begin
  for slot in
    select
      s.slug,
      (select max(ran_at) from public.ops_routine_sentry_heartbeat
        where routine = s.slug and routine not like 'barrier-probe:%') as last_ran_at
    from unnest(canonical_slugs) as s(slug)
  loop
    if slot.last_ran_at is null or slot.last_ran_at < (now() - stale_after) then
      n := n + public.mon_raise('P1', 'routine_sentry_silent', slot.slug,
        'routine_sentry_silent:' || slot.slug,
        jsonb_build_object(
          'routine', slot.slug,
          'last_ran_at', slot.last_ran_at,
          'hours_since', case
            when slot.last_ran_at is null then null
            else round(extract(epoch from (now() - slot.last_ran_at))::numeric / 3600.0, 1)
          end,
          'threshold_hours', 30,
          'why', 'This routine has not called ops_record_sentry_heartbeat() in 30h. Its spec §S mandates '
              || 'calling it right after reading the Sentry MCP queue -- silence means the routine skipped '
              || 'the Sentry check. Layer 2 (owner rule 2026-08-30) says silence is observed, not trusted.',
          'action', 'The silent routine, on its next daily run, MUST call the Sentry MCP AND '
              || 'ops_record_sentry_heartbeat(<routine>, seen, claimed, resolved) BEFORE any other work -- '
              || 'that is why §S sits at §0/§1 in every spec. Once the heartbeat lands, this alert clears '
              || 'on the next sweep via mon_resolve_stale_keys.',
          'do_not', 'Do NOT resolve this by hand or by inserting a synthetic heartbeat -- that hides the '
              || 'actual silence. Do NOT widen the 30h window: the routines all run daily, so a routine that '
              || 'missed one day is what this is designed to catch.'
        )
      );
      live_keys := live_keys || ('routine_sentry_silent:' || slot.slug);
    end if;
  end loop;

  -- Any previously-open routine_sentry_silent alert for a routine that has since checked in
  -- (fresh heartbeat) clears on this same sweep.
  perform public.mon_resolve_stale_keys('routine_sentry_silent', live_keys);
  return n;
end $$;

comment on function public.mon_detect_routine_sentry_silent() is
  'Layer 2 (owner rule 2026-08-30). Raise P1 for each of the 7 canonical routines whose latest ops_routine_sentry_heartbeat entry is >30h old or missing. Kind uniform (routine_sentry_silent), dedup_key carries the specific slug, platform = slug. Routes to routine #2 (Senior Production) per docs/ops/ALERT_ROUTING.md; the silent routine itself fixes the silence on its own next run.';

-- ── 4. Roster registration (needle edit — never full-body replace on a live function) ───────────
-- Add mon_detect_routine_sentry_silent to mon_run_all_detectors() immediately after
-- mon_detect_stuck_open_alert. Both are meta-monitors of the alert plumbing itself, so grouping
-- them is coherent for future readers.
do $roster$
declare
  src text;
  new_src text;
  anchor constant text := E'\'mon_detect_stuck_open_alert\',\n';
  insertion constant text := E'\'mon_detect_routine_sentry_silent\',\n    ';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if position('mon_detect_routine_sentry_silent' in src) > 0 then
    raise notice 'mon_run_all_detectors already lists mon_detect_routine_sentry_silent -- no change';
    return;
  end if;

  if position(anchor in src) = 0 then
    raise exception 'roster anchor mon_detect_stuck_open_alert not found in mon_run_all_detectors -- refusing to needle-edit blind';
  end if;

  new_src := replace(src, anchor, anchor || '    ' || insertion);
  execute new_src;
  raise notice 'mon_run_all_detectors: added mon_detect_routine_sentry_silent';
end
$roster$;
