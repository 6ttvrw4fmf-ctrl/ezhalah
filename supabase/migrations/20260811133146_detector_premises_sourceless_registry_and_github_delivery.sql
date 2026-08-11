-- Two detector premise updates following the 2026-08-11 rent-period repair + alert-delivery launch.
-- Both are NEEDLE-EDITS spliced into the LIVE pg_get_functiondef body (never a pasted stale copy —
-- the roster-loss postmortem rule), and both fail loudly if the needle is not found.

-- A GitHub-issues delivery channel now exists (.github/workflows/alert-dispatch.yml, PR#459):
-- record it where mon_detect_alert_delivery can see it.
insert into mon_config(key, value) values ('github_issue_delivery','enabled')
on conflict (key) do update set value = excluded.value;

do $$
declare def text; new_def text;
begin
  -- 1. mon_detect_rent_period_unreachable: honest-NULL periods on platforms whose source publishes
  --    no period (ops_rent_period_sourceless, audit 2026-08-11) are recorded facts, not defects.
  --    The detector's own guidance asked for exactly this: "confirm the source genuinely publishes
  --    no period and record it". aqar stub-capture rows + october (and any NEW platform) still page.
  def := pg_get_functiondef('public.mon_detect_rent_period_unreachable()'::regprocedure);
  if def not like '%ops_rent_period_sourceless%' then
    new_def := replace(def,
      $n$and (price_annual is not null or price_total is not null)$n$,
      $r$and platform not in (select platform from public.ops_rent_period_sourceless)
      and (price_annual is not null or price_total is not null)$r$);
    if new_def = def then
      raise exception 'needle not found in mon_detect_rent_period_unreachable — live body changed; re-derive the edit';
    end if;
    execute new_def;
  end if;

  -- 2. mon_detect_alert_delivery: delivery is no longer unconfigured — the GitHub-issues channel
  --    delivers undispatched P1/P2 alerts twice hourly. Keep alarming if that marker ever goes away.
  def := pg_get_functiondef('public.mon_detect_alert_delivery()'::regprocedure);
  if def not like '%github_issue_delivery%' then
    new_def := replace(def,
      $n$if v_open > 0 and coalesce(v_hook,'') = '' and v_channels = 0 then$n$,
      $r$if v_open > 0 and coalesce(v_hook,'') = '' and v_channels = 0
     and coalesce((select value from public.mon_config where key = 'github_issue_delivery'),'') <> 'enabled' then$r$);
    if new_def = def then
      raise exception 'needle not found in mon_detect_alert_delivery — live body changed; re-derive the edit';
    end if;
    execute new_def;
  end if;
end $$;
