-- ORPHANED-GUARANTEE REGISTRY — the durable home for "repair → detector that watches it".
--
-- docs/ops/SYSTEMS_SEAM_ENGINEER.md calls this registry routine #7's core standing asset, but the
-- spec named no table, so it would have been re-derived from scratch every run — and a registry
-- rebuilt each morning has no memory of WHEN each guarantee was last checked, which is exactly the
-- property oldest-first rotation depends on. The spec also scoped the sweep to "the last 90 days",
-- which silently aged out older repairs: a four-month-old decayed invariant fell out of scope
-- entirely, on the very schedule that made it most likely to have rotted. Both are fixed in the
-- spec (2026-08-28); this is the table that makes the fix real.
--
-- The class of bug this exists for: a one-shot repair is a CLAIM about an invariant, and an
-- unwatched claim decays. Migration 20260721104637 repaired 1,015 aqarmonthly districts, shipped no
-- detector, and every re-scrape quietly re-corrupted the rows it had just fixed — for a month, with
-- zero alerts. scripts/verify-repair-migrations-are-guarded.ts is the MERGE-TIME half (a repair must
-- ship a detector). This registry is the STANDING half: the detector must still exist, still be
-- reachable, and the invariant must still hold TODAY.
--
-- ADDITIVE ONLY. No data migration, no backfill, no destructive change. The table starts empty and
-- routine #7 populates it; the detector below is correctly silent on an empty registry.
create table if not exists public.ops_repair_guarantee_registry (
  -- The repair's migration version (the 14-digit timestamp apply_migration minted) and its name.
  repair_version   text primary key,
  repair_name      text        not null,
  -- The invariant IN PLAIN WORDS. Not the SQL, not the migration's own comment — the sentence a
  -- future engineer can re-verify against production without reading the original diff.
  invariant        text        not null,
  -- The mon_detect_* that watches it. NULL means "registered but unwatched" and is a finding, not
  -- a blank to be left alone — mon_detect_repair_guarantee_stale() raises on it.
  detector         text,
  registered_at    timestamptz not null default now(),
  registered_by    text,
  -- Rotation state. NULL last_verified_at = never verified since registration.
  last_verified_at timestamptz,
  last_verdict     text check (last_verdict in ('holds','violated','detector_missing','undetermined')),
  last_detail      jsonb       not null default '{}'::jsonb
);

comment on table public.ops_repair_guarantee_registry is
  'Routine #7 (Systems Seam Engineer) orphaned-guarantee registry. PERMANENT coverage — no time '
  'window, nothing ages out. Each run re-verifies the LEAST-RECENTLY-VERIFIED entries first '
  '(order by last_verified_at nulls first, repair_version) and writes back last_verified_at + '
  'last_verdict, so coverage rotates across the whole history of repairs. Every repair anyone '
  'lands gets a row, the other six routines'' included. See docs/ops/SYSTEMS_SEAM_ENGINEER.md '
  'PART 1 for what counts as an "important repair".';

-- The rotation index: exactly the order the sweep reads in, so "which guarantee has gone longest
-- unchecked" is an index scan rather than a sort of the whole registry.
create index if not exists ops_repair_guarantee_registry_rotation
  on public.ops_repair_guarantee_registry (last_verified_at nulls first, repair_version);

-- Same posture as every other ops_* table here: RLS on, no policies — denied to anon/authenticated,
-- reachable only by the service role and SECURITY DEFINER functions.
alter table public.ops_repair_guarantee_registry enable row level security;


-- The registry's own watchdog. Without it the registry would be exactly the thing it exists to
-- prevent: a standing asset nothing watches.
--
-- Two independent shapes, two dedup keys, each resolved on its own evaluated path (required —
-- mon_detect_unresolvable_detector() fails any detector that can open an alert and never close one,
-- and a key left open makes mon_raise() return 0 for a genuine re-occurrence).
create or replace function public.mon_detect_repair_guarantee_stale()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  -- #7 runs daily and rotates oldest-first, so 30 days is roughly a month of runs failing to reach
  -- an entry — not a tight SLA. If this starts raising, the fix is a bigger per-run batch, not a
  -- bigger number here. (Removing a guard inverts its monitor: raising this threshold silently
  -- widens what counts as "watched".)
  c_stale_days int := 30;
  n            int := 0;
  v_roster     text;
  v_unwatched  text[];
  v_stale      text[];
  v_oldest     timestamptz;
