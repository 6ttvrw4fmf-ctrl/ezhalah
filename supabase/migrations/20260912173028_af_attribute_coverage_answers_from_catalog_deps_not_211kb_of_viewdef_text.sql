-- ops_af_attribute_coverage() SAT ON THE STATEMENT-TIMEOUT BOUNDARY. THIS MAKES IT CHEAPER, NOT LOOSER.
-- ops_incident #127 (routine-5 surface, executed by routine #10 at the owner's direction, 2026-09-12).
--
-- WHAT WAS WRONG. The function answers one small question — for each searchable platform, is it wired
-- into listing_rich_attrs / listing_extra_attrs, and how many searchable rows does it have — and
-- returns 44 rows. It did that by calling pg_get_viewdef() on BOTH views on every single invocation
-- and substring-searching the reconstructed SQL text. Those two views are enormous:
--
--     listing_rich_attrs   148,778 chars of reconstructed SQL, 1,225 relation dependencies
--     listing_extra_attrs   62,390 chars,                      1,101 relation dependencies
--
-- So each call rebuilt ~211 KB of SQL text from the catalog to run 176 position() tests. MEASURED on
-- production 2026-09-12:
--
--     pg_get_viewdef half      4,434 buffers   (the larger half)
--     count aggregate half     3,305 buffers
--     anon path, end to end    ~2.4-3.0 s for 44 rows
--
-- #127 recorded ~9.8 s / 9,930 buffers on 2026-09-06 and intermittent HTTP 500 to the anon path.
-- Under the concurrent live-check load ops_incident #22 measures (~2.6x the safe envelope) a ~2.7 s
-- floor is exactly how a statement timeout is reached. THE WRONG FIX WOULD HAVE BEEN A BIGGER
-- TIMEOUT: that hides the cost from the monitor and leaves it on every real user of the anon path.
--
-- WHAT THIS CHANGES. Only HOW the membership question is answered. Instead of reconstructing the
-- view SQL and searching its text, it asks the catalog which relations each view's rewrite rule
-- actually depends on — and it resolves ONLY the 88 candidate table names (2 per platform) rather
-- than all 2,326 dependencies. That ordering matters and was measured: resolving every dependency
-- through pg_class first came out at 10,871 buffers, WORSE than the original. The shipped form is:
--
--     4,153 buffers (-46%), 54.7 ms in-database (was 134 ms)
--
-- and the remaining 3,297 buffers are the matview aggregate, which is genuinely cheap (61 ms).
--
-- IDENTICAL RESULTS ARE PROVEN, NOT ASSERTED. The old output is captured BEFORE the replace and
-- differenced against the new output AFTER it, in this same transaction, on every axis: row count,
-- both set directions, and each of in_rich / in_extra / searchable_rows per platform. If any of them
-- disagree this migration RAISES and commits nothing. Verified ahead of time against live
-- production: 44 rows both ways, 0 differences in either direction, 0 disagreements on any column.
--
-- WHY THE DEPENDENCY FORM IS EQUIVALENT, and where it could in principle differ: the old test was
-- "does the literal string '<platform>_residential_listings' appear in the view's SQL text". A table
-- the view really selects from always appears both in the text and in pg_depend, so the two agree on
-- every real case. The text form could additionally match a name that merely APPEARS without being
-- selected from; there is no such case today (proven by the differential above), and the dependency
-- form is the stricter and more honest reading of "is this platform wired into the view".
-- Substring collisions are not a concern either way: '<p>_residential_listings' cannot occur inside
-- another platform's table name, because the platform token is followed immediately by '_'.

do $mig$
declare
  v_old_n int;
  v_new_n int;
  v_missing int;
  v_extra int;
  v_disagree int;
