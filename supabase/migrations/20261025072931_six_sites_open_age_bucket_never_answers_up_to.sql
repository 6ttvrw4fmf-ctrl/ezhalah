-- SIX MORE SITES STORE AN OPEN «10 OR MORE» AS 10: it never answers «up to N years» (2026-10-25).
--
-- Follows 20261025065509 (aqar). Each site was checked against its OWN published field; every one
-- publishes BOTH an exact «10» and an open «more than 10» and stores both as 10 (active rows, res+com):
--   wasalt    completionYear «10+ years» 5,838 · «10 years» 2,001   (live 5872901: «Age 10+ years»)
--   muhaysini API Age {id 12} / REGA propertyAge «اكثر من عشر سنوات» 1,055 · «عشر سنوات» 556
--             (live API retrieve/13689 and /3512: Age {id 12, «اكثر من عشر سنوات»})
--   tuba      year_built «اكثر من عشر سنوات» 251 · «عشر سنوات» 363   (live apartment-…-jeddah-568)
--   aqarcity  عمر العقار «اكثر من عشر سنوات» 204 · «عشر سنوات» 46      (live property/28181)
--   reinvest  construction_period id 148 «اكثر من عشر سنوات» 128 · id 147 «عشر سنوات» 15
--             (live shk-llaygar-188: «عمر العقار اكثر من عشر سنوات»)
--   haraj     REGA licence: Arabic «اكثر من عشر سنوات» is already NULL (exact_age), Arabic «عشر سنوات» 267
--             is exact, but the licence's ENGLISH rendering has ONE top value, «Ten Year» (892 rows,
--             live 11191007531), and no «more than ten». Same REGA licence number on another site:
--             haraj «Ten Year» = wasalt «10+ years» 173 / «10 years» 36, muhaysini «اكثر من عشر» 14 /
--             «عشر» 6 — while haraj Arabic «اكثر من عشر» = wasalt «10+» 164/0 and «عشر» = «10 years» 45/0.
--             So «Ten Year» is REGA's English for both, and a haraj 10 has no known upper end.
-- The rule moves from two aqar table names to the seven platforms (1:1 with their tables). Stored values
-- untouched; «10+» still finds every one; exact-10 ads on these sites also leave «up to N ≥ 10»
-- (indistinguishable once stored), the same honest-unknown cost as aqar. Rolled-back dry run first:
-- «up to 15» buy 168,663 → 163,374, rent 90,035 → 83,708.
--
-- Guards as 20261025065509: clause md5 read in this step (3379f330…), no rebuild would revert, every RPC
-- equals its last build, anchor occurs once; unchanged surfaces identical; «up to 15» drops by exactly
-- the six sites' 10+ rows; no open-bucket row answers «up to 15» on the count or the results RPC.
do $mig$
declare
  c        text := public.af_eligibility_clause();
  a_old    constant text := $x$               -- aqar «أكثر من 10 سنوات» is stored as its floor 10: no upper end, so it never answers «up to N» (2026-10-25)
               and (p_age_max is null or s.property_age < 10
                    or s.source_table not in ('aqar_residential_listings', 'aqar_commercial_listings'))))
$x$;
  a_new    constant text := $x$               -- an OPEN top bucket stored as its floor 10 («أكثر من 10 سنوات», «اكثر من عشر سنوات», «10+ years», REGA «Ten Year»)
               -- has no upper end, so on these platforms it never answers «up to N» (aqar + six proven siblings, 2026-10-25)
               and (p_age_max is null or s.property_age < 10
                    or s.platform not in ('aqar', 'aqarcity', 'haraj', 'muhaysini', 'reinvest', 'tuba', 'wasalt'))))
$x$;
  sibs     constant text[] := array['aqarcity', 'haraj', 'muhaysini', 'reinvest', 'tuba', 'wasalt'];
  occ      int;
  bad      text;
  same_probe constant text := $p$
    select md5(concat_ws('|',
      (select string_agg(r::text, ',' order by r.ordinality) from public.location_search_candidates_ar(p_deal => 'بيع', p_cities => array['الرياض'], p_types => array['فيلا'], p_limit => 50, p_rotation_seed => 'mig') with ordinality r),
      (select string_agg(r::text, ',' order by r.ordinality) from public.location_search_candidates_ar(p_deal => 'إيجار', p_cities => array['جدة'], p_age_buckets => array['new','1_2','3_5'], p_limit => 50, p_rotation_seed => 'mig') with ordinality r),
      public.af_eligible_count(p_deal => 'إيجار', p_cities => array['جدة']),
      public.af_eligible_count(p_deal => 'بيع', p_cities => array['الرياض'], p_types => array['فيلا'], p_age_buckets => array['new','1_2','3_5','6_9']),
      public.af_eligible_count(p_deal => 'بيع', p_age_buckets => array['10p']),
      public.af_eligible_count(p_deal => 'إيجار', p_age_buckets => array['10p']),
      public.af_eligible_count(p_deal => 'بيع', p_age_min => 10),
      public.af_eligible_count(p_deal => 'بيع', p_age_max => 9),
      public.af_eligible_count(p_platforms => array['aqar'], p_age_min => 10, p_age_max => 15),
      public.af_eligible_count(p_deal => 'إيجار', p_platforms => array['dealapp'], p_age_min => 10, p_age_max => 15),
      (select r::text from public.property_age_option_counts_ar(p_deal => 'بيع', p_cities => array['الرياض']) r),
      (select r::text from public.apartment_guided_counts_ar(p_deal => 'إيجار', p_cities => array['جدة']) r)))
  $p$;
  same_before text; same_after text;
  buy15_before bigint; buy15_sibs bigint; rent15_before bigint; rent15_sibs bigint;
  n bigint;
