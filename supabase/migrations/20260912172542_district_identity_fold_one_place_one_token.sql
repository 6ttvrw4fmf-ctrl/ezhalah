-- DISTRICT IDENTITY FOLD (owner decision 2026-09-12: «go ahead and ship, they are both the same…
-- one category», card keeps the source's own spelling — cards read RAW tables, untouched here).
--
-- ROOT CAUSE. One real district lived as TWO search identities per spelling variant: trailing ء
-- (صفا/الصفاء 3,036 rows in جدة, حمرا/حمراء 2,710 in الخبر), ئ/ي (شرائع/شرايع), Arabic-Indic vs
-- glued ASCII digits (الزهراء ١/الزهراء1), and tashkeel-in-token (حي الصقًار: 0 rows could ever
-- match its catalog token). district_options_ar carried a PICKER-ONLY patch (regexp 'ء$' at render
-- time) — a second copy of identity: the resolver, EN bridge (n_distinct counted two spellings as
-- AMBIGUOUS and refused to translate), canonical table and trending stayed split. 17 groups,
-- 7,215 live rows measured 2026-09-12.
--
-- FIX = fold INSIDE norm_district_tok, the single shared token fn, so every layer agrees.
-- SCOPE GUARD (owner rule): identity is (region → city → district). normalize_ar is deliberately
-- UNTOUCHED — city names legitimately collide across regions (11 towns named الروضة in 5 regions);
-- city identity must keep resolving by city_id. The fold exists only inside the district token,
-- which is always evaluated under a city_id.
-- Word-numeral twins (مصيف الاول vs مصيف 1) are NOT folded — owner-held, needs per-name approval.

create or replace function public.norm_district_tok(t text)
 returns text
 language sql
 immutable
as $function$
  select regexp_replace(regexp_replace(
           btrim(regexp_replace(
             replace(
               translate(
                 regexp_replace(public.normalize_ar(coalesce(t,'')), '[ًٌٍَُِّْٰ]', '', 'g'),
                 'ئ٠١٢٣٤٥٦٧٨٩', 'ي0123456789'),
               'ء',''),
             '([ء-ي])([0-9])', '\1 \2', 'g')),
           '^(حي\s+)+', ''),
         '^ال', '');
$function$;

-- The expression index baked the OLD function's values; a replaced fn body does not rebuild it.
reindex index public.idx_slar_district_tok;

-- Catalog: two attested spellings now share (city_id, token) — keep the lowest district_id,
-- then re-derive the stored norm with the new fn (plain column, not generated).
with ranked as (
  select district_id,
         row_number() over (partition by city_id, public.norm_district_tok(district_ar)
                            order by district_id) rn
  from public.loc_catalog_district
)
delete from public.loc_catalog_district d
 using ranked r
 where d.district_id = r.district_id and r.rn > 1;

update public.loc_catalog_district
   set district_norm = public.norm_district_tok(district_ar)
 where district_norm is distinct from public.norm_district_tok(district_ar);

-- Canonical match truth: full rebuild (truncate+insert, catalog spelling preferred by pref=0).
select public.refresh_loc_canonical_district();

-- Display canon: purge rows keyed by dead (pre-fold) tokens — its own refresh only upserts rows
-- satisfying norm_district_tok(display_ar) = district_norm, so stale keys would linger forever.
delete from public.loc_display_district_canon
 where district_norm is distinct from public.norm_district_tok(display_ar);
select public.refresh_loc_display_district_canon();

-- EN bridge: n_distinct collapses (two spellings → one token) — this UN-blocks translations that
-- were refused as «ambiguous» only because of the spelling split.
select public.refresh_bridge_en_district();

-- Search-index display labels (owner rule 2026-08-22, mon_detect_card_label_contract): one token
-- must render ONE way in the index. backfill_location_display_labels() is the sanctioned repair —
-- it returns NOTHING when search_index_writer_lock() refuses, so an empty result must ABORT, not
-- silently pass (same trap as sync_search_listings_ar, see 2026-09-11 audit).
do $$
declare v_changed bigint; v_remaining bigint; v_rounds int := 0;
begin
  loop
    select b.changed, b.remaining into v_changed, v_remaining
      from public.backfill_location_display_labels(20000) b;
    if v_changed is null then
      raise exception 'backfill_location_display_labels returned nothing - search_index_writer_lock refused; re-run this migration when the writer is free';
    end if;
    v_rounds := v_rounds + 1;
    exit when v_remaining = 0;
    if v_rounds > 20 then
      raise exception 'display-label backfill did not converge: % rows still differ', v_remaining;
    end if;
  end loop;
end $$;

-- SELF-TESTS: run against the REAL objects in this transaction; any failure rolls everything back.
do $$
declare
  v_jeddah int;
  v_cnt int; v_expected int; v_opts_rows int; v_mv int;
  v_split int; v_ne_canon int;
  r1 text; r2 text;
begin
  -- 1) fold algebra on the real fn
  if public.norm_district_tok('الصفاء')  <> 'صفا'
  or public.norm_district_tok('حي الصفا') <> 'صفا'
  or public.norm_district_tok('حي الحمراء') <> public.norm_district_tok('حي الحمرا')
  or public.norm_district_tok('شرائع المجاهدين') <> public.norm_district_tok('شرايع المجاهدين')
  or public.norm_district_tok('الزهراء ١') <> public.norm_district_tok('الزهراء1')
  or public.norm_district_tok('حي الصقًار') <> public.norm_district_tok('حي الصقار')
  then
    raise exception 'fold algebra failed: a spelling twin no longer folds to one token';
  end if;
  -- 2) discrimination: different places must STAY different
  if public.norm_district_tok('حي النرجس') = public.norm_district_tok('حي الياسمين')
  or public.norm_district_tok('مصيف الاول') = public.norm_district_tok('مصيف 1')
  or public.norm_district_tok('حي الصفا')   = public.norm_district_tok('حي الصفوة')
  then
    raise exception 'fold over-merges: two genuinely different names produced one token';
  end if;

  -- 3) zero split identities remain in the canonical table (by re-derived token)
  select count(*) into v_split from (
    select 1 from public.loc_canonical_district
    group by city_id, public.norm_district_tok(canonical_district_ar)
    having count(*) > 1) z;
  if v_split > 0 then
    raise exception '% canonical split group(s) survived the rebuild', v_split;
  end if;

  -- 4) live index: the two card-label-contract arms this change touches must be clean
  select count(*) into v_split from (
    select 1 from public.search_listings_ar
    where production_ready and district_ar is not null
    group by city_id, public.norm_district_tok(district_ar)
    having count(distinct district_ar) > 1) z;
  select count(*) into v_ne_canon
    from public.search_listings_ar s
   where s.production_ready and s.district_ar is not null
     and s.district_ar is distinct from public.loc_display_district_ar(s.city_id, s.district_ar);
  if v_split > 0 or v_ne_canon > 0 then
    raise exception 'card-label contract breach after backfill: rendered_two_ways=% ne_canonical=%', v_split, v_ne_canon;
  end if;

  -- 5) the flagship case end-to-end: jeddah صفا is ONE picker row whose count equals an
  --    independent recount, with a single match value
  select city_id into strict v_jeddah from public.loc_catalog_city where city_ar = 'جدة';
  select count(*) into v_expected from public.search_listings_ar
   where production_ready and city_id = v_jeddah
     and public.norm_district_tok(district_ar) = 'صفا';
  select count(*), max(o.listing_count), max(cardinality(o.match_values))
    into v_opts_rows, v_cnt, v_mv
    from public.district_options_ar(v_jeddah) o
   where public.norm_district_tok(o.district_ar) = 'صفا';
  if v_opts_rows <> 1 or v_cnt <> v_expected or v_mv <> 1 then
    raise exception 'jeddah صفا picker proof failed: rows=% count=% expected=% match_values=%',
      v_opts_rows, v_cnt, v_expected, v_mv;
  end if;
  if v_expected < 2000 then
    raise exception 'jeddah صفا merged count suspiciously small (%): the merge did not take', v_expected;
  end if;

  -- 6) resolver depth (the layer the old picker-only patch never reached)
  r1 := public.resolve_district_ar(v_jeddah, 'الصفاء');
  r2 := public.resolve_district_ar(v_jeddah, 'حي الصفا');
  if r1 is null or r1 is distinct from r2 then
    raise exception 'resolve_district_ar still splits the spellings: % vs %', coalesce(r1,'NULL'), coalesce(r2,'NULL');
  end if;
end $$;