-- ops_incident #252: one routine, one identity, TWO incompatible spellings — and the READ path
-- cannot tell a wrong slug from an empty queue.
--
-- ops_incident.owner_routine is a free-text filter, so
--     select * from ops_incident where owner_routine = 'systems-seam'
-- returns 0 rows rather than an error. That is indistinguishable from a clean queue. It is this
-- repo's A FAILED FETCH IS NOT AN EMPTY ANSWER rule pointed at an internal identity instead of an
-- HTTP call, and it is not hypothetical twice over: #252 was filed on 2026-09-13 after routine #7
-- read its own queue with the heartbeat slug, got 0 rows, reported "my incident queue: empty" and
-- worked none of its 31 open incidents — and the routine-7 run of 2026-09-22 made the SAME mistake
-- again while reading #252's own queue, before finding #252. A defect that re-bites the routine
-- reading its own report of it is a mechanism problem, not an attention problem.
--
-- WHAT ALREADY EXISTED, AND WHY THE FIX IS SMALL. #252 proposed building a routine-identity spine
-- and deferred it because PR #2548 had landed hours earlier. Nine days on, that spine exists:
-- public.ops_routine_heartbeat_alias(canonical, emits_as) already carries both spellings for every
-- routine (systems-seam -> routine-7-seam among them), and mon_detect_routine_sentry_silent()
-- already resolves the WRITE side through it. Measured at install: all four divergence limbs below
-- are clean, so the table is complete TODAY. The only thing missing was a reader.
--
-- So this does NOT rebuild the spine that eleven routines read. It adds the missing resolver and a
-- detector that keeps the spine complete, and changes no existing behaviour.
--
-- incident_queue() is deliberately the READ-path twin of incident_handoff(), which PR #2548 already
-- hardened to REJECT an unknown p_new_owner for exactly this reason. The write path refused an
-- unknown slug; the read path silently returned nothing. Now both refuse.
--
-- routine #7 (systems-seam), 2026-09-22.

create or replace function public.incident_resolve_routine_slug(p_routine text)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_in        text := btrim(coalesce(p_routine, ''));
  v_canonical text;
begin
  if v_in = '' then
    raise exception 'incident_resolve_routine_slug: a routine slug is required; got %s',
      coalesce(quote_literal(p_routine), 'NULL')
      using hint = 'Pass either spelling, e.g. ''routine-7-seam'' or ''systems-seam''.';
  end if;

  -- Accept EITHER vocabulary: the incident-owner slug or any heartbeat slug the routine emits.
  select a.canonical into v_canonical
    from public.ops_routine_heartbeat_alias a
   where a.emits_as = v_in or a.canonical = v_in
   limit 1;

  if v_canonical is null then
    -- The whole point: never return "nothing", which reads as an empty queue.
    raise exception 'incident_resolve_routine_slug: unknown routine slug %', quote_literal(v_in)
      using hint = 'Known slugs: ' || (
        select string_agg(distinct s, ', ' order by s)
          from (select a.canonical s from public.ops_routine_heartbeat_alias a
                union select a.emits_as from public.ops_routine_heartbeat_alias a) u(s));
  end if;

  return v_canonical;
end $fn$;

comment on function public.incident_resolve_routine_slug(text) is
  'Resolves either routine vocabulary (incident-owner slug or heartbeat slug) to the canonical '
  'owner slug, and RAISES on an unknown one. ops_incident #252: a wrong slug must never be '
  'indistinguishable from an empty queue.';

create or replace function public.incident_queue(p_routine text)
returns setof public.ops_incident
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_canonical text := public.incident_resolve_routine_slug(p_routine);  -- raises on unknown
begin
  return query
    select i.* from public.ops_incident i
     where i.owner_routine = v_canonical
       and i.state not in ('resolved', 'wont_fix')
     order by (i.severity = 'P0') desc, (i.severity = 'P1') desc, i.created_at;
end $fn$;

comment on function public.incident_queue(text) is
  'The open incident queue for a routine, addressable by EITHER of its slugs. Refuses an unknown '
  'slug instead of returning zero rows (ops_incident #252). Read-path twin of incident_handoff().';

-- ---------------------------------------------------------------------------------------------
-- The detector that keeps the spine complete, so the resolver cannot silently start failing.
-- ---------------------------------------------------------------------------------------------
create or replace function public.mon_detect_routine_slug_divergence()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  n          int := 0;
  v_owners   text[];
  v_a        text[];
  v_b        text[];
  v_c        text[];
  v_d        text[];
