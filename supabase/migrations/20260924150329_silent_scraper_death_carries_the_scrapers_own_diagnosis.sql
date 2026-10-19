-- silent_scraper_death threw away the one piece of evidence that tells a responder WHERE to look.
--
-- The detector reads scrape_runs.ok and scrape_runs.rows_seen and nothing else. The scraper also
-- writes scrape_runs.notes, which is where it records its OWN diagnosis -- and on every platform
-- currently raising this P0, that diagnosis contradicts or refuses the claim the alert makes.
-- Measured 2026-09-24 14:5xZ, all four open P0s, notes from each platform's most recent attempt:
--
--   alsidra       "https://alsidra.com.sa is SUSPENDED by its host (cPanel suspendedpage)
--                  -- source outage, nothing scraped, nothing retired"
--   sadin         "list-fetch failures: http_502=3 | RC-B demoted ok=False: 0-row run
--                  (blocked/empty source?)"
--   aqaralsaudia  "RC-B demoted ok=False: 0-row run (blocked/empty source?)"
--   souq24        "RC-B demoted ok=False: 0-row run (blocked/empty source?)"
--
-- Against which the alert asserted, identically on all four:
--
--   "capture is dead, not merely slow"
--
-- alsidra's scraper KNOWS the host suspended the site and says so in the same row the detector
-- reads. The other three explicitly record UNCERTAINTY -- "blocked/empty source?" -- and the
-- detector converts that unknown into a certainty about Ezhalah's side. That is the owner-locked
-- SOURCE IS TRUTH rule (silent -> NULL, never unknown -> NO) violated in the MONITORING layer, and
-- it is the same defect 20260924001500 landed yesterday for a sibling detector, whose finding
-- applies here verbatim: "a P0 whose remedy field sends every responder down a path that does not
-- work is worse than a P0 with no remedy text."
--
-- The cost is measurable, not theoretical. These four P0s have stood 0.4-15.4 days with no root
-- cause recorded, and ops_incident #234 shows a responder spending a run to reach the conclusion
-- the notes column already contained: "Both fail at FETCH, so neither is an Ezhalah capture bug."
-- The systemic P0 alert_queue_unworked (2 of 1,014 alerts ever acknowledged) is fed by exactly
-- this: findings that name no actionable next step.
--
-- WHAT THIS MIGRATION DOES NOT CHANGE. The raise predicate, the severity, the dedup key, the
-- resolve path and the raised population are byte-identical. A platform that raised before raises
-- now. This is not a loosening: the alert is still correct to fire, because a source outage still
-- means users are served inventory nobody has re-verified. Only the payload changes -- it now
-- carries the evidence that already existed and says honestly what has and has not been measured.
-- mon_raise() refreshes detail on every sweep, so the four open alerts re-arm with the evidence.
--
-- NO INVENTED TAXONOMY. The detector does not classify the cause from the notes text. Four samples
-- is not a classifier, and a WRONG classification is worse than none (AGENTS.md s14/s24). It hands
-- the reader the scraper's own words and tells them to adjudicate against the source.

create or replace function public.mon_detect_silent_scraper_death()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rec record;
  n int := 0;
  live text[] := '{}';
  v_evidence_lost int := 0;
