-- OUR DISTRICT LIST NEVER SHOWS A NUMBER (owner decision 2026-09-14, verbatim):
--   «in our district catalog, make sure there are no numbers. I know maybe they write numbers in
--    the neighborhood, but in our district, we don't include numbers. We just match it with ours,
--    and then in their property card, if they kept a number, we include that number.»
--
-- THIS IS A FOLD, NOT A DELETION — which is the whole reason it is safe where 20260913200718 was
-- not. جازان's المحمدية 1 / 2 / 3 and the bare المحمدية become ONE picker row «المحمدية»; picking it
-- returns the listings of all four (28 -> 240 measured, i.e. recall goes UP, nothing is stranded);
-- each card still reads «المحمدية 2», because cards render the platform's own `neighborhood` column
-- straight from the raw table (LIST_SELECT, src/data/remote.ts — verified 2026-09-14 that nothing in
-- src/ selects search_listings_ar at all). That is the split the owner already mandates for
-- hamza/spelling variants (district-canonicalization rule, owner 2026-07-19): the DB canonicalizes
-- for MATCHING, the card shows the source VERBATIM. This migration adds trailing digits to the
-- variant classes norm_district_tok() already folds, in the same single shared function — never a
-- picker-only patch, which is the second-copy-of-identity drift 20260912172542 existed to remove.
--
-- WHY 2026-09-13 (20260913200718) HAD TO BE REVERTED AND WHY THIS IS NOT THAT.
-- That migration excluded `district_ar ~ '[0-9٠-٩]'` from the LIVE branch of the refresh, on the
-- stated premise that «Legitimate numbered districts reach the picker through the 'catalog' branch».
-- Measured against production 2026-09-14 (anon key, all 5,388 canonical rows) that premise is
-- exactly INVERTED:
--   * all 71 «حي ج<n>» internal plan codes and all 4 «مخطط ج<n>» are source='catalog'
--   * all 38 genuine numbered districts — every EXPECTED_DISTINCT member included
--     (المحمدية 1/2/3, الرحاب 1/2, city 17) — are source='live'
-- so the live-only digit filter deleted 38 real neighbourhoods and left all 75 internal codes in
-- the dropdown. It also DELETED rows from loc_canonical_district, which is not a picker-only table:
-- resolve_district_ar(city_id, text) uses it as its attestation list, so a deleted row silently
-- un-resolves that district for search and for the agent. A fold removes nothing.
--
-- MEASURED BLAST RADIUS (all 5,388 canonical rows, 2026-09-14): 143 rows carry a digit and every one
-- of them is TRAILING (zero mid-name digits anywhere in the catalog), so a trailing-number fold is
-- both sufficient and minimal. 30 merge groups absorb 113 rows; 13 of those merge onto a plain-named
-- row that ALREADY EXISTS (جازان already carries a bare «المحمدية», تبوك a bare «حي المصيف») — for
-- those, the owner's «we just match it with ours» is literally already sitting in the catalog.
-- 5,388 -> 5,275 rows, and zero surviving labels contain a digit.
--
-- KNOWN RESIDUE, reported rather than hidden: 18 rows across 16 cities are internal codes even once
-- the number is gone («حي ج» ×15, «حي رقم», «مخطط ج», «مخطط ا», «مخطط ب» — the last three already
-- had no digit before this change). They satisfy the owner's no-number rule and are left in place;
-- whether a code-shaped NAME should also leave the picker is a separate decision, raised separately.
-- Word-numeral twins (مصيف الاول vs مصيف 1) stay unfolded — owner-held since 20260912172542.

-- ── THE FOLD, inside the one shared token function ──────────────────────────────────────────────
-- Appended as the LAST step so it runs after the existing «letter|digit -> letter space digit»
-- split, which guarantees every digit run is already space-separated: «البصر1» and «البصر 1» reach
-- this rule identically, so the missing-space renderings fold for free instead of needing their own
-- repair. A name that is ONLY a number normalizes to the empty token and is dropped by the
-- refresh's existing `k <> ''` guard.
create or replace function public.norm_district_tok(t text)
 returns text
 language sql
 immutable