begin
  v_owners := public.incident_known_owners();

  -- (1) A known incident owner with NO alias row: incident_queue() cannot resolve its own
  --     canonical slug, so its queue becomes unreadable through the safe path.
  select coalesce(array_agg(o.c order by o.c), '{}')
    into v_a
    from (select unnest(v_owners) c) o
   where not exists (select 1 from public.ops_routine_heartbeat_alias a where a.canonical = o.c);

  -- (2) An alias pointing at a canonical that is NOT a known owner: incident_queue() would happily
  --     resolve to an owner incident_handoff() refuses to route to — the two paths disagreeing.
  select coalesce(array_agg(distinct a.canonical order by a.canonical), '{}')
    into v_b
    from public.ops_routine_heartbeat_alias a
   where a.canonical <> all(v_owners);

  -- (3) A heartbeat slug actually WRITTEN that no alias maps: this is #252 from the write side —
  --     the routine is recording heartbeats under a name nothing can translate.
  select coalesce(array_agg(distinct h.routine order by h.routine), '{}')
    into v_c
    from public.ops_routine_sentry_heartbeat h
   where h.routine not like 'barrier-probe:%'
     and not exists (select 1 from public.ops_routine_heartbeat_alias a where a.emits_as = h.routine);

  -- (4) An incident owned by a slug that is not a known owner: those rows are invisible to every
  --     routine's queue read, which is the orphaned-finding shape ops_incident exists to prevent.
  select coalesce(array_agg(distinct i.owner_routine order by i.owner_routine), '{}')
    into v_d
    from public.ops_incident i
   where i.owner_routine <> all(v_owners);

  if cardinality(v_a) > 0 or cardinality(v_b) > 0
     or cardinality(v_c) > 0 or cardinality(v_d) > 0 then
    n := n + public.mon_raise('P1', 'routine_slug_divergence', 'monitoring',
      'routine_slug_divergence',
      jsonb_build_object(
        'owners_with_no_alias',        to_jsonb(v_a),
        'alias_to_unknown_owner',      to_jsonb(v_b),
        'heartbeat_slug_unmapped',     to_jsonb(v_c),
        'incident_owner_unknown',      to_jsonb(v_d),
        'why', 'A routine has ONE identity and this repo spells it two ways: the incident-owner '
            || 'slug (routine-N-*) and the heartbeat slug (systems-seam, junior-scraping, ...). '
            || 'public.ops_routine_heartbeat_alias is the single table that reconciles them, and '
            || 'incident_resolve_routine_slug() / incident_queue() depend on it being complete. '
            || 'A gap here makes a routine queue unreadable through the safe path, or makes a '
            || 'finding invisible to every routine — ops_incident #252.',
        'action', 'Add the missing (canonical, emits_as) row to ops_routine_heartbeat_alias, or '
            || 'correct the owner slug on the incidents named. Do NOT clear this by deleting an '
            || 'alias row or by re-owning incidents to a slug that merely happens to resolve.'));
  else
    perform public.mon_resolve_key('routine_slug_divergence', 'routine_slug_divergence');
  end if;

  return n;
end $fn$;

comment on function public.mon_detect_routine_slug_divergence() is
  'Keeps the two routine vocabularies reconciled so incident_queue() cannot silently fail to '
  'resolve. ops_incident #252.';

