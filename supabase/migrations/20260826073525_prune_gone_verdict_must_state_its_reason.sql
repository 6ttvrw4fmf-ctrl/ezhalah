-- A GONE verdict that cannot say WHY is not evidence.
--
-- 2026-08-24 (§26) made the source's own verdict the only thing that may deactivate a listing on a
-- platform whose discovery index does not enumerate its live catalogue, and
-- mon_detect_prune_kill_without_source_verdict() checks that a GONE row exists for every kill.
-- That check asks "was a verdict recorded?" — never "what did the source actually say?".
--
-- On 2026-08-26 that gap cost a live re-probe of the source. aqarcity's oracle was found mapping
-- "real id whose page we could not parse" to gone: _probe_id() returned one value, 'exists', for
-- BOTH «هذا الإعلان منتهي» (the source's own expired banner, authoritative death) and
-- "application/ld+json" not in r.text (a PARSE condition — a Cloudflare shell, a partial render or
-- a template change, served at HTTP 200 on a perfectly live listing). 254 aqarcity rows were
-- deactivated that day, and NOTHING STORED could say which limb had decided any of them: the
-- evidence rows carried only source_table/ad_number/verdict/oracle, with listing_url '' and note
-- NULL. Establishing that the cohort was in fact correct (55/55 sampled carried the expired banner,
-- 0 false inactivations, nothing restored) required fetching the pages by hand.
--
-- Same shape as the 2026-08-26 alert-delivery blackout, one layer down: CONFIGURED is not
-- DELIVERED, and RECORDED is not EVIDENCED. A barrier that can only see one cause of a failure
-- reports every other cause as health.
--
-- So: on an oracle-required platform, a GONE verdict must state its reason. The scraper side of
-- this ships in the same change — prune_unseen() now accepts (verdict, reason) from an oracle and
-- persists the reason, and writes an evidence row for UNKNOWN/held rows too, which previously left
-- no trace at all and were indistinguishable from "the probe never ran".

create or replace function public.mon_detect_prune_verdict_unevidenced()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record; n int := 0; live_keys text[] := '{}'; bad int; tot int;
  -- Rows probed before the evidencing code shipped carry no note and are grandfathered. The
  -- baseline sits one full crawl cycle after this migration so the merge has a cycle to land: if
  -- the scraper-side fix does NOT reach production, this detector goes red, which is precisely the
  -- outcome wanted (§16: a migration that ran is not a fix that works).
  baseline constant timestamptz := '2026-08-27 12:00:00+00';
begin
  for r in select source_table from public.ops_oracle_required_platform loop
    select
      count(*) filter (where coalesce(btrim(p.note), '') = ''),
      count(*)
      into bad, tot
      from public.ops_stale_inactivation_probe p
     where p.source_table = r.source_table
       and p.verdict = 'GONE'
       and p.oracle like 'prune_unseen.%'
       and p.probed_at >= greatest(baseline, now() - interval '48 hours');

    if bad > 0 then
      live_keys := live_keys || ('prune_verdict_unevidenced:' || r.source_table);
      n := n + public.mon_raise(
        'P2', 'prune_verdict_unevidenced',
        regexp_replace(r.source_table, '_(residential|commercial)_listings$', ''),
        'prune_verdict_unevidenced:' || r.source_table,
        jsonb_build_object(
          'source_table', r.source_table,
          'gone_verdicts_48h', tot,
          'without_stated_reason', bad,
          'why', 'A deactivation on this platform is only legitimate because the SOURCE said the '
              || 'listing is gone — but these GONE verdicts do not record what the source actually '
              || 'said. That makes the kill unfalsifiable from the record: on 2026-08-26 deciding '
              || 'whether 254 aqarcity deactivations were correct required re-fetching the live '
              || 'pages by hand, because the stored evidence could not distinguish the source''s own '
              || 'expired banner from a page the scraper merely failed to parse.',
          'adjudicate', 'Do NOT resolve this by relaxing the check or backfilling a generic note. '
              || 'The oracle in scrapers/<platform>/run.py must return (verdict, reason) and '
              || 'prune_unseen() must persist it — pinned by '
              || 'scrapers/common/tests/test_prune_requires_source_verdict_to_kill.py. A reason that '
              || 'names a PARSE failure rather than source evidence of death is a defect in the '
              || 'oracle itself, not in this barrier (§4/§26: unverifiable means DO NOTHING).'));
    end if;
  end loop;

  -- Resolve on the EVALUATED path only, from the cohort that raises (§23a/§25a: ONE predicate for
  -- both directions — never a second, independently-worded self-heal clause).
  perform public.mon_resolve_stale_keys('prune_verdict_unevidenced', live_keys);
  return n;
end
$function$;

comment on function public.mon_detect_prune_verdict_unevidenced() is
  'P2. On a platform in ops_oracle_required_platform, every GONE verdict from prune_unseen''s '
  'oracle must state the reason the source gave. Added 2026-08-26 after aqarcity was found mapping '
  '"page unparseable" to "gone" while the stored evidence could not show which limb decided a kill. '
  'Grandfathers rows probed before 2026-08-27 12:00 UTC. Measured cost: <15 ms.';

-- ── Roster wiring, in the SAME migration (§11a: a barrier nothing calls is decoration) ───────────
-- Splice one element into the LIVE roster. Re-emitting the whole ~40-entry array from a snapshot
-- would silently drop any detector a concurrent session added (§26).
do $$
declare
  d text;
  anchor constant text := '''mon_detect_prune_kill_without_source_verdict'',';
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if d is null then
    raise exception 'mon_run_all_detectors() not found — roster wiring cannot proceed';
  end if;

  if position('mon_detect_prune_verdict_unevidenced' in d) > 0 then
    raise notice 'already roster-wired; nothing to do';
    return;
  end if;

  if position(anchor in d) = 0 then
    raise exception 'roster anchor % not found in mon_run_all_detectors() — refusing to guess an '
                    'insertion point (a silent no-op here would leave the barrier unreachable)', anchor;
  end if;

  d := replace(d, anchor, anchor || E'\n    ''mon_detect_prune_verdict_unevidenced'',');
  execute d;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'mon_run_all_detectors'
       and pg_get_functiondef(p.oid) like '%mon_detect_prune_verdict_unevidenced%')
  then
    raise exception 'roster wiring did not take effect';
  end if;
end $$;
