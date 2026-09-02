-- p_has_license = false MUST NOT READ SILENCE AS «UNLICENSED» (owner ruling 2026-09-02, BUG-1 of
-- the AF matrix certification, under the standing rule «silent → NULL, never unknown → NO»).
--
-- The arm was `(p_has_license is null or (s.license_number is not null) = p_has_license)`. With
-- false, every row whose source simply never PUBLISHED a number was served as "no licence":
-- measured 2026-09-02 on شقة/إيجار/سنوي, 6,349 of the 6,356 rows the false arm admitted were NULL.
--
-- Is there an explicit negative fact anywhere in canonical data? Verified fleet-wide 2026-09-02:
--   search_listings_ar.license_number      — text, NULL on 77,238 rows, set on 116,788
--   search_listings_ar.rega_license_status — only ever 'نشط' (16,877) or 'فعال' (1,598), BOTH with a
--                                            number; NULL on every other row. No 'ملغي'/'منتهي'/…
--   listing_extra_attrs                    — license_number only; listing_rich_attrs — the same
--                                            rega_license_status, same values.
-- So "explicitly unlicensed" is a fact NO source publishes today, and the honest false arm admits
-- ZERO rows: `(p_has_license is null or (p_has_license and s.license_number is not null))`.
--   null  → no filter (unchanged)     true → a published number (unchanged)     false → nothing.
-- The day a source publishes an explicit negative, the premise check below raises on re-apply and
-- the arm gets a real negative column — it will not silently start serving silence again.
--
-- No client or edge path sends p_has_license today (pinned by scripts/verify-af-matrix-truth.ts §7,
-- which also EXECUTES this arm's text from the mirror and asserts a NULL row is never admitted).
--
-- Two surfaces carry the arm: af_eligibility_clause() (the template source of the 4 rebuilt RPCs)
-- and top_cities_by_deal_ar (NOT templated — its own byte-identical copy; left unpatched it would
-- keep serving silence to Trending, exactly the drift 20260831205347 warned about). Both are
-- needle-edited on their LIVE text (anchor must occur exactly once), then rebuild_af_filter_rpcs().
-- Same-change mirror: sql/mirrors/af_eligibility_clause.sql (md5 re-stamped).

do $do$
declare
  clause text; tcbd_def text; occ int; parity int; before_n bigint; after_n bigint;
  arm_old text := $x$and (p_has_license is null or (s.license_number is not null) = p_has_license)$x$;
  arm_new text := $x$and (p_has_license is null or (p_has_license and s.license_number is not null))$x$;
  v_neg bigint; v_false bigint; v_true bigint; v_direct bigint; v_tcbd bigint;
begin
  -- PREMISE: canonical data carries no explicit negative licence fact. If it ever does, this arm
  -- needs a real negative column, not "nothing" — refuse to (re)apply so a human looks.
  select count(*) into v_neg from search_listings_ar s
   where s.rega_license_status is not null and s.rega_license_status not in ('نشط','فعال');
  if v_neg <> 0 then
    raise exception 'ABORT: % rows carry a rega_license_status other than نشط/فعال — an explicit negative may now exist; the false arm needs a real column', v_neg;
  end if;

  clause := af_eligibility_clause();
  if position(arm_new in clause) > 0 then
    raise notice 'af_eligibility_clause already carries the fixed arm — clause step skipped';
  else
    occ := (length(clause) - length(replace(clause, arm_old, ''))) / length(arm_old);
    if occ <> 1 then raise exception 'ABORT: af_eligibility_clause licence arm occurs %', occ; end if;
    clause := replace(clause, arm_old, arm_new);
    execute format('create or replace function public.af_eligibility_clause() returns text language sql immutable as $fn$ select %L::text $fn$', clause);
  end if;

  select cnt_total_base into before_n from apartment_guided_counts_ar(
    p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential');
  perform * from rebuild_af_filter_rpcs();
  select public.mon_af_predicate_parity() into parity;
  if parity <> 0 then raise exception 'ABORT: parity=% after rebuild', parity; end if;
  select cnt_total_base into after_n from apartment_guided_counts_ar(
    p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential');
  if before_n is distinct from after_n then
    raise exception 'ABORT: certified cohort changed %->%', before_n, after_n;
  end if;

  -- the untemplated copy
  select pg_get_functiondef('public.top_cities_by_deal_ar'::regproc) into tcbd_def;
  if position(arm_new in tcbd_def) > 0 then
    raise notice 'top_cities_by_deal_ar already carries the fixed arm — step skipped';
  else
    occ := (length(tcbd_def) - length(replace(tcbd_def, arm_old, ''))) / length(arm_old);
    if occ <> 1 then raise exception 'ABORT: top_cities_by_deal_ar licence arm occurs %', occ; end if;
    tcbd_def := replace(tcbd_def, arm_old, arm_new);
    execute tcbd_def;
  end if;

  -- ── proof, executed: false admits nothing; true == published number; null unchanged ─────────
  select af_eligible_count(p_has_license:=false) into v_false;
  if v_false <> 0 then raise exception 'ABORT: p_has_license=false still admits % rows', v_false; end if;
  select af_eligible_count(p_has_license:=true) into v_true;
  select count(*) into v_direct from search_listings_ar s
   where (s.production_ready or (not public.search_row_price_gated(s.deal_ar, s.price_total) and (s.region_id is null or s.city_id is null)))
     and coalesce(s.area_m2, 0) >= 0 and coalesce(s.price_total, 0) >= 0 and coalesce(s.price_annual, 0) >= 0
     and s.deal_ar is not null and s.deal_ar in ('بيع','إيجار')
     and s.license_number is not null;
  if v_true <> v_direct then raise exception 'ABORT: p_has_license=true % <> direct %', v_true, v_direct; end if;
  select count(*) into v_tcbd from top_cities_by_deal_ar(p_has_license:=false);
  if v_tcbd <> 0 then raise exception 'ABORT: top_cities_by_deal_ar(p_has_license=false) returned % rows', v_tcbd; end if;

  raise notice 'SUCCESS: p_has_license=false admits 0 rows on af_eligible_count and top_cities_by_deal_ar; true == % published numbers; parity 0; certified cohort % unchanged', v_true, after_n;
end $do$;
