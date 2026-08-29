-- Register 'agent-edge-surface' as a KNOWN distinct lock identity (owner ruling 2026-08-29).
--
-- MIRROR of the migration applied to production (migration-mirror rule: a prod migration must have a
-- matching git file making the SAME change; the applier owns it).
--
-- Single-writer ownership of supabase/functions/agent/index.ts. A genuinely separate resource: it
-- guards who may EDIT that ~113KB function, not who may deploy, so claiming it must never block a
-- production deploy. deploy_lock_canonical() already leaves it distinct because it does not start
-- with 'prod'. Without this, mon_detect_deploy_lock_misuse raises it as an unknown identity every
-- time a session claims the surface — an alert that is pure noise, and noise is how a real alert
-- gets ignored.
--
-- NEEDLE EDIT off the LIVE definition (RPC full-body-replace revert hazard): anchor on the existing
-- known identity and add beside it. Idempotent; refuses to guess if the anchor is gone.
do $do$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_deploy_lock_misuse';

  if def is null then raise exception 'mon_detect_deploy_lock_misuse not found'; end if;
  if position('agent-edge-surface' in def) > 0 then
    raise notice 'agent-edge-surface already registered - no-op'; return;
  end if;
  if position('gathern_liveness_apply' in def) = 0 then
    raise exception 'anchor gathern_liveness_apply missing - refusing to guess an insert point';
  end if;

  def := replace(def, '''gathern_liveness_apply''', '''gathern_liveness_apply'', ''agent-edge-surface''');
  execute def;
end
$do$;
