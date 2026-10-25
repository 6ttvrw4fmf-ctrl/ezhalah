-- HARAJ: REGA's «اكثر من عشر سنوات» IS STORED AS THE OPEN 10+ BUCKET, NOT NULL (backfill, 2026-10-25).
--
-- The source states an age and we showed none: haraj's licence parser (scrapers/haraj/parse.age_of) sent REGA's
-- open top bucket «اكثر من عشر سنوات» to NULL, so 983 live licensed ads (920 residential + 63 commercial) were
-- invisible to «10+». Since 20261025072931 the AF clause reads a haraj 10 as «≥ 10, upper end unknown» (REGA's
-- English «Ten Year» already meant both), so storing 10 is exactly the source: «10+» finds them, «up to N» never.
-- Same PR fixes the parser; this backfills the rows it already wrote, from each row's OWN stored licence value
-- (additional_info.rega_facts «عمر العقار»), with the parser's two new rules mirrored:
--   «اكثر من عشر سنوات» / «أكثر من 10 سنوات» → 10;   a number glued to its unit («45سنه») → that number (1 row).
-- Inactive rows with the same value are repaired too (68), so a re-activated ad is already right.
--
-- Proof, in this transaction (fails closed): the clause already carries haraj in its open-bucket list; only
-- NULL ages with exactly those values are touched; every touched row is byte-identical apart from property_age
-- (no trigger side effect); in listing_age_resolved (the view the search index is built from) the «10+» count
-- grows by exactly the active rows backfilled to ≥ 10 and the «< 10» count — the only haraj rows «up to N» can
-- ever match — does not move. Rolled-back dry run first: 1,052 rows (984 active ≥ 10 = 983 open + 1 «45سنه»);
-- haraj «10+» in listing_age_resolved 1,159 → 2,143; «< 10» 6,143 unchanged; no trigger side effect.
do $mig$
declare
  open_re  constant text := '^\s*[اأ]كثر\s+من\s+(عشر|10)\s+سنوات?\s*$';
  glued_re constant text := '^\s*([0-9]{1,3})\s*(سنه|سنة|سنوات|سنين|عام)\s*$';
  n int; n2 int; n_targets int; n_active_ge10 int;
  ge10_before bigint; ge10_after bigint; lt10_before bigint; lt10_after bigint;
begin
  if position($c$s.platform not in ('aqar', 'aqarcity', 'haraj', 'muhaysini', 'reinvest', 'tuba', 'wasalt')$c$
              in public.af_eligibility_clause()) = 0 then
    raise exception 'haraj_open_age: the AF clause does not read a haraj 10 as open — backfilling would put these ads under «up to N»';
  end if;

  create temp table _fix on commit drop as
  select t.tbl, t.id, t.active, t.row_md5,
         case when t.raw ~ open_re then 10 else (substring(t.raw from glued_re))::int end as new_age
    from (
      select 'haraj_residential_listings'::text tbl, h.id, h.active,
             translate(h.additional_info->'rega_facts'->>'عمر العقار', '٠١٢٣٤٥٦٧٨٩', '0123456789') raw,
             md5((to_jsonb(h) - 'property_age')::text) row_md5
        from public.haraj_residential_listings h where h.property_age is null
      union all
      select 'haraj_commercial_listings', h.id, h.active,
             translate(h.additional_info->'rega_facts'->>'عمر العقار', '٠١٢٣٤٥٦٧٨٩', '0123456789'),
             md5((to_jsonb(h) - 'property_age')::text)
        from public.haraj_commercial_listings h where h.property_age is null
    ) t
   where t.raw ~ open_re or t.raw ~ glued_re;
  delete from _fix where new_age is null or new_age > 100;
  select count(*), count(*) filter (where active and new_age >= 10) into n_targets, n_active_ge10 from _fix;
  if n_targets = 0 then raise exception 'haraj_open_age: nothing to backfill — the measurement is not what was planned'; end if;

  select count(*) filter (where property_age >= 10), count(*) filter (where property_age < 10)
    into ge10_before, lt10_before
    from public.listing_age_resolved where source_table in ('haraj_residential_listings', 'haraj_commercial_listings');

  update public.haraj_residential_listings h set property_age = f.new_age
    from _fix f where f.tbl = 'haraj_residential_listings' and f.id = h.id and h.property_age is null;
  get diagnostics n = row_count;
  update public.haraj_commercial_listings h set property_age = f.new_age
    from _fix f where f.tbl = 'haraj_commercial_listings' and f.id = h.id and h.property_age is null;
  get diagnostics n2 = row_count;
  n := n + n2;
  if n <> n_targets then
    raise exception 'haraj_open_age: updated % rows, planned % — rolling back', n, n_targets;
  end if;

  select count(*) into n from _fix f
    join (select 'haraj_residential_listings'::text tbl, h.id, h.property_age, md5((to_jsonb(h) - 'property_age')::text) m from public.haraj_residential_listings h
          union all
          select 'haraj_commercial_listings', h.id, h.property_age, md5((to_jsonb(h) - 'property_age')::text) from public.haraj_commercial_listings h) x
      on x.tbl = f.tbl and x.id = f.id
   where x.m = f.row_md5 and x.property_age = f.new_age;
  if n <> n_targets then
    raise exception 'haraj_open_age: % of % rows changed something besides property_age (a trigger side effect) — rolling back', n_targets - n, n_targets;
  end if;

  select count(*) filter (where property_age >= 10), count(*) filter (where property_age < 10)
    into ge10_after, lt10_after
    from public.listing_age_resolved where source_table in ('haraj_residential_listings', 'haraj_commercial_listings');
  if ge10_after - ge10_before <> n_active_ge10 then
    raise exception 'haraj_open_age: «10+» grew by %, expected exactly % — rolling back', ge10_after - ge10_before, n_active_ge10;
  end if;
  if lt10_after <> lt10_before then
    raise exception 'haraj_open_age: the «< 10» rows «up to N» can match moved % → % — rolling back', lt10_before, lt10_after;
  end if;
  raise notice 'haraj_open_age: % rows backfilled (% active ≥ 10); haraj «10+» % → %; «< 10» % unchanged',
    n_targets, n_active_ge10, ge10_before, ge10_after, lt10_before;
end
$mig$;
