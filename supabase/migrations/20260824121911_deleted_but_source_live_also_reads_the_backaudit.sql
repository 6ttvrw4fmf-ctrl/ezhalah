-- mon_detect_deleted_but_source_live() gains a second source: the legacy back-audit.
--
-- It has always read cleanup_deletion_verification — the ENGINE's post-delete spot-check. The
-- 21,371 rows the retired aqar_cleanup path deleted never produced a deletion-log row, so they can
-- never appear there, and a 'live' verdict recovered by the back-audit (barrier 14, --legacy mode
-- of scrapers/common/verify_deletions.py) would have sat in a table with nothing watching it. A
-- proven false deletion has to page, whichever population it came from.
--
-- Both limbs keep the same permanent rule, restated in the payload so it is impossible to miss:
-- a 'live' verdict is NOT authority to auto-restore. The deleted row's other fields are gone, and
-- rebuilding a listing out of one probe is the same guessing the legacy deleter did. A human
-- decides the repair, from source.
--
-- Dedup keys are namespaced per source (`deleted_but_source_live:<id>` for the engine's
-- verification rows, `deleted_but_source_live:backaudit:<id>` for back-audit rows) so the two
-- limbs cannot collide on an id that means something different in each table.

create or replace function public.mon_detect_deleted_but_source_live()
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare rec record; n int := 0;
begin
  for rec in
    select v.id, v.platform, v.source_table, v.listing_id, v.listing_url, v.deleted_at, v.verified_at
    from public.cleanup_deletion_verification v
    where v.verdict = 'live'
      and not exists (
        select 1 from public.alert_event a
        where a.kind = 'deleted_but_source_live'
          and a.dedup_key = 'deleted_but_source_live:' || v.id::text)
  loop
    n := n + public.mon_raise('P0', 'deleted_but_source_live', rec.platform,
      'deleted_but_source_live:' || rec.id::text,
      jsonb_build_object(
        'why', 'A listing this system hard-deleted now serves LIVE content again at its OWN '
             || 'original URL, per an independent post-delete spot-check. Either the pre-delete '
             || 'recheck itself has a bug (repair the recheck logic, not just this row), or the '
             || 'source genuinely re-listed the exact same URL after the delete (rarer, platform-'
             || 'dependent — verify before assuming the benign case).',
        'do_not', 'Do NOT auto-restore the row: the original row and its other fields are gone, '
                || 'and re-inserting from this probe alone would be reconstructing data from a '
                || 'single field (listing_url), which is exactly the guessing this routine forbids. '
                || 'A human must decide the repair.',
        'deletion_log_id', rec.id, 'source_table', rec.source_table, 'listing_id', rec.listing_id,
        'listing_url', rec.listing_url, 'deleted_at', rec.deleted_at, 'verified_at', rec.verified_at));
  end loop;

  -- LIMB 2: the legacy back-audit. Same finding, a population the engine's ledger cannot describe.
  for rec in
    select b.id, b.source_table, b.listing_id, b.ad_number, b.listing_url, b.probed_at,
           b.http_status, b.identity_source
      from public.ops_hard_deleted_listing_backaudit b
     where b.verdict = 'live'
       and not exists (
         select 1 from public.alert_event a
          where a.kind = 'deleted_but_source_live'
            and a.dedup_key = 'deleted_but_source_live:backaudit:' || b.id::text)
  loop
    n := n + public.mon_raise('P0', 'deleted_but_source_live',
      split_part(rec.source_table, '_', 1),
      'deleted_but_source_live:backaudit:' || rec.id::text,
      jsonb_build_object(
        'why', 'A listing the RETIRED aqar_cleanup path hard-deleted (no source re-check, no '
             || 'evidence) is LIVE at the source today. That path deleted on age + strike count '
             || 'alone, so this is the failure mode it was expected to have, now measured on a '
             || 'specific listing rather than inferred.',
        'do_not', 'Do NOT reconstruct the row from this probe. All that survived this deletion is '
                || 'an id and an ad_number; every other field would be invented. Re-ingest it from '
                || 'the source through the normal scraper path, or leave it out — never both '
                || 'halves guessed.',
        'backaudit_id', rec.id, 'source_table', rec.source_table, 'listing_id', rec.listing_id,
        'ad_number', rec.ad_number, 'listing_url', rec.listing_url,
        'identity_source', rec.identity_source,
        'http_status', rec.http_status, 'probed_at', rec.probed_at));
  end loop;

  return n;
end $fn$;