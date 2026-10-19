-- deleted_but_source_live gains the disposition its two open gathern alerts actually need: the
-- deletion was right and the POST-delete check misread the page. verify_deletions shares
-- cleanup._probe, which followed gathern's 307 -> /ar?error=500 for a removed unit and read the
-- home page's 200 as live (fixed by cleanup._landed_on_home). Evidence, 2026-10-05 ~11:50 UTC,
-- from a second network, interleaved with live controls (3 of 4 answered 200 with no redirect):
-- verification 793 (gathern unit 135509) and 794 (unit 260016) both answer 404 «الصفحة غير موجودة»
-- to gathern's own session, and 200 (an identical 223,412-byte home page) to cleanup._probe.
set local lock_timeout = '5s';
alter table public.ops_deleted_but_source_live_adjudication
  drop constraint ops_deleted_but_source_live_adjudication_disposition_check,
  add constraint ops_deleted_but_source_live_adjudication_disposition_check check (disposition = any (array[
    'source_relisted_after_valid_delete', 'recheck_bug_confirmed', 're_ingested_by_scraper',
    'owner_decision_required', 'post_delete_check_false_live']));

insert into public.ops_deleted_but_source_live_adjudication (scope, ref_id, disposition, evidence, adjudicated_by)
select 'verification', v.id, 'post_delete_check_false_live',
       'gathern ' || v.listing_url || ' answers 404 «الصفحة غير موجودة» to gathern''s own session from a second '
       || 'network on 2026-10-05 ~11:50 UTC (live controls 200, no redirect); verify_deletions'' 200 was '
       || 'cleanup._probe following 307 -> /ar?error=500 to the home page. The deletion was correct.',
       'lifecycle-engineer 2026-10-05'
from public.cleanup_deletion_verification v
where v.id in (793, 794) and v.verdict = 'live'
  and not exists (select 1 from public.ops_deleted_but_source_live_adjudication j
                  where j.scope = 'verification' and j.ref_id = v.id);