begin
  if md5(pg_get_functiondef('public.af_eligibility_clause()'::regprocedure)) <> '3379f3308b6790c0d8f3b1a70cf5ac11' then
    raise exception 'sib_open_age: af_eligibility_clause is not the body this migration was written against — refusing';
  end if;
  if exists (select 1 from public.af_rebuild_would_revert()) then
    raise exception 'sib_open_age: a rebuild would revert a live edit — refusing';
  end if;
  select string_agg(t.fn_name, ', ') into bad
    from public.af_rpc_templates t
    join pg_proc p on p.proname = t.fn_name and p.pronamespace = 'public'::regnamespace
    left join public.af_rpc_build_state b on b.fn_name = t.fn_name
   where b.def_md5 is distinct from md5(pg_get_functiondef(p.oid));
  if bad is not null then
    raise exception 'sib_open_age: % changed since their last build — refusing to rebuild over it', bad;
  end if;
  occ := (length(c) - length(replace(c, a_old, ''))) / length(a_old);
  if occ <> 1 then
    raise exception 'sib_open_age: the aqar open-bucket anchor occurs % times in af_eligibility_clause, expected 1', occ;
  end if;

  execute same_probe into same_before;
  buy15_before  := public.af_eligible_count(p_deal => 'بيع', p_age_max => 15);
  buy15_sibs    := public.af_eligible_count(p_deal => 'بيع', p_age_max => 15, p_age_min => 10, p_platforms => sibs);
  rent15_before := public.af_eligible_count(p_deal => 'إيجار', p_age_max => 15);
  rent15_sibs   := public.af_eligible_count(p_deal => 'إيجار', p_age_max => 15, p_age_min => 10, p_platforms => sibs);
  if buy15_sibs = 0 or rent15_sibs = 0 then
    raise exception 'sib_open_age: no sibling 10+ row under «up to 15» before the change (% / %) — the probe is not measuring the bug', buy15_sibs, rent15_sibs;
  end if;

  execute format('create or replace function public.af_eligibility_clause() returns text language sql immutable as $fn$ select %L::text $fn$',
                 replace(c, a_old, a_new));
  perform * from public.rebuild_af_filter_rpcs();

  execute same_probe into same_after;
  if same_after is distinct from same_before then
    raise exception 'sib_open_age: a surface without an upper age bound changed (% → %) — rolling back', same_before, same_after;
  end if;
  n := public.af_eligible_count(p_deal => 'بيع', p_age_max => 15);
  if n <> buy15_before - buy15_sibs then
    raise exception 'sib_open_age: «up to 15» buy = %, expected % − % — rolling back', n, buy15_before, buy15_sibs;
  end if;
  n := public.af_eligible_count(p_deal => 'إيجار', p_age_max => 15);
  if n <> rent15_before - rent15_sibs then
    raise exception 'sib_open_age: «up to 15» rent = %, expected % − % — rolling back', n, rent15_before, rent15_sibs;
  end if;
  n := public.af_eligible_count(p_age_max => 15, p_age_min => 10, p_platforms => sibs || array['aqar']);
  if n <> 0 then
    raise exception 'sib_open_age: % open-bucket rows still answer «up to 15» — rolling back', n;
  end if;
  select count(*) into n from public.location_search_candidates_ar(p_platforms => sibs, p_age_min => 10, p_age_max => 15, p_limit => 50);
  if n <> 0 then
    raise exception 'sib_open_age: the results RPC still lists % sibling 10+ ads under «up to 15» — rolling back', n;
  end if;
  raise notice 'sib_open_age: «up to 15» buy % → %, rent % → %; unchanged surfaces identical',
    buy15_before, buy15_before - buy15_sibs, rent15_before, rent15_before - rent15_sibs;
end
$mig$;
