-- AQAR «أكثر من 10 سنوات» IS AN OPEN BUCKET: it never answers «up to N years» (2026-10-25).
--
-- THE SOURCE (read live 2026-10-25 on sa.aqar.fm, safari17_0 fingerprint). Every aqar ad page carries
-- the age field's own dictionary: 0 → «جديد», 1 → «جديد», 2 … 10 → «N سنوات», and
-- graterThan {value: 10} → «أكثر من 10 سنوات» (the ad's raw `age` is 11 for that choice). The scraper
-- reads the rendered label and normalize.parse_property_age floors the open bucket to 10, so the stored
-- 10 is «exactly 10» OR «more than 10». 20 random active aqar ads stored 10: 16 render
-- «أكثر من 10 سنوات», 4 render «10 سنوات». The facts test (run facts-test-2026-10-24) read the ad text of
-- 94 stored-10 ads: 76 state 11–50 years (6900631 «عمرها ٥٠ سنه»), 18 state 10, none state less.
-- So a stored aqar 10 has NO known upper end. The one stored 12 (6787461) also renders «أكثر من 10».
--
-- THE FALSE MATCH. The chat path sends «أقل من 15 سنة» as p_age_max = 15, and the clause admitted every
-- aqar 10 (a 50-year-old villa under «up to 15»). Measured before this change: «up to 15» buy 179,932
-- of which 11,270 are aqar 10+; rent 99,106 / 9,073; Riyadh villas buy 28,745 / 3,489.
--
-- THE FIX, one clause line, rendered into all six AF RPCs by rebuild_af_filter_rpcs(): with an upper
-- bound, an aqar row stored at 10 or more is excluded (upper end unknown). The stored value is untouched;
-- «10+» (p_age_buckets '10p' / p_age_min = 10) still finds every one of them; the AF ladder (≤ 9) and
-- every search without p_age_max are unchanged (asserted below). The 4-in-20 exact-10 ads leave «up to
-- N ≥ 10» too: we cannot tell them apart in the stored value, and an honest unknown beats a guess.
--
-- Guards (fail closed, one transaction): the clause is still the body the mirror records (md5 below,
-- read in this same step, so a peer's edit is never clobbered); a rebuild would revert nothing; every
-- RPC is what its last build stamped; the anchor occurs once; probes prove the unchanged surfaces
-- identical and the changed one exactly «before − aqar 10+».
do $mig$
declare
  c        text := public.af_eligibility_clause();
  a_old    constant text := $x$               and s.property_age >= coalesce(p_age_min, 0) and s.property_age <= coalesce(p_age_max, 32767)))
$x$;
  a_new    constant text := $x$               and s.property_age >= coalesce(p_age_min, 0) and s.property_age <= coalesce(p_age_max, 32767)
               -- aqar «أكثر من 10 سنوات» is stored as its floor 10: no upper end, so it never answers «up to N» (2026-10-25)
               and (p_age_max is null or s.property_age < 10
                    or s.source_table not in ('aqar_residential_listings', 'aqar_commercial_listings'))))
$x$;
  occ      int;
  bad      text;
  same_probe constant text := $p$
    select md5(concat_ws('|',
      (select string_agg(r::text, ',' order by r.ordinality) from public.location_search_candidates_ar(p_deal => 'بيع', p_cities => array['الرياض'], p_types => array['فيلا'], p_limit => 50, p_rotation_seed => 'mig') with ordinality r),
      (select string_agg(r::text, ',' order by r.ordinality) from public.location_search_candidates_ar(p_deal => 'إيجار', p_cities => array['جدة'], p_age_buckets => array['new','1_2','3_5'], p_limit => 50, p_rotation_seed => 'mig') with ordinality r),
      public.af_eligible_count(p_deal => 'إيجار', p_cities => array['جدة']),
      public.af_eligible_count(p_deal => 'بيع', p_cities => array['الرياض'], p_types => array['فيلا'], p_age_buckets => array['new','1_2','3_5','6_9']),
      public.af_eligible_count(p_deal => 'بيع', p_age_buckets => array['10p']),
      public.af_eligible_count(p_deal => 'بيع', p_age_min => 10),
      public.af_eligible_count(p_deal => 'بيع', p_age_max => 9),
      public.af_eligible_count(p_deal => 'إيجار', p_platforms => array['dealapp'], p_age_min => 10, p_age_max => 15),
      (select r::text from public.property_age_option_counts_ar(p_deal => 'بيع', p_cities => array['الرياض']) r),
      (select r::text from public.apartment_guided_counts_ar(p_deal => 'إيجار', p_cities => array['جدة']) r)))
  $p$;
  same_before text; same_after text;
  buy15_before bigint; buy15_aqar bigint; rent15_before bigint; rent15_aqar bigint;
  n bigint;
