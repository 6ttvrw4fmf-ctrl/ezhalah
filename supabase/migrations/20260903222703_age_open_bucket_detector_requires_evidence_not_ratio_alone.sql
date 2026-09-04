-- Correct the open-bucket detector shipped minutes ago: a RATIO IS NOT EVIDENCE (2026-09-03).
--
-- WHAT WENT WRONG. The first version fired on distribution shape alone (>=20 rows at age 11 and
-- >= 5x the count at age 10). muktamel deserves it — its page literally renders «عمر العقار +10 سنة»
-- while the row stores 11. But sanadak fired too (residential 133 vs 23 = 5.8x, commercial 28 vs 0),
-- and sanadak is NOT defective: a live re-probe of a stored-11 listing shows its RSC payload
-- publishes buildingAge = 11 as a plain integer, and NO open-bucket form («+10», «10+», «أكثر من»)
-- appears anywhere on the page. Its 11s are real values that simply cluster.
--
-- So the heuristic was accusing a clean source of fabricating data — the same class of error the
-- detector exists to prevent, pointed the other way. A spike is a REASON TO PROBE, never a verdict.
--
-- THE FIX, in two parts:
--   1. A source whose 11-spike has been probed and cleared carries 'BUCKET-CLEARED' in its registry
--      note (with the probe), and the detector skips it. That reuses the registry's existing
--      evidence discipline instead of inventing a second one, and it cannot be satisfied by opinion:
--      the marker sits next to the probe that earned it.
--   2. Wording is now advisory — "probe the source" — because the ratio alone cannot distinguish a
--      bucket from genuine clustering. The P2 remains, so it is triaged, but it no longer asserts a
--      defect it has not established.
--
-- Also fixes a real bug in v1: it only resolved keys for sources still in the trusted set, so a
-- source leaving that set orphaned its alert forever (observed — 3 open alerts survived the
-- mutation revert). mon_resolve_stale_keys now closes every key not raised this pass.

update public.age_source_registry
set note = note || '  BUCKET-CLEARED 2026-09-03: the age-11 spike (res 133 vs 23 tens; com 28 vs 0) '
                || 'was probed, not assumed — listing 7201059139 (stored 11) publishes buildingAge=11 '
                || 'as a plain integer in its RSC payload and NO open-bucket form («+10», «10+», '
                || '«أكثر من») appears anywhere on the page. Genuine clustering, not a bucket.',
    updated_at = now()
where source_table in ('sanadak_residential_listings','sanadak_commercial_listings');

create or replace function public.mon_detect_age_open_bucket_stored_as_precise()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r         record;
  raised    integer := 0;
  n10       bigint;
  n11       bigint;
  live_keys text[] := '{}';
  k         text;
begin
  for r in
    select source_table, coalesce(note, '') as note
    from public.age_source_registry
    where trusted is true and strategy = 'canonical_column'
    order by source_table
  loop
    -- Probed and cleared: the spike is genuine clustering, evidenced in the registry note.
    if position('BUCKET-CLEARED' in r.note) > 0 then
      continue;
    end if;

    begin
      execute format(
        'select count(*) filter (where property_age = 10), count(*) filter (where property_age = 11) '
        || 'from public.%I where active', r.source_table) into n10, n11;
    exception when undefined_table or undefined_column then
      continue;
    end;

    if n11 >= 20 and n11 >= 5 * greatest(n10, 1) then
      k := 'age_open_bucket_stored_as_precise:' || r.source_table;
      live_keys := live_keys || k;
      raised := raised + public.mon_raise(
        'P2',
        'age_open_bucket_stored_as_precise',
        split_part(r.source_table, '_', 1),
        k,
        jsonb_build_object(
          'source_table', r.source_table, 'age_11', n11, 'age_10', n10,
          'ratio', round(n11::numeric / greatest(n10, 1), 1),
          'means', 'POSSIBLE open-ended "+10" bucket stored as a precise 11. A ratio is a reason to '
                   || 'probe, NOT proof — genuine clustering looks identical from here.',
          'do', 'open a stored-11 listing on the source. If it renders «+10»/«10+»/«أكثر من», map the '
                || 'bucket to NULL (or a documented min-bound) in the scraper. If it publishes a '
                || 'plain integer, append BUCKET-CLEARED plus the probe to the age_source_registry '
                || 'note and this stops firing.'));
    end if;
  end loop;

  -- Close every key not raised this pass, including sources that left the trusted set entirely.
  perform public.mon_resolve_stale_keys('age_open_bucket_stored_as_precise', live_keys);
  return raised;
end
$fn$;

comment on function public.mon_detect_age_open_bucket_stored_as_precise() is
  'Advisory: flags a TRUSTED canonical_column age source whose distribution carries the open-bucket '
  'signature (spike at 11, almost no 10s) and that has NOT been probe-cleared. Born from muktamel '
  '(«+10 سنة» stored as 11, 2026-09-03); sanadak was cleared by probe after v1 false-positived it. '
  'A ratio is a reason to probe, never a verdict.';

revoke all on function public.mon_detect_age_open_bucket_stored_as_precise() from public;
grant execute on function public.mon_detect_age_open_bucket_stored_as_precise() to service_role;

select public.mon_detect_age_open_bucket_stored_as_precise() as raised_now,
       (select count(*) from alert_event
         where kind = 'age_open_bucket_stored_as_precise' and resolved_at is null) as still_open;