begin
  for rec in
    with ap as (
      select pr.platform, coalesce(pc.expected_hours, 24) as expected_hours
      from public.platform_registry pr
      left join public.platform_cadence pc on pc.platform = pr.platform
      where pr.status = 'active' and pr.kind = 'source'
    ), runs as (
      -- Attribute a run row to its registry platform. A scraper that splits itself into
      -- '<platform>_<something>' runs (aqar_residential, dealapp_recover) must NOT thereby leave
      -- monitoring; ':'-suffixed liveness/cleanup rows are not capture runs and stay excluded.
      select ap.platform, ap.expected_hours, s.ok, s.rows_seen, s.started_at,
             s.notes, s.platform as run_label
      from ap
      join public.scrape_runs s
        on (s.platform = ap.platform or s.platform like ap.platform || '\_%')
      where s.platform !~ ':'
        and s.started_at > now() - interval '30 days'
    ), h as (
      select platform, expected_hours,
             max(started_at) filter (where ok and coalesce(rows_seen, 0) > 0) as last_healthy,
             max(started_at) as last_attempt
      from runs
      group by platform, expected_hours
    ), flagged as (
      select platform, expected_hours, last_healthy, last_attempt,
             greatest(expected_hours * 2, 24) as bar_hours
      from h
      where last_attempt > now() - interval '7 days'   -- still being scheduled; a platform that
                                                       -- stopped being scheduled at all is a
                                                       -- different class (registry/cron detectors)
        and (last_healthy is null
             or last_healthy < now() - (greatest(expected_hours * 2, 24) || ' hours')::interval)
    ), last_row as (
      -- The scraper's own account of the most recent attempt. Same join predicate as `runs` by
      -- construction: it reads FROM runs, so the two cannot drift apart.
      select distinct on (r.platform)
             r.platform, r.notes, r.ok, r.rows_seen, r.run_label
      from runs r
      join flagged f on f.platform = r.platform
      order by r.platform, r.started_at desc
    )
    select f.platform, f.expected_hours, f.last_healthy, f.last_attempt, f.bar_hours,
           l.notes      as last_notes,
           l.ok         as last_ok,
           l.rows_seen  as last_rows_seen,
           l.run_label  as last_run_label
    from flagged f
    left join last_row l on l.platform = f.platform
  loop
    -- Every flagged platform was derived FROM a run row, so one must be findable. If it is not,
    -- the evidence path has broken (someone changed the attribution predicate in one place and not
    -- the other) and this alert has silently gone back to being unactionable. Count it and say so
    -- rather than emitting a payload whose missing evidence reads as "the scraper said nothing".
    if rec.last_run_label is null then
      v_evidence_lost := v_evidence_lost + 1;
    end if;

    live := live || ('silent_scraper_death:' || rec.platform);
    n := n + public.mon_raise('P0', 'silent_scraper_death', rec.platform,
      'silent_scraper_death:' || rec.platform,
      jsonb_build_object(
        'why', 'no attributable scrape run has succeeded with rows within this platform''s own '
            || 'cadence, while runs are still being attempted. WHAT THIS ALERT DOES NOT CLAIM: '
            || 'that the cause is on Ezhalah''s side. This detector measures OUTCOME (no rows), '
            || 'never CAUSE. Read last_attempt_notes below -- the scraper records its own diagnosis '
            || 'there, and on every platform raising this alert on 2026-09-24 it named a SOURCE '
            || 'condition (a host-suspended site, upstream 502s) or explicitly recorded that it '
            || 'could not tell a block from an empty source.',
        'last_attempt_notes',     rec.last_notes,
        'last_attempt_ok',        rec.last_ok,
        'last_attempt_rows_seen', rec.last_rows_seen,
        'last_attempt_run_label', rec.last_run_label,
        'adjudicate', 'Read last_attempt_notes FIRST, then fetch the source yourself before '
            || 'treating this as a capture bug -- a failed fetch and an empty source look '
            || 'identical from the row count alone (AGENTS.md, permanent rule 2026-09-04). If the '
            || 'source is down, this platform''s listings are UNKNOWN, not dead: per '
            || 'docs/ops/LISTING_LIVENESS.md absence from our crawl is a candidate signal and NEVER '
            || 'a verdict. Do NOT deactivate, prune or retire them, and do NOT lower a liveness '
            || 'floor or widen a kill to compensate (s7). Keep this alert open while the inventory '
            || 'is unverified -- that is what it is for.',
        'last_healthy', rec.last_healthy,
        'last_attempt', rec.last_attempt,
        'hours_since_healthy',
          case when rec.last_healthy is null then null
               else round((extract(epoch from (now() - rec.last_healthy)) / 3600.0)::numeric, 1) end,
        'bar_hours', rec.bar_hours,
        'bar_provenance', 'max(2 x expected_hours=' || rec.expected_hours || ', 24)'));
  end loop;

  if v_evidence_lost > 0 then
    n := n + public.mon_raise('P1', 'silent_scraper_death_evidence_lost', 'all',
      'silent_scraper_death_evidence_lost',
      jsonb_build_object(
        'why', 'mon_detect_silent_scraper_death() flagged ' || v_evidence_lost || ' platform(s) '
            || 'but could not recover the scraper''s own last-attempt row for them. A flagged '
            || 'platform is derived FROM a run row, so this is impossible unless the run-attribution '
            || 'predicate has been changed in one CTE and not the other. Until it is repaired, this '
            || 'P0''s payload is back to naming no actionable cause.',
        'platforms_without_evidence', v_evidence_lost));
  else
    perform public.mon_resolve_key('silent_scraper_death_evidence_lost',
                                   'silent_scraper_death_evidence_lost');
  end if;

  -- Resolve on the SAME predicate that raises (s23a). Reached unconditionally: this detector has no
  -- claim-slot early return, so it can never resolve a cohort it did not evaluate.
  perform public.mon_resolve_stale_keys('silent_scraper_death', live);
  return n;
end
$function$;