begin
  if md5(pg_get_functiondef('public.af_eligibility_clause()'::regprocedure)) <> '0e7153e98f68fa6aa26b7a00fb6e4334' then
    raise exception 'aqar_open_age: af_eligibility_clause is not the body this migration was written against — refusing';
  end if;
  if exists (select 1 from public.af_rebuild_would_revert()) then
    raise exception 'aqar_open_age: a rebuild would revert a live edit — refusing';
  end if;
  select string_agg(t.fn_name, ', ') into bad
    from public.af_rpc_templates t
    join pg_proc p on p.proname = t.fn_name and p.pronamespace = 'public'::regnamespace
    left join public.af_rpc_build_state b on b.fn_name = t.fn_name
   where b.def_md5 is distinct from md5(pg_get_functiondef(p.oid));
  if bad is not null then
    raise exception 'aqar_open_age: % changed since their last build — refusing to rebuild over it', bad;
  end if;
  occ := (length(c) - length(replace(c, a_old, ''))) / length(a_old);
  if occ <> 1 then
    raise exception 'aqar_open_age: the age-range anchor occurs % times in af_eligibility_clause, expected 1', occ;
  end if;

  execute same_probe into same_before;
  buy15_before  := public.af_eligible_count(p_deal => 'بيع', p_age_max => 15);
  buy15_aqar    := public.af_eligible_count(p_deal => 'بيع', p_age_max => 15, p_age_min => 10, p_platforms => array['aqar']);
  rent15_before := public.af_eligible_count(p_deal => 'إيجار', p_age_max => 15);
  rent15_aqar   := public.af_eligible_count(p_deal => 'إيجار', p_age_max => 15, p_age_min => 10, p_platforms => array['aqar']);
  if buy15_aqar = 0 or rent15_aqar = 0 then
    raise exception 'aqar_open_age: no aqar 10+ row under «up to 15» before the change (% / %) — the probe is not measuring the bug', buy15_aqar, rent15_aqar;
  end if;

  execute format('create or replace function public.af_eligibility_clause() returns text language sql immutable as $fn$ select %L::text $fn$',
                 replace(c, a_old, a_new));
  perform * from public.rebuild_af_filter_rpcs();

  execute same_probe into same_after;
  if same_after is distinct from same_before then
    raise exception 'aqar_open_age: a surface without an upper age bound changed (% → %) — rolling back', same_before, same_after;
  end if;
  n := public.af_eligible_count(p_deal => 'بيع', p_age_max => 15);
  if n <> buy15_before - buy15_aqar then
    raise exception 'aqar_open_age: «up to 15» buy = %, expected % − % — rolling back', n, buy15_before, buy15_aqar;
  end if;
  n := public.af_eligible_count(p_deal => 'إيجار', p_age_max => 15);
  if n <> rent15_before - rent15_aqar then
    raise exception 'aqar_open_age: «up to 15» rent = %, expected % − % — rolling back', n, rent15_before, rent15_aqar;
  end if;
  n := public.af_eligible_count(p_age_max => 15, p_age_min => 10, p_platforms => array['aqar']);
  if n <> 0 then
    raise exception 'aqar_open_age: % aqar 10+ rows still answer «up to 15» — rolling back', n;
  end if;
  select count(*) into n from public.location_search_candidates_ar(p_deal => 'بيع', p_platforms => array['aqar'], p_age_min => 10, p_age_max => 15, p_limit => 50);
  if n <> 0 then
    raise exception 'aqar_open_age: the results RPC still lists % aqar 10+ ads under «up to 15» — rolling back', n;
  end if;
  raise notice 'aqar_open_age: «up to 15» buy % → %, rent % → %; unchanged surfaces identical',
    buy15_before, buy15_before - buy15_aqar, rent15_before, rent15_before - rent15_aqar;
end
$mig$;