as $function$
  select btrim(regexp_replace(
           regexp_replace(regexp_replace(
             btrim(regexp_replace(
               replace(
                 translate(
                   regexp_replace(public.normalize_ar(coalesce(t,'')), '[ًٌٍَُِّْٰ]', '', 'g'),
                   'ئ٠١٢٣٤٥٦٧٨٩', 'ي0123456789'),
                 'ء',''),
               '([ء-ي])([0-9])', '\1 \2', 'g')),
             '^(حي\s+)+', ''),
           '^ال', ''),
         '\s*[0-9]+\s*$', ''));
$function$;

-- The expression index baked the OLD function's values; a replaced body does not rebuild it.
reindex index public.idx_slar_district_tok;

-- Catalog: numbered and plain spellings now share (city_id, token) — keep the lowest district_id,
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

-- ── THE LABEL, so the picker itself carries no number ───────────────────────────────────────────
-- The fold alone merges the ROWS but the winning spelling could still be a numbered one (17 of the
-- 30 groups — e.g. الرحاب 1 / الرحاب 2 — have no digit-free member at all). Two changes: a digit-free
-- spelling now outranks a numbered one, and the stored label has any trailing number removed. The
-- coalesce is defensive only: a token that survives `k <> ''` always has letters left to keep.
CREATE OR REPLACE FUNCTION public.refresh_loc_canonical_district()
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
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
         coalesce(nullif(btrim(regexp_replace(sp, '\s*[0-9٠-٩]+\s*$', '')), ''), sp),
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

-- Republish through the fold BEFORE the structural barrier is attached, so the constraint is
-- validated against already-clean data.
select public.refresh_loc_canonical_district();

-- Structural barrier: even with both the label rule and the self-check removed, the table refuses
-- to store a numbered name. Unconditional — 2026-09-13's version was scoped to source='live', which
-- is precisely the half that never carried the codes.
alter table public.loc_canonical_district
  drop constraint if exists loc_canonical_district_live_never_numbered;
alter table public.loc_canonical_district
  drop constraint if exists loc_canonical_district_never_numbered;
alter table public.loc_canonical_district
  add constraint loc_canonical_district_never_numbered
  check (canonical_district_ar !~ '[0-9٠-٩]');

-- Display canon: purge rows keyed by dead (pre-fold) tokens — its own refresh only upserts rows
-- satisfying norm_district_tok(display_ar) = district_norm, so stale keys would linger forever.
delete from public.loc_display_district_canon
 where district_norm is distinct from public.norm_district_tok(display_ar);
select public.refresh_loc_display_district_canon();

-- EN bridge: n_distinct collapses where a numbered and a plain spelling were counted as two.
select public.refresh_bridge_en_district();

-- Search-index display labels (owner rule 2026-08-22, mon_detect_card_label_contract): one token
-- must render ONE way in the index. backfill_location_display_labels() returns NOTHING when
-- search_index_writer_lock() refuses, so an empty result must ABORT, not silently pass.
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

-- ── SELF-TESTS against the REAL objects in this transaction; any failure rolls everything back ──
do $$
declare
  v_jazan int; v_taif int;
  v_expected int; v_cnt int; v_opts_rows int; v_label text;
  v_split int; v_ne_canon int; v_numbered int; r1 text;
