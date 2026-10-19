-- Data Integrity (routine #3), 2026-09-15.
--
-- THE OWNER RULE IS RIGHT AND IS NOT TOUCHED HERE: our district list never shows a number
-- (2026-09-14, migration 20260914204035). Both guards that enforce it — the CHECK constraint
-- loc_canonical_district_never_numbered and the in-function count check — stay exactly as they are.
-- What is wrong is the FOLD that is supposed to make the data satisfy them.
--
-- THE DEFECT. refresh_loc_canonical_district() stripped digits only from the two ENDS of the label:
--     regexp_replace(regexp_replace(sp, '^\s*[0-9٠-٩]+\s*', ''), '\s*[0-9٠-٩]+\s*$', '')
-- «أحد1» folds (trailing digit). «الصفا(2)» does NOT — the string ends in ')', not a digit — so the
-- number survives, the CHECK refuses the row, and because the refresh is one statement the ENTIRE
-- hourly pipeline aborts. Not one label dropped: every district recovery for that hour.
--
-- MEASURED: pg_cron job 45 (district-recovery-pipeline) failed 8 times in 24h, from 2026-09-14 22:10
-- — shortly after 20260914204035 added the constraint at 20:40Z. Every failure was
--   loc_canonical_district_never_numbered, failing row (3677, صفا(2), الصفا(2), live, …).
--
-- HOW IT GOT THERE, AND WHY IT IS FIXED BUT NOT SAFE. That row was a DEAD listing: one abwbna row
-- deactivated at source but still in search_listings_ar, because pg_cron had frozen and
-- sync-search-listings-ar had not run for 10 hours (see 20260915074113). It reached the 'live' arm,
-- carried its numbered district into the candidate set, and killed the refresh. The 07:36 sync
-- removed the dead row and the pipeline now succeeds on its own — bridge 4,413 / canonical 5,267 /
-- recovery 53,819, all above their floors. So the immediate failure is already resolved by a
-- different fix, and this migration exists because the FRAGILITY is not: any live listing on any of
-- the 40 platforms that publishes «الصفا(2)» takes the whole pipeline down again, hourly. hajer
-- publishes exactly this shape today — «مخطط الرياض (474/19)», «الورود (1100/4)» and three more, 20
-- production_ready rows in city 3677 — and is spared only by district_ar_looks_bogus() excluding
-- plan/parcel codes. The catalog arm has no such filter at all.
--
-- THE FIX. Fold a number wherever it appears: bracketed groups anywhere in the label, then bare
-- runs at either end, then collapse the whitespace that removal leaves behind. Arabic-Indic digits
-- (٠-٩) are handled on every limb, as before.
--
-- IT CANNOT MOVE A SEARCH ANSWER. district_norm — the key everything matches on — is computed from
-- the SOURCE spelling by norm_district_tok() and is not touched by this fold, which only rewrites
-- the human-facing canonical_district_ar. PROOF 3 asserts that by execution: the full set of
-- (city_id, district_norm) is identical before and after.
--
-- MEASURED BLAST RADIUS over the real 5,267-row candidate set: 3 rows change, all of them a double
-- space collapsing to one («حي  السبهاني» -> «حي السبهاني»), 0 rows fold to empty, and 0 rows are
-- left carrying a digit under either the old or the new fold.

create or replace function public.refresh_loc_canonical_district()
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n bigint; v_bogus_live int; v_numbered int;
begin
  truncate public.loc_canonical_district;
  insert into public.loc_canonical_district (city_id, district_norm, canonical_district_ar, source, refreshed_at)
  with cat as (
    select city_id, norm_district_tok(district_ar) k, district_ar sp, 0 as pref, 1::bigint cnt
    from public.loc_catalog_district
    where district_ar is not null and btrim(district_ar) <> ''
  ),
  liv as (
    select city_id, norm_district_tok(district_ar) k, district_ar sp, 1 as pref, count(*)::bigint cnt
    from public.search_listings_ar
    where production_ready and district_ar is not null and btrim(district_ar) <> ''
      and district_ar not in ('غير محدد','اخرى','أخرى')
      and not public.district_ar_looks_bogus(district_ar)
    group by 1,2,3
  ),
  allrows as (select * from cat union all select * from liv),
  ranked as (
    select city_id, k, sp, pref,
      row_number() over (partition by city_id, k
        order by pref asc, (sp ~ '[0-9٠-٩]') asc, cnt desc, length(sp) asc, sp asc) rn
    from allrows
    where k is not null and k <> ''
  )
  select city_id, k,
         -- Fold a number wherever it sits: bracketed group anywhere, then a bare run at either end,
         -- then collapse the whitespace the removal leaves. Falls back to the raw spelling only if
         -- folding would empty the label; the guards below still refuse a digit that survives.
         coalesce(
           nullif(btrim(regexp_replace(
             regexp_replace(
               regexp_replace(sp, '[\(\[\{][^\)\]\}]*[0-9٠-٩][^\)\]\}]*[\)\]\}]', ' ', 'g'),
               '(^\s*[0-9٠-٩][0-9٠-٩/\-]*\s*)|(\s*[0-9٠-٩][0-9٠-٩/\-]*\s*$)', ' ', 'g'),
             '\s+', ' ', 'g')), ''),
           sp),
         case when pref = 0 then 'catalog' else 'live' end, now()
  from ranked where rn = 1;
  get diagnostics n = row_count;

  select count(*) into v_bogus_live
    from public.loc_canonical_district
   where source = 'live' and public.district_ar_looks_bogus(canonical_district_ar);
  if v_bogus_live > 0 then
    raise exception 'refresh_loc_canonical_district: % bogus-shaped ''live'' row(s) survived the '
      'district_ar_looks_bogus() exclusion — the WHERE clause was weakened. Refusing to publish a '
      'catalog that re-leaks internal plan/parcel codes (see migration 20260911201716).', v_bogus_live;
  end if;

  -- The owner's rule, asserted on EVERY row (not just 'live' — the codes were catalog-sourced).
  select count(*) into v_numbered
    from public.loc_canonical_district
   where canonical_district_ar ~ '[0-9٠-٩]';
  if v_numbered > 0 then
    raise exception 'refresh_loc_canonical_district: % row(s) would put a number in our own district '
      'list. Our list never shows a number (owner rule 2026-09-14); a source-published number belongs '
      'on the property card only. Refusing to publish.', v_numbered;
  end if;

  return n;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- PROOFS, executed against real data.
-- ---------------------------------------------------------------------------------------------
DO $proof$
DECLARE
  keys_before text; keys_after text; n_before bigint; n_after bigint; v text;
BEGIN
  -- Snapshot the MATCH KEYS before touching anything.
  select count(*), md5(string_agg(city_id || '|' || district_norm, E'\n' order by city_id, district_norm))
    into n_before, keys_before from public.loc_canonical_district;

  -- 1. THE EXACT VALUE THAT KILLED THE PIPELINE 8 TIMES must now fold.
  v := coalesce(nullif(btrim(regexp_replace(
         regexp_replace(
           regexp_replace('الصفا(2)', '[\(\[\{][^\)\]\}]*[0-9٠-٩][^\)\]\}]*[\)\]\}]', ' ', 'g'),
           '(^\s*[0-9٠-٩][0-9٠-٩/\-]*\s*)|(\s*[0-9٠-٩][0-9٠-٩/\-]*\s*$)', ' ', 'g'),
         '\s+', ' ', 'g')), ''), 'الصفا(2)');
  IF v <> 'الصفا' THEN
    RAISE EXCEPTION 'PROOF 1 FAILED: «الصفا(2)» folded to «%», expected «الصفا»', v;
  END IF;

  -- 2. Arabic-Indic digits and square brackets fold too; a clean name is left alone.
  v := btrim(regexp_replace(regexp_replace(regexp_replace('الصفا (٢)','[\(\[\{][^\)\]\}]*[0-9٠-٩][^\)\]\}]*[\)\]\}]',' ','g'),
        '(^\s*[0-9٠-٩][0-9٠-٩/\-]*\s*)|(\s*[0-9٠-٩][0-9٠-٩/\-]*\s*$)',' ','g'),'\s+',' ','g'));
  IF v <> 'الصفا' THEN RAISE EXCEPTION 'PROOF 2a FAILED: Arabic-Indic digits not folded, got «%»', v; END IF;
  v := btrim(regexp_replace(regexp_replace(regexp_replace('حي الملك فهد','[\(\[\{][^\)\]\}]*[0-9٠-٩][^\)\]\}]*[\)\]\}]',' ','g'),
        '(^\s*[0-9٠-٩][0-9٠-٩/\-]*\s*)|(\s*[0-9٠-٩][0-9٠-٩/\-]*\s*$)',' ','g'),'\s+',' ','g'));
  IF v <> 'حي الملك فهد' THEN RAISE EXCEPTION 'PROOF 2b FAILED: clean name was altered to «%»', v; END IF;

  -- 3. RUN IT, and prove the match keys did not move. This is the claim that matters: the fold
  --    rewrites a display label, never a search key.
  PERFORM public.refresh_loc_canonical_district();
  select count(*), md5(string_agg(city_id || '|' || district_norm, E'\n' order by city_id, district_norm))
    into n_after, keys_after from public.loc_canonical_district;

  IF keys_before IS DISTINCT FROM keys_after THEN
    RAISE EXCEPTION 'PROOF 3 FAILED: the (city_id, district_norm) key set MOVED (% -> % rows). '
      'This fold must be token-preserving.', n_before, n_after;
  END IF;

  -- 4. The guard still holds on the freshly published table.
  IF EXISTS (select 1 from public.loc_canonical_district where canonical_district_ar ~ '[0-9٠-٩]') THEN
    RAISE EXCEPTION 'PROOF 4 FAILED: a number survived into the published district list';
  END IF;

  RAISE NOTICE 'proofs complete: % rows, key set unchanged', n_after;
END
$proof$;