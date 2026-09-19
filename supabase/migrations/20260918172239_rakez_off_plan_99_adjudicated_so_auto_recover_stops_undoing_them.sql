-- ROOT CAUSE of the off-plan resurrection (found 2026-09-18), and the fix.
--
-- The 99 «البيع على الخارطة» rows were withdrawn on 2026-09-14 (20260914181618) and were ACTIVE
-- again by 09-15. The scraper was blamed for three days and was innocent: the veto in
-- scrapers/rakez/run.py is correct and still fires. Proven by EXECUTION, not by reading — map_unit()
-- was run against the real live unit 16938 and the real live project 16055, the latter fetched with
-- the scraper's own paginated `project?per_page=100&page=3&_embed=wp:term,wp:featuredmedia` shape,
-- and returned None. All 7 off-plan projects still carry offer-group 'Off-plan sales'; every unit's
-- acf.unit_project resolves to a project present in en_projects.
--
-- WHAT ACTUALLY REACTIVATED THEM: public.auto_recover_false_inactive(), whose job is to undo
-- inactivations that look like accidents. Its predicate is
--     active = false
--     and coalesce(missing_count,0) = 0
--     and deactivated_at >= now() - recent_window          -- default 24h
--     and not exists (select 1 from ops_adjudicated_listing j
--                      where j.tbl = <t> and j.listing_id = t.id)
-- and the 99 matched every line. They are inactive; missing_count is 0 because they are still
-- published on rakez.sa and the crawl keeps seeing them; deactivated_at was fresh. The only clause
-- that could have protected them is the adjudication register, and the withdrawal never wrote to
-- it. So the job read a deliberate owner decision as an accident and undid it — exactly as designed.
-- Its own comment says so: "An adjudicated row was never struck BECAUSE a decision was recorded
-- about it. It looks identical to a wrongly-flipped row and must never be auto-reactivated
-- (owner, 2026-08-30)."
--
-- THE FIX IS THE MECHANISM THAT ALREADY EXISTS: register the 99 as adjudicated. No new guard, no
-- change to auto_recover_false_inactive() (it is behaving correctly and protects real accidents
-- elsewhere), and no scraper change (nothing was wrong with it).
--
-- ops_adjudicated_listing is a VIEW over ops_adjudicated_retraction and the res/com collision
-- ledger, so the write goes to the retraction ledger — which is what this is: a deliberate,
-- evidence-backed withdrawal.
--
-- GENERAL LESSON, recorded because it is NOT rakez-specific: any deliberate deactivation of a row
-- that is still live at source is undone within 24h unless it is registered here. "Hide this
-- listing" is a TWO-PART act — set active=false AND adjudicate it — and doing only the first half
-- is a silent no-op on a one-day delay.
insert into public.ops_adjudicated_retraction (source_table, listing_id, reason, evidence)
select 'rakez_residential_listings', r.id,
       'off-plan «البيع على الخارطة» — withdrawn from search, KEPT in the table as the seed of a '
       || 'future off-plan feature (owner 2026-09-14 "delete the 99 please"; re-affirmed 2026-09-18 '
       || '"lets keep the 99 but hide them, ill add later off plan"). NOT a false inactivation.',
       jsonb_build_object(
         'project_id', (r.additional_info->>'project_id')::int,
         'owner_decision_at', '2026-09-14',
         'reaffirmed_at', '2026-09-18',
         'withdrawal_migrations', jsonb_build_array('20260914181618','20260918171448'),
         'watched_by', 'mon_detect_rakez_off_plan_resurrection',
         'source_tag', 'offer-group = Off-plan sales / البيع على الخارطة')
  from public.rakez_residential_listings r
 where (r.additional_info->>'project_id')::int in
       (67008, 63096, 66852, 38262, 45815, 35131, 32260, 29683, 29937, 29328, 24426, 17160, 16055)
   and not exists (select 1 from public.ops_adjudicated_retraction j
                    where j.source_table = 'rakez_residential_listings' and j.listing_id = r.id);

insert into public.ops_adjudicated_retraction (source_table, listing_id, reason, evidence)
select 'rakez_commercial_listings', r.id,
       'off-plan «البيع على الخارطة» — withdrawn from search, kept in the table (owner 2026-09-14 / '
       || '2026-09-18). NOT a false inactivation.',
       jsonb_build_object(
         'project_id', (r.additional_info->>'project_id')::int,
         'owner_decision_at', '2026-09-14',
         'reaffirmed_at', '2026-09-18',
         'withdrawal_migrations', jsonb_build_array('20260914181618','20260918171448'),
         'watched_by', 'mon_detect_rakez_off_plan_resurrection')
  from public.rakez_commercial_listings r
 where (r.additional_info->>'project_id')::int in
       (67008, 63096, 66852, 38262, 45815, 35131, 32260, 29683, 29937, 29328, 24426, 17160, 16055)
   and not exists (select 1 from public.ops_adjudicated_retraction j
                    where j.source_table = 'rakez_commercial_listings' and j.listing_id = r.id);

-- PROVE IT by re-running the exact function that broke it, and asserting it now declines.
do $verify$
declare v_adj int; v_recovered int := 0; rec record; v_active int;
begin
  select count(*) into v_adj from public.ops_adjudicated_listing
   where tbl in ('rakez_residential_listings','rakez_commercial_listings');
  if v_adj < 99 then
    raise exception 'only % rakez rows adjudicated — expected at least 99', v_adj;
  end if;

  -- The defect, re-enacted. auto_recover_false_inactive() is precisely what resurrected these rows
  -- on 09-15; it must now recover NOTHING from rakez.
  for rec in select * from public.auto_recover_false_inactive('24 hours'::interval) loop
    if rec.tbl like 'rakez%' then v_recovered := v_recovered + rec.recovered; end if;
  end loop;
  if v_recovered > 0 then
    raise exception 'auto_recover_false_inactive still resurrected % rakez row(s) — the adjudication guard is not binding', v_recovered;
  end if;

  select count(*) into v_active from public.rakez_residential_listings
   where (additional_info->>'project_id')::int in
         (67008,63096,66852,38262,45815,35131,32260,29683,29937,29328,24426,17160,16055)
     and active;
  if v_active > 0 then
    raise exception '% off-plan rows are active again immediately after the guard was added', v_active;
  end if;
end $verify$;