-- Register 'scraper:<site>' as a KNOWN family of distinct lock identities (2026-09-27).
--
-- docs/ops/SCRAPING_ENGINEER.md rule 6: the Scraping Engineer takes one lock per site before fixing
-- it ('scraper:aqar', 'scraper:wasalt', ...) so the nightly sweep and an instant wake-up never make
-- competing fixes to the same scraper. A genuinely separate resource from the production deploy
-- lock: deploy_lock_canonical() leaves every 'scraper:' name distinct, because its alphanumeric
-- skeleton starts with 'scraper', never 'prod'. Without this, mon_detect_deploy_lock_misuse would
-- raise each site lock as an unknown identity: pure noise.
--
-- NEEDLE EDIT off the LIVE definition (RPC full-body-replace revert hazard), same pattern as
-- 20260830001500: anchor on the last known identity and add beside it. Idempotent; refuses to guess
-- if the anchor is gone.
do $do$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_deploy_lock_misuse';

  if def is null then raise exception 'mon_detect_deploy_lock_misuse not found'; end if;
  if position('scraper:%' in def) > 0 then
    raise notice 'scraper:<site> already registered - no-op'; return;
  end if;
  if position('''agent-edge-surface'');' in def) = 0 then
    raise exception 'anchor ''agent-edge-surface''); missing - refusing to guess an insert point';
  end if;

  def := replace(def, '''agent-edge-surface'');',
                 '''agent-edge-surface'')' || E'\n' || '     and lock_name not like ''scraper:%'';');
  execute def;
end
$do$;

-- Apply-time proof: a scraper site lock is known, anything else still counts as unknown.
do $verify$
declare def text;
begin
  select pg_get_functiondef('public.mon_detect_deploy_lock_misuse'::regproc) into def;
  if position('lock_name not like ''scraper:%''' in def) = 0 then
    raise exception 'scraper:%% exclusion did not land';
  end if;
  if position('''production'', ''gathern_liveness_apply'', ''agent-edge-surface''' in def) = 0 then
    raise exception 'the existing known identities were lost';
  end if;
  if public.deploy_lock_canonical('scraper:prod') <> 'scraper:prod' then
    raise exception 'a scraper: lock name folded into the production lock';
  end if;
end
$verify$;