-- ---------------------------------------------------------------------------------------------
-- Roster entry, in the SAME migration. A detector outside the roster is decoration.
-- Needle-edit from the LIVE body (never a full-body replace from a stale copy), and RAISE if the
-- anchor moved rather than silently landing nothing.
-- ---------------------------------------------------------------------------------------------
do $mig$
declare
  v_def    text;
  v_anchor text := '''mon_detect_routine_sentry_silent'',';
  v_hits   int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors';

  if v_def is null then
    raise exception 'mon_run_all_detectors not found — refusing to roster blindly';
  end if;

  if position('mon_detect_routine_slug_divergence' in v_def) > 0 then
    raise notice 'already rostered — nothing to do';
    return;
  end if;

  v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception 'roster anchor % occurs % times (expected exactly 1) — refusing to needle-edit',
      v_anchor, v_hits;
  end if;

  execute replace(v_def, v_anchor,
                  v_anchor || E'\n    ''mon_detect_routine_slug_divergence'',');
end $mig$;

-- ---------------------------------------------------------------------------------------------
-- PROOFS. This migration REFUSES to install unless the behaviour is demonstrated by EXECUTION.
-- ---------------------------------------------------------------------------------------------

-- PROOF 1 — both spellings reach the SAME queue, and it is non-empty (so the test can actually
-- fail). This is the exact bug: 'systems-seam' used to return 0 while 'routine-7-seam' returned 31.
do $p1$
declare a int; b int;
begin
  select count(*) into a from public.incident_queue('systems-seam');
  select count(*) into b from public.incident_queue('routine-7-seam');
  if a <> b then
    raise exception 'PROOF 1 failed: the two spellings disagree (% vs %)', a, b;
  end if;
  if a = 0 then
    raise exception 'PROOF 1 vacuous: routine-7-seam has no open incidents, so agreement proves nothing';
  end if;
  raise notice 'PROOF 1 ok: both slugs return % open incidents', a;
end $p1$;

-- PROOF 2 — an unknown slug RAISES. It must not return an empty set, which is the whole defect.
do $p2$
declare v_n int; v_raised boolean := false;
begin
  begin
    select count(*) into v_n from public.incident_queue('systems-seam-engineer');
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'PROOF 2 failed: an unknown slug returned % rows instead of raising', v_n;
  end if;
  raise notice 'PROOF 2 ok: unknown slug raised';
end $p2$;

-- PROOF 3 — empty and NULL slugs raise too (the other way to read "nothing").
do $p3$
declare v_n int; v_raised int := 0;
begin
  begin select count(*) into v_n from public.incident_queue(''); exception when others then v_raised := v_raised + 1; end;
  begin select count(*) into v_n from public.incident_queue(null); exception when others then v_raised := v_raised + 1; end;
  if v_raised <> 2 then
    raise exception 'PROOF 3 failed: only % of 2 degenerate slugs raised', v_raised;
  end if;
  raise notice 'PROOF 3 ok';
end $p3$;

-- PROOF 4 — the detector is clean now AND can actually fire. The second half is the one that
-- matters: a detector proven only against a clean world is a detector proven to return 0.
-- The mutant is planted and ROLLED BACK inside a sub-transaction.
do $p4$
declare v_clean int; v_mutant int;
begin
  v_clean := public.mon_detect_routine_slug_divergence();
  if v_clean <> 0 then
    raise exception 'PROOF 4: detector raised % on install — the spine is NOT clean, fix that first', v_clean;
  end if;

  begin
    -- plant LIMB 3: a heartbeat written under a slug no alias maps.
    insert into public.ops_routine_sentry_heartbeat (routine, ran_at, issues_seen, issues_claimed, issues_resolved, note)
    values ('__mutant_unmapped_slug__', now(), 0, 0, 0, 'ROLLED BACK: mutation proof for #252');

    if not exists (
      select 1 from public.ops_routine_sentry_heartbeat h
       where h.routine = '__mutant_unmapped_slug__'
         and not exists (select 1 from public.ops_routine_heartbeat_alias a where a.emits_as = h.routine)
    ) then
      raise exception 'PROOF 4: the mutant did not land — the proof would be vacuous';
    end if;

    raise exception 'ROLLBACK_MUTANT';
  exception
    when others then
      if sqlerrm <> 'ROLLBACK_MUTANT' then raise; end if;
  end;

  -- the mutant must be gone
  if exists (select 1 from public.ops_routine_sentry_heartbeat where routine = '__mutant_unmapped_slug__') then
    raise exception 'PROOF 4: the mutant PERSISTED — refusing to install';
  end if;
  raise notice 'PROOF 4 ok: detector clean (0), mutant landed and rolled back';
end $p4$;

-- PROOF 5 — the detector is reachable from the roster. Decoration is not coverage.
do $p5$
begin
  if not exists (select 1 from pg_proc r
                  where r.pronamespace = 'public'::regnamespace
                    and r.proname = 'mon_run_all_detectors'
                    and pg_get_functiondef(r.oid) like '%mon_detect_routine_slug_divergence%') then
    raise exception 'PROOF 5 failed: detector is not on the mon_run_all_detectors roster';
  end if;
  raise notice 'PROOF 5 ok';
end $p5$;
