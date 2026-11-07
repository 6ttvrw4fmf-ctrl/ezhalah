-- 🔧 2026-11-07 — heartbeat follow-up 2 (CodeRabbit Minors on #11138):
--  1. the per-platform row was still exempt from the window CHECK (a NULL window would silently never fire) → every
--     enabled checked row, per-platform included, needs window_hours > 0.
--  2. a row that errors kept only its P2 key live, so the stale-key resolve closed that stream's open P1(s) while the
--     stream was unwatched → the handler keeps the stream's open heartbeat_silent keys live too.

alter table public.ops_heartbeat_expectations drop constraint if exists ops_heartbeat_expectations_check;
alter table public.ops_heartbeat_expectations add constraint ops_heartbeat_expectations_check
  check (covered_by is not null or not enabled
         or ((relation is not null and ts_expr is not null or stream = 'scrape_runs_per_platform')
             and coalesce(window_hours, 0) > 0));

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_detect_heartbeat_silent()'::regprocedure);
  if position('keep this stream''s open P1s' in src) > 0 then raise notice 'already patched'; return; end if;
  out_def := replace(src,
    E'      v_key := ''heartbeat_check_broken:'' || e.stream;\n',
    E'      -- keep this stream''s open P1s live: an unevaluable stream is not a recovered one.\n'
    || E'      live_keys := live_keys || array(select a.dedup_key from public.alert_event a where a.resolved_at is null\n'
    || E'        and (a.dedup_key = ''heartbeat_silent:'' || e.stream or a.dedup_key like ''heartbeat_silent:'' || e.stream || '':%''));\n'
    || E'      v_key := ''heartbeat_check_broken:'' || e.stream;\n');
  if out_def = src then raise exception 'heartbeat handler anchor not found — refusing to guess'; end if;
  execute out_def;
end $$;

-- PROOF: an open P1 survives its row turning broken; a NULL window on the per-platform row is rejected; rolled back.
do $$
begin
  begin
    create table public.__hb_selftest2 (at timestamptz);
    insert into public.ops_heartbeat_expectations (stream, relation, ts_expr, window_hours, min_rows, alert_kind, measured)
    values ('__selftest_keep__', '__hb_selftest2', 'at', 1, 1, 'heartbeat_silent', 'selftest');
    perform public.mon_detect_heartbeat_silent();
    if not exists (select 1 from public.alert_event where dedup_key = 'heartbeat_silent:__selftest_keep__' and resolved_at is null) then
      raise exception 'PROOF: the silent selftest stream did not raise';
    end if;
    update public.ops_heartbeat_expectations set relation = '__no_such_relation__' where stream = '__selftest_keep__';
    perform public.mon_detect_heartbeat_silent();
    if not exists (select 1 from public.alert_event where dedup_key = 'heartbeat_silent:__selftest_keep__' and resolved_at is null)
       or not exists (select 1 from public.alert_event where dedup_key = 'heartbeat_check_broken:__selftest_keep__' and resolved_at is null) then
      raise exception 'PROOF: a broken row closed its open P1 (or raised no P2)';
    end if;
    begin
      update public.ops_heartbeat_expectations set window_hours = null where stream = 'scrape_runs_per_platform';
      raise exception 'PROOF: the per-platform row accepted a NULL window';
    exception when check_violation then null;
    end;
    raise exception '__heartbeat_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__heartbeat_selftest_rollback__' then raise; end if;
  end;
  if to_regclass('public.__hb_selftest2') is not null then raise exception 'PROOF: scratch table not rolled back'; end if;
  raise notice 'PROOF: broken row keeps its open P1 + raises P2; per-platform NULL window rejected; rolled back';
end $$;