begin
  -- 1. CAPTURE THE OLD ANSWER FIRST. If the function is not there, or answers nothing, stop: a
  --    differential against an empty baseline would pass vacuously and prove nothing.
  create temporary table _cov_old on commit drop as
    select * from public.ops_af_attribute_coverage();
  select count(*) into v_old_n from _cov_old;
  if v_old_n = 0 then
    raise exception 'ops_af_attribute_coverage() returned 0 rows BEFORE the change — refusing to '
      'replace it, because the identical-results proof below would be vacuous';
  end if;

  -- 2. THE REPLACEMENT. Same name, same argument list, same RETURNS TABLE, same volatility, same
  --    SECURITY DEFINER, same search_path — so no new overload can be created and no caller changes.
  create or replace function public.ops_af_attribute_coverage()
    returns table(platform text, in_rich boolean, in_extra boolean, searchable_rows bigint)
    language sql
    stable
    security definer
    set search_path to 'public'
  as $fn$
    WITH searchable AS (
      SELECT split_part(v.source_table,'_',1) AS platform, count(*) AS n
      FROM active_listing_ids_v2 v
      GROUP BY 1
    ),
    -- Resolve ONLY the two candidate table names per platform (88 index lookups), never all 2,326
    -- dependencies. Doing it the other way round measured WORSE than the original.
    cand_oid AS (
      SELECT s.platform, cl.oid AS reloid
      FROM searchable s
      CROSS JOIN LATERAL (VALUES (s.platform||'_residential_listings'),
                                 (s.platform||'_commercial_listings')) t(tname)
      JOIN pg_class cl ON cl.relname = t.tname::name
                      AND cl.relnamespace = 'public'::regnamespace
                      AND cl.relkind IN ('r','v','m','p')
    ),
    -- Which relations does each view's rewrite rule actually depend on.
    deps AS (
      SELECT v.viewname, d.refobjid
      FROM (VALUES ('listing_rich_attrs'),('listing_extra_attrs')) v(viewname)
      JOIN pg_rewrite r ON r.ev_class = ('public.'||v.viewname)::regclass
                       AND r.rulename = '_RETURN'
      JOIN pg_depend d ON d.objid = r.oid
                      AND d.refclassid = 'pg_class'::regclass
    )
    SELECT s.platform,
           EXISTS (SELECT 1 FROM deps dp JOIN cand_oid co ON co.reloid = dp.refobjid
                   WHERE dp.viewname = 'listing_rich_attrs'  AND co.platform = s.platform) AS in_rich,
           EXISTS (SELECT 1 FROM deps dp JOIN cand_oid co ON co.reloid = dp.refobjid
                   WHERE dp.viewname = 'listing_extra_attrs' AND co.platform = s.platform) AS in_extra,
           s.n AS searchable_rows
    FROM searchable s
    ORDER BY s.platform;
  $fn$;

  -- 3. PROVE IDENTICAL RESULTS, in this transaction, on every axis.
  create temporary table _cov_new on commit drop as
    select * from public.ops_af_attribute_coverage();
  select count(*) into v_new_n from _cov_new;

  if v_new_n <> v_old_n then
    raise exception 'row count changed: was %, now % — refusing to commit', v_old_n, v_new_n;
  end if;

  select count(*) into v_missing from (select * from _cov_old except all select * from _cov_new) x;
  select count(*) into v_extra   from (select * from _cov_new except all select * from _cov_old) y;
  if v_missing <> 0 or v_extra <> 0 then
    raise exception 'result set differs: % row(s) only in old, % row(s) only in new — refusing to commit',
      v_missing, v_extra;
  end if;

  select count(*) into v_disagree
    from _cov_old o join _cov_new n using (platform)
   where o.in_rich is distinct from n.in_rich
      or o.in_extra is distinct from n.in_extra
      or o.searchable_rows is distinct from n.searchable_rows;
  if v_disagree <> 0 then
    raise exception 'per-platform columns disagree on % platform(s) — refusing to commit', v_disagree;
  end if;

  raise notice 'ops_af_attribute_coverage(): % rows, identical on every axis (0 missing, 0 extra, 0 column disagreements)',
    v_new_n;
end $mig$;

-- 4. NO SECOND OVERLOAD. A CREATE OR REPLACE with a different argument list would have created a new
--    function instead of replacing this one — the PGRST203 shape AGENTS.md records from the
--    2026-07-16 search outage. Assert there is still exactly one.
do $guard$
declare n int;
begin
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'ops_af_attribute_coverage';
  if n <> 1 then
    raise exception 'expected exactly 1 ops_af_attribute_coverage overload, found %', n;
  end if;
end $guard$;