begin
  -- Fetch the roster body ONCE rather than per row.
  select pg_get_functiondef(p.oid) into v_roster
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'mon_run_all_detectors'
   limit 1;

  -- (1) A registered repair whose invariant is no longer WATCHED: no detector named, the named
  --     detector no longer exists, or it exists but nothing reaches it. Reachability is the same
  --     rule mon_detect_orphaned_detectors() uses — roster membership or its own cron job.
  select coalesce(array_agg(r.repair_version order by r.repair_version), '{}')
    into v_unwatched
    from public.ops_repair_guarantee_registry r
   where coalesce(r.detector, '') = ''
      or not exists (select 1 from pg_proc p
                      where p.pronamespace = 'public'::regnamespace
                        and p.proname = r.detector)
      or not (position(r.detector in coalesce(v_roster, '')) > 0
              or exists (select 1 from cron.job j
                          where j.active and position(r.detector in j.command) > 0));

  -- (2) A registered repair nothing has re-VERIFIED in too long. An entry that has never been
  --     verified is measured from registration, so registering a repair does not instantly raise.
  select coalesce(array_agg(r.repair_version order by coalesce(r.last_verified_at, r.registered_at)), '{}'),
         min(coalesce(r.last_verified_at, r.registered_at))
    into v_stale, v_oldest
    from public.ops_repair_guarantee_registry r
   where coalesce(r.last_verified_at, r.registered_at) < now() - make_interval(days => c_stale_days);

  if cardinality(v_unwatched) > 0 then
    n := n + public.mon_raise('P2', 'repair_guarantee', 'monitoring', 'repair_guarantee_unwatched',
      jsonb_build_object(
        'repairs', to_jsonb(v_unwatched),
        'count', cardinality(v_unwatched),
        'why', 'These repairs are registered in ops_repair_guarantee_registry but nothing is '
            || 'watching the invariant each one restored: the detector column is empty, the named '
            || 'detector no longer exists, or it exists and is reachable from neither '
            || 'mon_run_all_detectors() nor an active cron job. A one-shot repair is a CLAIM about '
            || 'an invariant; only a standing detector proves it still holds. This is the class '
            || 'that let a July district-suffix repair decay for a month with zero alerts.',
        'action', 'For each: re-verify the invariant against production NOW, then either point the '
            || 'row at the detector that genuinely covers it, or write the detector and wire it '
            || 'into mon_run_all_detectors() in the SAME migration. Do NOT clear this by deleting '
            || 'the registry row.'));
  else
    perform public.mon_resolve_key('repair_guarantee', 'repair_guarantee_unwatched');
  end if;

  if cardinality(v_stale) > 0 then
    n := n + public.mon_raise('P2', 'repair_guarantee', 'monitoring', 'repair_guarantee_stale',
      jsonb_build_object(
        'repairs', to_jsonb(v_stale),
        'count', cardinality(v_stale),
        'oldest_touched_at', v_oldest,
        'stale_days', c_stale_days,
        'why', 'These registered repairs have not been re-verified against production within the '
            || 'staleness window (an entry never verified is measured from registered_at). The '
            || 'registry carries PERMANENT coverage with oldest-first rotation precisely so that '
            || 'nothing ages out — entries going stale means the rotation is not reaching them, '
            || 'which restores the blind spot the 90-day window used to create.',
        'action', 'Read the registry ordered by (last_verified_at nulls first, repair_version), '
            || 're-verify from the top, and write back last_verified_at + last_verdict. If the '
            || 'backlog cannot be cleared in one run, increase the per-run batch — do NOT raise '
            || 'c_stale_days to make this green.'));
  else
    perform public.mon_resolve_key('repair_guarantee', 'repair_guarantee_stale');
  end if;

  return n;
end $function$;

comment on function public.mon_detect_repair_guarantee_stale() is
  'Watches ops_repair_guarantee_registry itself: a registered repair whose invariant is no longer '
  'watched, or which has gone too long without re-verification. Silent on an empty registry.';


-- ROSTER WIRING — required in the SAME migration per AGENTS.md: a detector outside
-- mon_run_all_detectors() is decoration, and mon_detect_orphaned_detectors() fires on it.
--
-- This NEEDLE-EDITS the LIVE function body rather than re-creating mon_run_all_detectors() from a
-- body captured earlier: concurrent sessions add detectors to this same roster, and a full-body
-- replace built from a stale copy silently drops whatever landed in between (the documented
-- full-body-replace revert hazard). Reading pg_get_functiondef() at apply time and inserting one
-- element next to a unique anchor is the safe form. Idempotent: a no-op if already present.
do $wire$
declare def text; anchor text := '''mon_detect_unresolvable_detector''';
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'mon_run_all_detectors'
   limit 1;

  if def is null then
    raise exception 'mon_run_all_detectors() not found — refusing to wire a detector into nothing';
  end if;

  if position('mon_detect_repair_guarantee_stale' in def) > 0 then
    raise notice 'mon_detect_repair_guarantee_stale already on the roster — nothing to do';
    return;
  end if;

  -- The anchor must be unique, or replace() would edit more than one site.
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'anchor % is not unique in mon_run_all_detectors() — refusing to needle-edit', anchor;
  end if;

  def := replace(def, anchor, anchor || ',' || chr(10) || '    ''mon_detect_repair_guarantee_stale''');
  execute def;
end $wire$;
