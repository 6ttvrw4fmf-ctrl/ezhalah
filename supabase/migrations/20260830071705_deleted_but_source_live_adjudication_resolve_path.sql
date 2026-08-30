-- Data Integrity run 2026-08-30.
-- §23a: a barrier must be able to go GREEN, not only red.
--
-- mon_detect_deleted_but_source_live() is the roster's second P0. It could OPEN an alert and
-- never CLOSE one: neither limb called any resolver, so mon_detect_unresolvable_alert_kinds()
-- correctly raised unresolvable_alert_kind:deleted_but_source_live the first time this P0 ever
-- fired (2026-08-30 05:29, gathern verification row 73). A P0 that can only accumulate corrupts
-- the open_alerts signal §11a depends on.
--
-- The condition here is a HISTORICAL fact ("a listing we hard-deleted serves live content at its
-- own URL"), and SQL cannot re-check it — SQL cannot fetch a page (§26). So the honest close-out
-- is ADJUDICATION: a recorded disposition with real evidence, exactly the discipline
-- ops_price_source_verified uses. The gate is not weakened — an un-adjudicated finding still
-- raises P0 and stays open until someone writes down what they proved.
--
-- The live key set is derived from the RAISING COHORT (verdict='live' AND not adjudicated),
-- NOT from the rows that pass the "no alert exists yet" guard. Deriving it from the latter is
-- the §25a insta-resolve bug: the first raise would remove the row from its own live set and
-- resolve the alert in the same transaction it created it.

create table if not exists public.ops_deleted_but_source_live_adjudication (
  id              bigserial primary key,
  scope           text        not null check (scope in ('verification','backaudit')),
  ref_id          bigint      not null,
  disposition     text        not null check (disposition in (
                    'source_relisted_after_valid_delete',  -- delete was evidence-backed; source republished the URL later
                    'recheck_bug_confirmed',               -- the pre-delete recheck was wrong; root cause fixed separately
                    're_ingested_by_scraper',              -- the normal scraper path has since recovered the listing
                    'owner_decision_required')),           -- parked for the owner; stays visible, never silently closed
  evidence        text        not null check (length(btrim(evidence)) >= 40),
  adjudicated_by  text        not null check (length(btrim(adjudicated_by)) > 0),
  adjudicated_at  timestamptz not null default now(),
  unique (scope, ref_id)
);

comment on table public.ops_deleted_but_source_live_adjudication is
  'Close-out ledger for the deleted_but_source_live P0. A row here is the ONLY thing that lets '
  'mon_detect_deleted_but_source_live() resolve that finding''s alert. evidence must be a real '
  'sentence (>=40 chars) naming what was probed and what it proved — this is deliberately not '
  'bulk-insertable on a hunch. Adjudicating is NOT restoring: reconstructing a hard-deleted row '
  'from a probe remains forbidden (the detector''s own do_not payload).';

create or replace function public.mon_detect_deleted_but_source_live()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare rec record; n int := 0; v_live_keys text[] := '{}';
begin
  -- LIMB 1 live key set: the cohort that may raise, independent of whether an alert already
  -- exists for it. (§25a: raise and resolve must share ONE predicate.)
  select coalesce(array_agg('deleted_but_source_live:' || v.id::text), '{}')
    into v_live_keys
    from public.cleanup_deletion_verification v
   where v.verdict = 'live'
     and not exists (select 1 from public.ops_deleted_but_source_live_adjudication j
                      where j.scope = 'verification' and j.ref_id = v.id);

  for rec in
    select v.id, v.platform, v.source_table, v.listing_id, v.listing_url, v.deleted_at, v.verified_at
    from public.cleanup_deletion_verification v
    where v.verdict = 'live'
      and not exists (select 1 from public.ops_deleted_but_source_live_adjudication j
                       where j.scope = 'verification' and j.ref_id = v.id)
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
        'close_out', 'This alert clears ONLY via a row in ops_deleted_but_source_live_adjudication '
                || '(scope=verification, ref_id=' || rec.id::text || ') carrying a disposition and '
                || 'real evidence. SQL cannot re-probe a URL, so there is no automatic self-heal.',
        'deletion_log_id', rec.id, 'source_table', rec.source_table, 'listing_id', rec.listing_id,
        'listing_url', rec.listing_url, 'deleted_at', rec.deleted_at, 'verified_at', rec.verified_at));
  end loop;

  -- LIMB 2: the legacy back-audit. Same finding, a population the engine's ledger cannot describe.
  v_live_keys := v_live_keys || (
    select coalesce(array_agg('deleted_but_source_live:backaudit:' || b.id::text), '{}')
      from public.ops_hard_deleted_listing_backaudit b
     where b.verdict = 'live'
       and not exists (select 1 from public.ops_deleted_but_source_live_adjudication j
                        where j.scope = 'backaudit' and j.ref_id = b.id));

  for rec in
    select b.id, b.source_table, b.listing_id, b.ad_number, b.listing_url, b.probed_at,
           b.http_status, b.identity_source
      from public.ops_hard_deleted_listing_backaudit b
     where b.verdict = 'live'
       and not exists (select 1 from public.ops_deleted_but_source_live_adjudication j
                        where j.scope = 'backaudit' and j.ref_id = b.id)
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
        'close_out', 'This alert clears ONLY via a row in ops_deleted_but_source_live_adjudication '
                || '(scope=backaudit, ref_id=' || rec.id::text || ') carrying a disposition and '
                || 'real evidence. SQL cannot re-probe a URL, so there is no automatic self-heal.',
        'backaudit_id', rec.id, 'source_table', rec.source_table, 'listing_id', rec.listing_id,
        'ad_number', rec.ad_number, 'listing_url', rec.listing_url,
        'identity_source', rec.identity_source,
        'http_status', rec.http_status, 'probed_at', rec.probed_at));
  end loop;

  -- EVALUATED PATH ONLY (there is no early return above): clear any key no longer in the cohort,
  -- i.e. adjudicated, or its verification/backaudit row no longer reads 'live'.
  perform public.mon_resolve_stale_keys('deleted_but_source_live', v_live_keys);

  return n;
end $function$;

comment on function public.mon_detect_deleted_but_source_live() is
  'P0. A hard-deleted listing serving live content at its own URL. Resolves ONLY through '
  'ops_deleted_but_source_live_adjudication — SQL cannot re-probe a URL (§26), so the close-out '
  'is a recorded disposition + evidence, never an automatic self-heal. Live key set is derived '
  'from the raising cohort, not from the not-exists-alert guard (§25a insta-resolve trap).';