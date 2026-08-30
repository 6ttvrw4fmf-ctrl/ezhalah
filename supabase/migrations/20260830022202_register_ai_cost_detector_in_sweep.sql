-- Register mon_detect_ai_cost_health() in the twice-hourly detector sweep.
--
-- MIRROR of the migration applied to production on 2026-08-29 (migration-mirror rule: a prod
-- migration must have a matching git file making the SAME change; the applier owns it).
--
-- NEEDLE EDIT, not a full-body replace — same reasoning as
-- 20260829201500_register_agent_health_detector_in_sweep.sql: mon_run_all_detectors() holds its
-- detector list as a hardcoded `fns text[]`, and rewriting the whole function from a hand-authored
-- copy is how a concurrent registration gets silently reverted (memory: RPC full-body-replace
-- revert hazard). Read the LIVE definition, insert one entry beside an existing anchor, re-execute.
-- Idempotent, and it REFUSES to guess if the anchor is gone rather than appending blind.
do $do$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if def is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('mon_detect_ai_cost_health' in def) > 0 then
    raise notice 'mon_detect_ai_cost_health already registered - no-op'; return;
  end if;
  if position('''mon_detect_agent_health''' in def) = 0 then
    raise exception 'anchor mon_detect_agent_health missing - refusing to guess an insert point';
  end if;

  -- Placed next to mon_detect_agent_health deliberately: they are the two agent-facing detectors and
  -- read as a pair ("is the AI alive" / "what is the AI costing").
  def := replace(def,
    '''mon_detect_agent_health'',',
    '''mon_detect_agent_health'',' || chr(10) || '    ''mon_detect_ai_cost_health'',');

  execute def;
end
$do$;
