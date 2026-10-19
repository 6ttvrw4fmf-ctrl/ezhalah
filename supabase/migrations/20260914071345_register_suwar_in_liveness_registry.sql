-- سوار joins the liveness registry (owner-approved 2026-09-14). CRAWL_PRESENCE_ONLY, the same tier
-- as every sibling WordPress office catalogue: the full feed is re-read each run, so absence only
-- SELECTS candidates, and scrapers/suwar/run.py::_verify_gone gives each at-grace row a direct
-- confirm before prune_unseen may deactivate it.
--
-- Control-validated live before writing this, against the platform's real retirement behaviour —
-- it HARD-DELETES rather than flipping a status: id 22413 (live) → HTTP 200 status=publish;
-- id 22400 (absent from the feed) and never-existing id 999999 → HTTP 404 rest_post_invalid_id.
--
-- This source ALSO states availability in its own markup (<span class="status">غير متاح</span>, 63
-- of 167 at onboarding). That is SOURCE-STATED retirement and deactivates through the scraper, not
-- through this tier — the two are independent and neither one can resurrect the other's decision.
insert into public.ops_liveness_registry (platform, strategy, sla_hours, grace)
values ('suwar','CRAWL_PRESENCE_ONLY',168,3)
on conflict (platform) do update
  set strategy = excluded.strategy, sla_hours = excluded.sla_hours, grace = excluded.grace;

do $verify$
declare v_strategy text; v_n int;
begin
  select strategy into strict v_strategy from public.ops_liveness_registry where platform='suwar';
  if v_strategy <> 'CRAWL_PRESENCE_ONLY' then
    raise exception 'suwar landed on the wrong strategy: %', v_strategy;
  end if;
  -- the registry must stay a superset of what the scrapers actually run
  select count(*) into v_n from public.ops_liveness_registry;
  if v_n < 47 then
    raise exception 'liveness registry shrank to % rows — refusing', v_n;
  end if;
end $verify$;