-- raghdan: turn on drain mode so its standing 30-day backlog can be deleted in capped, re-checked
-- batches (owner, 2026-09-28: «remove, hide, then delete for everything»). set_platform_retention()
-- only flips `enabled`, so this is the one data change it cannot make.
--
-- Why drain and not a bigger cap: 158 of raghdan's 645 rows (24.5%) have been hidden 30+ days with 3
-- strikes. That is over the 10% mass-inactivation guard (max_eligible_frac), so every run aborts and
-- the backlog can never drain. drain_backlog keeps every guard: each row is re-checked at its own URL
-- before deletion, known-live controls open and close the run, a spike over 2x the last run still
-- aborts, and max_delete_per_run (300) is the batch. No cap or threshold is raised.
--
-- Evidence the backlog is dead, 2026-09-29 01:25 UTC: all 158 eligible rows re-read through the
-- cleanup's own probe (cleanup._probe + verdict_detail, redirects not followed on raghdan.sa):
-- 158/158 HTTP 404, 0 live, 0 unknown. Known-live controls in the same session: 200 at their own URL.
--
-- Deletion stays OFF (enabled=false) here. It is switched on only by set_platform_retention() after a
-- clean dry run.
insert into public.platform_retention_policy (platform, enabled, max_delete_per_run, drain_backlog, note)
values ('raghdan', false, 300, true,
        '[2026-09-29 UTC] drain_backlog ON (migration): 158 hidden 30+ days = 24.5% of 645, over the 10% '
        'guard. Source re-check 2026-09-29: 158/158 HTTP 404, 0 live. Every row is re-checked before '
        'deletion; deletion itself is switched on only via set_platform_retention.')
on conflict (platform) do update
   set drain_backlog = true,
       note = concat_ws(E'\n', nullif(platform_retention_policy.note, ''), excluded.note);

do $verify$
begin
  if not exists (select 1 from public.platform_retention_policy
                  where platform = 'raghdan' and drain_backlog) then
    raise exception 'raghdan drain_backlog was not set';
  end if;
end $verify$;