begin
  -- 1) the new fold: numbered siblings and the plain name are ONE identity
  if public.norm_district_tok('المحمدية 1') <> public.norm_district_tok('المحمدية')
  or public.norm_district_tok('المحمدية 3') <> public.norm_district_tok('المحمدية')
  or public.norm_district_tok('حي المصيف 2') <> public.norm_district_tok('حي المصيف')
  or public.norm_district_tok('البصر1')      <> public.norm_district_tok('البصر 1')
  or public.norm_district_tok('الزهراء ١')   <> public.norm_district_tok('الزهراء')
  then
    raise exception 'number fold failed: a numbered sibling did not join its plain name';
  end if;

  -- 2) every fold 20260912172542 shipped must still hold (regression guard on a shared fn)
  if public.norm_district_tok('الصفاء') <> 'صفا'
  or public.norm_district_tok('حي الصفا') <> 'صفا'
  or public.norm_district_tok('حي الحمراء') <> public.norm_district_tok('حي الحمرا')
  or public.norm_district_tok('شرائع المجاهدين') <> public.norm_district_tok('شرايع المجاهدين')
  or public.norm_district_tok('حي الصقًار') <> public.norm_district_tok('حي الصقار')
  then
    raise exception 'regression: an earlier identity fold stopped holding';
  end if;

  -- 3) discrimination: different places stay different, word-numerals stay owner-held
  if public.norm_district_tok('حي النرجس') = public.norm_district_tok('حي الياسمين')
  or public.norm_district_tok('مصيف الاول') = public.norm_district_tok('مصيف 1')
  or public.norm_district_tok('حي الصفا')   = public.norm_district_tok('حي الصفوة')
  then
    raise exception 'fold over-merges: two genuinely different names produced one token';
  end if;

  -- 4) THE OWNER'S RULE, on the whole table
  select count(*) into v_numbered from public.loc_canonical_district
   where canonical_district_ar ~ '[0-9٠-٩]';
  if v_numbered > 0 then
    raise exception '% district name(s) in our own list still carry a number', v_numbered;
  end if;

  -- 5) zero split identities survive the rebuild
  select count(*) into v_split from (
    select 1 from public.loc_canonical_district
    group by city_id, public.norm_district_tok(canonical_district_ar)
    having count(*) > 1) z;
  if v_split > 0 then
    raise exception '% canonical split group(s) survived the rebuild', v_split;
  end if;

  -- 6) ANTI-OVER-CORRECTION, the assertion that matters most: جازان's المحمدية is ONE row, labelled
  --    without a number, whose count equals an independent recount of every listing that folds onto
  --    it. Pre-fold the four rows were 160/30/28/22 = 240; a floor of 200 cannot be met by any single
  --    pre-fold member, so this can only pass if the merge actually took and nothing was dropped.
  select city_id into strict v_jazan from public.loc_catalog_city where city_ar = 'جازان';
  select count(*) into v_expected from public.search_listings_ar
   where production_ready and city_id = v_jazan
     and public.norm_district_tok(district_ar) = public.norm_district_tok('المحمدية');
  select count(*), max(o.listing_count), max(o.district_ar)
    into v_opts_rows, v_cnt, v_label
    from public.district_options_ar(v_jazan) o
   where public.norm_district_tok(o.district_ar) = public.norm_district_tok('المحمدية');
  if v_opts_rows <> 1 or v_cnt <> v_expected or v_label <> 'المحمدية' then
    raise exception 'jazan المحمدية fold proof failed: rows=% label=% count=% expected=%',
      v_opts_rows, coalesce(v_label,'NULL'), v_cnt, v_expected;
  end if;
  if v_expected < 200 then
    raise exception 'jazan المحمدية merged count suspiciously small (%): the fold dropped listings '
      'instead of merging them', v_expected;
  end if;

  -- 7) the resolver reaches the folded identity from a numbered source spelling
  r1 := public.resolve_district_ar(v_jazan, 'المحمدية 2');
  if r1 is distinct from 'المحمدية' then
    raise exception 'resolve_district_ar lost the numbered spelling: %', coalesce(r1,'NULL');
  end if;

  -- 8) الطائف's 42 «حي ج<n>» codes are one row now, and it carries no number
  select city_id into strict v_taif from public.loc_catalog_city where city_ar = 'الطائف';
  select count(*) into v_opts_rows from public.district_options_ar(v_taif) o
   where o.district_ar ~ '[0-9٠-٩]';
  if v_opts_rows > 0 then
    raise exception 'الطائف still offers % numbered district option(s)', v_opts_rows;
  end if;

  -- 9) card-label contract arms this change touches
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
end $$;
