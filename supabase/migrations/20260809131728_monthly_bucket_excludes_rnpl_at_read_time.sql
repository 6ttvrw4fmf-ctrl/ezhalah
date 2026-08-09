-- CLOSE THE RNPL/MONTHLY WINDOW AT THE READ LAYER.
--
-- Owner rule: "annual rent with monthly instalments can NEVER enter Monthly." Both WRITERS now agree
-- (sync_payment_monthly + the enforce_price_size_sanity trigger, PR#361/#364), but the flag still
-- ARRIVES LATE for a brand-new row:
--     :15  sync_search_listings_ar() inserts the row. It does NOT carry rent_now_pay_later, so a NEW
--          row takes the column default FALSE → the trigger computes payment_monthly = true.
--     :20  refresh_rnpl_flags() sets the real flag → the (now fixed) trigger recomputes it to false.
-- So a genuinely-RNPL listing could be bucketed Monthly for ~5 minutes after first appearing.
-- "NEVER" does not allow a 5-minute window.
--
-- Rather than rewrite sync_search_listings_ar (a full-body replace of the most critical function in
-- the pipeline) this makes the READ side self-defending: the Monthly bucket now requires the row's
-- own RNPL flag to be false, so a stale payment_monthly can no longer surface an instalment listing
-- under شهري — the flag is read at query time, not at write time. Defence in depth: three layers
-- (writer, trigger, reader) all carry the identical predicate.
--
-- Applied identically to the search RPC and BOTH counts RPCs so counts can never disagree with
-- results. Purely SUBTRACTIVE and only inside the شهري branch — Annual, Buy and every other filter
-- are untouched. Needle-edited from each function's LIVE definition (exactly one anchor in each,
-- asserted below) so no unrelated clause can be lost.
do $mig$
declare
  r record;
  src text; out text; n int;
  anchor  constant text := 'p_rent_period = ''شهري'' and s.payment_monthly = true';
  replace_with constant text :=
    'p_rent_period = ''شهري'' and s.payment_monthly = true and not coalesce(s.rent_now_pay_later, false)';
begin
  for r in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
    where n2.nspname = 'public'
      and p.proname in ('location_search_candidates_ar','apartment_guided_counts_ar','property_age_option_counts_ar')
  loop
    src := pg_get_functiondef(r.oid);
    n := (select count(*) from regexp_matches(src, regexp_replace(anchor, '([().*+?\[\]{}|^$\\])', '\\\1', 'g'), 'g'));
    if n <> 1 then
      raise exception 'anchor appears % times in % — refusing to edit', n, r.proname;
    end if;
    out := replace(src, anchor, replace_with);
    if out = src then
      raise exception 'no-op replacement in % — refusing', r.proname;
    end if;
    execute out;
    raise notice 'patched %', r.proname;
  end loop;
end $mig$;
