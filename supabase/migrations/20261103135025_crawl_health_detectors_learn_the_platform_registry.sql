-- CRAWL-HEALTH DETECTORS LEARN THE PLATFORM REGISTRY (🔧 2026-11-03; fleet lesson ③ of 11-03: a detector must know
-- the rules of what it reads). refresh_coverage paged P1 on sadin (83 active rows, since 09-10) and senan (57, since
-- 10-22): both platforms are 'dormant' in platform_registry — their sites are down (⚡ 11-03: 5 of 150 down) — so «0 %
-- re-seen in 72 h» is the intended state, not a crawler failure; the detector read only platform_cadence.is_active.
-- rows_collapse paged P1 on snam (dormant) and on wasalt_enrich_ar_residential (registry kind 'internal': an enrich
-- QUEUE whose row count is work left, not a capture — the misread ⚡ fixed for silent_partial_success in
-- 20261103052107). Both detectors now skip a platform the registry marks dormant or not a source; their own
-- stale-key paths close those four alerts when they run below. haraj (5.8 % of 16,007 re-seen) and superoffice (24 a
-- run against the old site's median) stay raised: real crawl-health facts. In-place edits of the live functions,
-- raising if the expected text is absent.
do $mig$
declare
  d text := pg_get_functiondef('public.mon_detect_refresh_coverage()'::regprocedure);
  old_ constant text := $o$pc.is_active = false) then
      continue;
    end if;$o$;
  new_ constant text := $n$pc.is_active = false) then
      continue;
    end if;
    -- a dormant or non-source platform (platform_registry) is skipped on purpose: nothing crawls it (🔧 2026-11-03)
    if exists (select 1 from public.platform_registry pr
               where pr.platform = rec.p and (pr.status = 'dormant' or pr.kind <> 'source')) then
      continue;
    end if;$n$;
begin
  if position(old_ in d) = 0 then raise exception 'mon_detect_refresh_coverage: the cadence guard was not found — read the live function first'; end if;
  execute replace(d, old_, new_);
  if position($p$pr.status = 'dormant'$p$ in pg_get_functiondef('public.mon_detect_refresh_coverage()'::regprocedure)) = 0 then
    raise exception 'mon_detect_refresh_coverage: the registry guard did not land';
  end if;
end
$mig$;

do $mig$
declare
  d text := pg_get_functiondef('public.mon_detect_rows_collapse()'::regprocedure);
  old_ constant text := $o$     where b.days >= 7$o$;
  new_ constant text := $n$     where b.days >= 7
       -- a dormant or non-source platform (platform_registry) is skipped on purpose (🔧 2026-11-03)
       and not exists (select 1 from public.platform_registry pr
                        where pr.platform = c.platform and (pr.status = 'dormant' or pr.kind <> 'source'))$n$;
begin
  if position(old_ in d) = 0 then raise exception 'mon_detect_rows_collapse: the baseline guard was not found — read the live function first'; end if;
  execute replace(d, old_, new_);
  if position($p$pr.status = 'dormant'$p$ in pg_get_functiondef('public.mon_detect_rows_collapse()'::regprocedure)) = 0 then
    raise exception 'mon_detect_rows_collapse: the registry guard did not land';
  end if;
end
$mig$;

-- Proof at apply time: each detector's own evaluated path closes the dormant/internal keys and keeps the real ones.
select count(*) as still_raised from public.mon_detect_refresh_coverage();
select public.mon_detect_rows_collapse() as newly_raised;
