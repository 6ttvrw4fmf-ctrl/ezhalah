-- THE CLASS BEHIND ops_incident #25: a DECLARED alert kind with no emitter is decoration.
--
-- #25 was not "four detectors are missing". It was that a spec could name seven alert kinds, the
-- router could route all seven, migration 20260905022312 could describe one of them as "the alert kind
-- that fires when it is broken" — and nothing anywhere could raise a single one. The queue was
-- addressable and unfillable, and the only reason anyone found out was that a human read the spec next
-- to the database. Building the four missing detectors fixes the instance. This fixes the class.
--
-- IT IS THE MIRROR IMAGE OF mon_detect_detector_cannot_raise (incident #71, migration 20260906003601).
-- That one asks "does this DETECTOR have a path to alert_event?" — walking from the function. This one
-- asks "does this KIND have a detector?" — walking from the declaration. Both were dark, in opposite
-- directions, for the same reason: routing and rostering prove reachability, never audibility.
--
--   mon_detect_detector_cannot_raise        detector  ->  can it speak at all?
--   mon_detect_declared_kind_without_emitter  kind    ->  can anything speak it?
--
-- WHY A REGISTRY TABLE AND NOT A LIST IN THE FUNCTION. A barrier that supplies its own input proves
-- nothing. The declaration lives in the engineer specs under `docs/ops/`, in the convention those files
-- already use — "(kind `inactive_still_searchable`)" — and this table is that declaration made
-- queryable. `scripts/verify-declared-alert-kind-has-an-emitter.ts` re-parses the docs on every
-- `npm test` and fails if a kind is declared in prose and missing from this table, so the table cannot
-- quietly shrink to whatever is convenient.
--
-- WHAT IS DELIBERATELY *NOT* HERE: the owning routine. scripts/lib/alertRouting.ts is explicit that it
-- must not be mirrored into SQL ("a mapping with exactly one implementation cannot disagree with
-- itself"), and it is right. This table records that a kind was declared and where; who owns it stays
-- the router's single answer.
create table if not exists public.ops_declared_alert_kind (
  kind          text primary key check (kind ~ '^[a-z0-9_]+$'),
  declared_in   text not null,
  note          text,
  registered_at timestamptz not null default now()
);

comment on table public.ops_declared_alert_kind is
  'Alert kinds an engineer spec under docs/ops/ declares with the "(kind `x`)" convention. A row here '
  'is a promise that something can raise this kind; mon_detect_declared_kind_without_emitter() checks '
  'the promise twice an hour and scripts/verify-declared-alert-kind-has-an-emitter.ts checks that the '
  'docs and this table still agree. It deliberately does NOT record an owning routine — '
  'scripts/lib/alertRouting.ts is the single implementation of that mapping and must not be mirrored.';

-- The eleven kinds declared as of 2026-09-06, every one of them by
-- docs/ops/LISTING_LIFECYCLE_ENGINEER.md (routine #11 is the only spec using the convention today; the
-- barrier is fleet-wide and will pick up any spec that adopts it).
insert into public.ops_declared_alert_kind (kind, declared_in, note) values
  ('served_after_source_gone',       'docs/ops/LISTING_LIFECYCLE_ENGINEER.md §2.6', 'pre-existing detector'),
  ('unverified_inactivation',        'docs/ops/LISTING_LIFECYCLE_ENGINEER.md §2.6', 'pre-existing detector'),
  ('prune_kill_unverified',          'docs/ops/LISTING_LIFECYCLE_ENGINEER.md §2.6', 'pre-existing detector'),
  ('inactive_still_searchable',      'docs/ops/LISTING_LIFECYCLE_ENGINEER.md §4 barrier 1',  'emitter added 20260905052403'),
  ('inactive_still_counted',         'docs/ops/LISTING_LIFECYCLE_ENGINEER.md §4 barrier 4',  'emitter added 20260905052403'),
  ('false_resurrection',             'docs/ops/LISTING_LIFECYCLE_ENGINEER.md §4 barrier 5',  'emitter added 20260906041121'),
  ('unknown_treated_as_dead',        'docs/ops/LISTING_LIFECYCLE_ENGINEER.md §4 barrier 6',  'emitter added 20260905052403'),
  ('deletion_clock_without_evidence','docs/ops/LISTING_LIFECYCLE_ENGINEER.md §4 barrier 7',  'shipped name; the spec first called this claim deletion_clock_unearned and was reconciled to the emitted name 2026-09-06'),
  ('deletion_clock_stalled',         'docs/ops/LISTING_LIFECYCLE_ENGINEER.md §4 barrier 8',  'emitter added 20260906041121'),
  ('orphan_after_delete',            'docs/ops/LISTING_LIFECYCLE_ENGINEER.md §4 barrier 9',  'emitter added 20260906041121'),
  ('lifecycle_duplicate_stale_copy', 'docs/ops/LISTING_LIFECYCLE_ENGINEER.md §4 barrier 10', 'emitter added 20260906041121')
on conflict (kind) do nothing;

-- THE PURE PREDICATE — decides, writes nothing, and takes injected declarations through the SAME
-- filter, so "would you notice a kind nobody can raise?" can be asked without registering a fake one.
--
-- An emitter is a function whose body passes the kind as mon_raise's SECOND argument. Merely
-- mentioning the string (a comment, a resolve call, a jsonb payload) is not an emitter — that
-- looseness is exactly how a kind reads as covered while nothing can raise it. Verified against
-- production 2026-09-06: the strict form matched all seven kinds that genuinely had an emitter and
-- none of the five that did not.
create or replace function public.mon_declared_kinds_without_emitter(p_extra_declared text[] default '{}')
returns text[]
language sql
stable
security definer
set search_path = public
as $fn$
  with declared as (
    select k.kind from public.ops_declared_alert_kind k
    union
    select x from unnest(coalesce(p_extra_declared, '{}'::text[])) x
  ),
  judged as (
    select d.kind,
           case
             -- A kind that is not a plain identifier is reported rather than interpolated into a
             -- pattern. Reporting is the safe direction: it makes noise, it cannot hide a gap.
             when d.kind !~ '^[a-z0-9_]+$' then true
             else not exists (
               select 1 from pg_proc p
                where p.pronamespace = 'public'::regnamespace
                  -- prokind='f': pg_get_functiondef() throws on an aggregate, and one aggregate in
                  -- public would otherwise take the whole sweep down with it.
                  and p.prokind = 'f'
                  and pg_get_functiondef(p.oid) ~ ('mon_raise\s*\(\s*[^,]+,\s*''' || d.kind || '''')
             )
           end as unemitted
      from declared d
     where d.kind is not null
  )
  select coalesce(array_agg(j.kind order by j.kind), '{}'::text[])
    from judged j where j.unemitted;
$fn$;

revoke all on function public.mon_declared_kinds_without_emitter(text[]) from public;

comment on function public.mon_declared_kinds_without_emitter(text[]) is
  'Pure predicate for ops_incident #25''s class: declared alert kinds (ops_declared_alert_kind, plus '
  'any injected for a proof) that no function in public can raise as mon_raise''s second argument. '
  'Writes nothing. p_extra_declared exists so the predicate can be executed against a kind that is '
  'deliberately unemittable and watched to catch it.';

create or replace function public.mon_detect_declared_kind_without_emitter()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n    int := 0;
  live text[] := '{}';
  miss text[];
  k    text;
begin
  miss := public.mon_declared_kinds_without_emitter();

  -- One alert per kind, not one for the set: a second missing kind must not hide behind the first
  -- one's dedup key, and each clears independently as its detector lands.
  foreach k in array miss loop
    live := live || ('declared_kind_without_emitter:' || k);
    n := n + public.mon_raise('P1', 'declared_kind_without_emitter', 'monitoring',
      'declared_kind_without_emitter:' || k,
      jsonb_build_object(
        'kind', k,
        'declared_in', (select d.declared_in from public.ops_declared_alert_kind d where d.kind = k),
        'why', 'An engineer spec declares this alert kind and scripts/lib/alertRouting.ts routes it to '
            || 'a routine, but no function in this database passes it to mon_raise. Nothing can ever '
            || 'raise it, so the queue it belongs to is addressable and unfillable — the shape recorded '
            || 'as ops_incident #25, where all seven of routine #11''s kinds were routed and none was '
            || 'emitted, one of them described in its own migration as "the alert kind that fires when '
            || 'it is broken".',
        'why_it_is_not_covered_by_the_other_checks', 'mon_detect_orphaned_detectors() proves a detector '
            || 'is REACHED; mon_detect_detector_cannot_raise() proves a detector can SPEAK. Both walk '
            || 'from the function. Neither can see a kind that has no function at all.',
        'action', 'Either build the detector — in one migration with its mon_run_all_detectors roster '
            || 'entry, because a detector outside the roster is decoration — or delete the claim from '
            || 'the spec and from ops_declared_alert_kind. Do NOT make this green by removing the row '
            || 'while the spec still promises the kind: scripts/verify-declared-alert-kind-has-an-emitter.ts '
            || 're-parses the docs and will fail.'));
  end loop;

  perform public.mon_resolve_stale_keys('declared_kind_without_emitter', live);
  return n;
end;
$fn$;

-- ROSTER, same migration. Needle-edited off the LIVE body with an assertion that it matched and that
-- the roster grew by exactly one.
do $roster$
declare
  v_src text;
  v_new text;
  v_before int;
  v_after  int;
begin
  v_src := pg_get_functiondef('public.mon_run_all_detectors'::regproc);

  if position('mon_detect_declared_kind_without_emitter' in v_src) > 0 then
    raise notice 'already rostered; nothing to do';
    return;
  end if;

  v_before := (select count(*) from regexp_matches(v_src, '''mon_detect_[a-z0-9_]+''', 'g'));

  v_new := replace(
    v_src,
    $old$'mon_detect_detector_cannot_raise'$old$,
    $new$'mon_detect_detector_cannot_raise',
    -- the mirror image of the line above (ops_incident #25): that one asks whether a detector can
    -- speak, this one asks whether a declared kind has anything that speaks it.
    'mon_detect_declared_kind_without_emitter'$new$);

  if v_new = v_src then
    raise exception 'roster needle did not match — refusing to leave the class detector outside the sweep';
  end if;

  v_after := (select count(*) from regexp_matches(v_new, '''mon_detect_[a-z0-9_]+''', 'g'));
  if v_after <> v_before + 1 then
    raise exception 'roster grew by % entries, expected exactly 1 — refusing to write', v_after - v_before;
  end if;

  execute v_new;
end;
$roster$;

do $verify$
begin
  if position('mon_detect_declared_kind_without_emitter'
              in pg_get_functiondef('public.mon_run_all_detectors'::regproc)) = 0 then
    raise exception 'roster verification failed: the class detector is not reachable from the sweep';
  end if;
end;
$verify$;
