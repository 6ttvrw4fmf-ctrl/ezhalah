-- REPO <-> PRODUCTION DRIFT: the half nobody was checking.
--
-- sql/mirrors/*.sql are what a session READS to reason about the parser and the location pipeline,
-- so a stale one silently teaches every future engineer the wrong behaviour. scripts/
-- verify-sql-mirrors-not-stale.ts guards two things, and neither is the one that matters most:
--     (A) self-consistency  — the md5 recorded in the file header vs the file's OWN body
--     (B) not-older-than    — the mirror's Refreshed DATE vs the newest migration touching the object
-- (A) can pass on a file that has never matched production; (B) is date-granular, so a mirror
-- refreshed the same DAY as the migration that changed it passes while missing an entire guard block.
-- That is exactly how sql/mirrors/aqar_parse.sql lost the whole «AREA-ARTIFACT GUARD» block (4,363
-- bytes on disk against 5,270 live), found by senior audit run #10 — by hand, not by a barrier.
--
-- Nothing anywhere compared a mirror to the LIVE definition. Checked at 13:04Z today all three
-- happen to match, but only because a human regenerated them hours ago; there was no mechanism that
-- would have noticed otherwise.
--
-- THE CHAIN THIS COMPLETES:
--     mirror file  --(A), offline, existing)-->  md5 recorded in its header
--     md5 recorded --(this detector, live, twice an hour)-->  md5(pg_get_functiondef) in production
-- Both links must hold, so a drifted mirror can no longer pass by being internally tidy.
--
-- A legitimate change to one of these objects must update the mirror file AND this table in the same
-- migration. That is deliberate: until both move, the object HAS drifted from its canonical repo
-- representation, and that is precisely what the owner asked to be detectable.
create table if not exists public.ops_sql_mirror_expected (
  object_name  text primary key,
  object_kind  text not null check (object_kind in ('function','view')),
  mirror_path  text not null,
  expected_md5 text not null check (expected_md5 ~ '^[0-9a-f]{32}$'),
  recorded_at  timestamptz not null default now(),
  note         text
);
comment on table public.ops_sql_mirror_expected is
  'The md5 each sql/mirrors/*.sql file records in its header. mon_detect_sql_mirror_drift compares it '
  'to md5(pg_get_functiondef/pg_get_viewdef) in production. Update this together with the mirror file '
  'whenever the object legitimately changes — never to silence the detector.';

insert into public.ops_sql_mirror_expected (object_name, object_kind, mirror_path, expected_md5, note) values
  ('aqar_parse', 'function', 'sql/mirrors/aqar_parse.sql', '3347a572f90a29a1ab2de739f987975b',
   'seeded 2026-08-11 from the mirror header, verified equal to live at seed time'),
  ('trg_aqar_parse', 'function', 'sql/mirrors/trg_aqar_parse.sql', 'e94517e6c07ddb44ac946fe64b1b7ee0',
   'seeded 2026-08-11 from the mirror header, verified equal to live at seed time'),
  ('listing_native_location_v1', 'view', 'sql/mirrors/listing_native_location_v1.sql', 'd7fff7ec0378d6095728e862aee80106',
   'seeded 2026-08-11 from the mirror header, verified equal to live at seed time')
on conflict (object_name) do nothing;

create or replace function public.mon_live_object_md5(p_name text, p_kind text)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v text;
begin
  if p_kind = 'function' then
    select md5(pg_get_functiondef(p.oid)) into v
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = p_name
     limit 1;
  else
    select md5(pg_get_viewdef(c.oid, true)) into v
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = p_name
     limit 1;
  end if;
  return v;
end $function$;

create or replace function public.mon_detect_sql_mirror_drift()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare rec record; v_live text; drifted jsonb := '[]'::jsonb; missing jsonb := '[]'::jsonb; n int := 0;
begin
  for rec in select * from public.ops_sql_mirror_expected order by object_name loop
    v_live := public.mon_live_object_md5(rec.object_name, rec.object_kind);
    if v_live is null then
      missing := missing || jsonb_build_object('object', rec.object_name, 'kind', rec.object_kind);
    elsif v_live <> rec.expected_md5 then
      drifted := drifted || jsonb_build_object(
        'object', rec.object_name, 'mirror_path', rec.mirror_path,
        'expected_md5', rec.expected_md5, 'live_md5', v_live);
    end if;
  end loop;

  if jsonb_array_length(drifted) > 0 or jsonb_array_length(missing) > 0 then
    n := public.mon_raise('P1', 'sql_mirror_drift', 'repo_vs_production', 'sql_mirror_drift',
      jsonb_build_object(
        'drifted', drifted, 'missing_objects', missing,
        'why', 'A sql/mirrors/*.sql file no longer matches the LIVE production object it mirrors. '
               'Sessions READ these files to reason about parser and location behaviour, so a stale '
               'one teaches the wrong behaviour to everyone after it. Regenerate the mirror verbatim '
               'from pg_get_functiondef/pg_get_viewdef and update ops_sql_mirror_expected in the same '
               'migration. The offline verifier cannot catch this: its md5 check is self-consistency '
               'and its staleness check is date-granular, so same-day drift passes both.'));
  else
    perform public.mon_resolve_key('sql_mirror_drift', 'sql_mirror_drift');
  end if;
  return n;
end $function$;

-- ── roster wiring, SANCTIONED NEEDLE-EDIT ────────────────────────────────────────────────────────
do $$
declare
  v_def text; anchor constant text := '''mon_detect_orphaned_detectors''';
  want constant text[] := array['mon_detect_sql_mirror_drift']; fn text; missing text[] := '{}';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='mon_run_all_detectors';
  if position(anchor in v_def) = 0 then raise exception 'roster anchor missing'; end if;
  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then
      v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n    ' || anchor);
    end if;
  end loop;
  execute v_def;
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='mon_run_all_detectors';
  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then missing := missing || fn; end if;
  end loop;
  if cardinality(missing) > 0 then raise exception 'roster wiring incomplete: %', array_to_string(missing,', '); end if;
  if position('open_alerts' in v_def) = 0 then raise exception 'roster return lost open_alerts'; end if;
end $$;

-- ── MUTATION TEST: clean today, and provably able to fail ────────────────────────────────────────
do $mut$
declare v_n int; v_saved text;
begin
  -- clean baseline: all three mirrors match live right now
  v_n := public.mon_detect_sql_mirror_drift();
  if exists (select 1 from public.alert_event where dedup_key='sql_mirror_drift' and resolved_at is null) then
    raise exception 'detector reports drift on a fleet verified byte-identical minutes ago';
  end if;

  -- MUTATION: corrupt one expected digest and it MUST fire; restore and it MUST clear.
  select expected_md5 into v_saved from public.ops_sql_mirror_expected where object_name='aqar_parse';
  update public.ops_sql_mirror_expected
     set expected_md5 = '00000000000000000000000000000000' where object_name='aqar_parse';
  perform public.mon_detect_sql_mirror_drift();
  if not exists (select 1 from public.alert_event where dedup_key='sql_mirror_drift' and resolved_at is null) then
    raise exception 'mutation failed: a deliberately wrong digest did not raise';
  end if;

  update public.ops_sql_mirror_expected set expected_md5 = v_saved where object_name='aqar_parse';
  perform public.mon_detect_sql_mirror_drift();
  if exists (select 1 from public.alert_event where dedup_key='sql_mirror_drift' and resolved_at is null) then
    raise exception 'self-heal failed: restoring the digest did not resolve the alert';
  end if;

  raise notice 'sql_mirror_drift: clean today, fires on a corrupted digest, self-heals on restore';
end $mut$;
