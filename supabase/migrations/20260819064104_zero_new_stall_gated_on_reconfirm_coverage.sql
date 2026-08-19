-- Senior Production Engineer run #30 (2026-08-19).
-- mon_detect_zero_new_stall fired P1 whenever a platform produced >=10 new listings in the prior
-- 14 days and 0 in the last 4. On small full-crawl platforms (aqargate, aqaratikom, sadin, satel,
-- eaqartabuk, abeea) that is indistinguishable from ordinary market quiet: 4 zero-days out of a
-- ~1/day arrival rate is statistical noise, not a stall. Historically it fired on exactly those
-- platforms (prior 12-25) plus one genuinely larger case (aqarmonthly, prior 106). A P1 that cries
-- wolf on demonstrably healthy scrapers is the alert-fatigue failure mode AGENTS.md warns about.
--
-- The distinguishing evidence is re-confirmation COVERAGE. If the scraper re-listed the entire live
-- inventory this cycle (coverage ~1.0) and found no new ads, there ARE no new ads - a full re-list
-- that surfaces nothing new is proof of a quiet source, not a broken one. If coverage is partial
-- (<0.8) the scraper has NOT seen the whole source, so zero-new might be hiding undiscovered ads
-- behind a pagination/coverage break - that still fires. Measured live 2026-08-19: every small
-- full-crawl platform sits at coverage 1.000; the platforms that sit below 0.8 (souq24 0.18,
-- dealapp 0.59, gathern 0.71, aqarmonthly 0.76) are exactly the ones whose zero-new we still want
-- to hear about. wasalt (0.96, enumerated liveness) is the only large platform above the line and
-- never appears in the zero-new history.

-- Coverage helper: fraction of a platform's ACTIVE rows (across all its *_listings tables) whose
-- last_seen_at (the liveness timestamp, NOT scraped_at which is first-seen) is within p_days.
create or replace function public._ops_zero_new_reconfirm_cov(p_platform text, p_days int)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare t record; act bigint := 0; seen bigint := 0; a bigint; s bigint;
begin
  for t in
    select tb.table_name tn from information_schema.tables tb
    where tb.table_schema='public' and tb.table_name like p_platform||'\_%\_listings'
      and tb.table_type='BASE TABLE'
      and exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=tb.table_name and c.column_name='active')
      and exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=tb.table_name and c.column_name='last_seen_at')
  loop
    execute format('select count(*) filter (where active), count(*) filter (where active and last_seen_at > now() - ($1||'' days'')::interval) from public.%I', t.tn)
      using p_days into a, s;
    act := act + coalesce(a,0);
    seen := seen + coalesce(s,0);
  end loop;
  if act = 0 then return null; end if;           -- no active inventory: coverage is undefined, not 0
  return round(seen::numeric / act, 3);
end
$function$;

create or replace function public.mon_detect_zero_new_stall()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare rec record; n int := 0; v_cov numeric; v_fire boolean;
begin
  for rec in
    select d.platform,
           sum(d.new_listings) filter (where d.day >  current_date - 4) new_recent,
           sum(d.new_listings) filter (where d.day between current_date - 18 and current_date - 4) new_prior
    from public.crawl_stats_platform_daily d
    join public.platform_registry pr on pr.platform=d.platform and pr.status='active' and pr.kind='source'
    group by d.platform
  loop
    if coalesce(rec.new_prior,0) >= 10 and coalesce(rec.new_recent,0) = 0 then
      v_cov := public._ops_zero_new_reconfirm_cov(rec.platform, 3);
      -- Full re-list (coverage >= 0.8, or undefined because the platform has no active rows to
      -- re-confirm) that finds nothing new = quiet source, not a stall. Partial re-list = still fire.
      v_fire := (coalesce(v_cov, 1) < 0.80);
      if v_fire then
        n := n + public.mon_raise('P1','zero_new_stall', rec.platform,
          'zero_new_stall:'||rec.platform,
          jsonb_build_object('new_prior_14d', rec.new_prior, 'new_recent_4d', 0,
            'reconfirm_cov_3d', v_cov,
            'why','produced new listings before but 0 in the last 4 days AND the scraper is NOT '
                  'fully re-listing the live source (re-confirmation coverage < 0.8), so undiscovered '
                  'new listings may be stranded behind a pagination/coverage break — discovery stalled.',
            'do_not','Do NOT raise the >=10 floor to silence a quiet SMALL platform — that is what '
                     'the coverage gate is for. A full re-list (cov ~1.0) finding nothing new is a '
                     'quiet source, correctly suppressed here.'));
      else
        -- zero-new but the whole inventory was re-confirmed: healthy scraper, quiet market. Clear.
        perform public.mon_resolve('zero_new_stall', rec.platform);
      end if;
    elsif coalesce(rec.new_recent,0) > 0 then
      perform public.mon_resolve('zero_new_stall', rec.platform);
    end if;
  end loop;
  return n;
end $function$;
