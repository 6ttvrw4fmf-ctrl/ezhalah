-- Bug-hunt 2026-07-30 (adversarially verified findings). Five guarded needle-edits built from the
-- LIVE definitions at apply time (feedback_rpc-full-body-replace-revert-hazard): each block aborts
-- if its anchor is missing, so a concurrently-changed function can never be silently clobbered.
--
-- 1+2) ANNUAL-RENT PARITY: search defines annual as rent_period_ar='سنوي' (strict — the locked
--    product contract; a NULL period is NOT annual). Both counts RPCs said payment_monthly=false,
--    which also counts period-unknown rows → chip counts ≠ search results. Aligned to search.
-- 3+4) chip RPCs (district_options_ar / top_cities_by_deal_ar): p_payment_monthly=false now means
--    "annual per search" for rent rows (Buy rows unaffected via the deal_ar escape); and
--    district_options_ar's macro='both' now table-suffix-disambiguates like search, so Commercial
--    district chips stop counting residential-table عمارة rows (~2x overcount).
-- 5) counts RPCs gain search's amenity unknown-token whitelist + the rent_now_pay_later alias, and
--    apartment_guided_counts_ar gains the cardinality(p_platforms)=0 escape (parity guards).
-- 6) sync_search_listings_ar change-detection now tracks the 14 previously-untracked synced fields
--    (bathrooms/furnished/tenant_ar/license_number/street_width_m/elevator/parking/kitchen/
--    air_conditioner/maid_room/driver_room/private_entrance/type_ar/rent_period_ar) — closes the
--    122-row live-stale propagation gap for good.

do $do$
declare def text; n text; r text;
begin
  -- ── A) apartment_guided_counts_ar ───────────────────────────────────────────
  def := pg_get_functiondef('public.apartment_guided_counts_ar'::regproc);

  n := $nq$or (p_rent_period = 'سنوي' and s.payment_monthly = false)$nq$;
  r := $rq$or (p_rent_period = 'سنوي' and s.rent_period_ar = 'سنوي')$rq$;
  if strpos(def, n) = 0 then raise exception 'A1 needle missing'; end if;
  def := replace(def, n, r);

  n := $nq$and (p_platforms  is null or s.platform = any(p_platforms))$nq$;
  r := $rq$and (p_platforms  is null or cardinality(p_platforms) = 0 or s.platform = any(p_platforms))$rq$;
  if strpos(def, n) = 0 then raise exception 'A2 needle missing'; end if;
  def := replace(def, n, r);

  n := $nq$and (p_amenities is null or ($nq$;
  r := n || E'\n               not exists (select 1 from unnest(p_amenities) tok\n                           where tok not in (''elevator'',''parking'',''kitchen'',''ac'',''maid_room'',''driver_room'',''private_entrance'',''furnished'',''rnpl'',''rent_now_pay_later''))\n           and ';
  if strpos(def, n) = 0 then raise exception 'A3 needle missing'; end if;
  def := replace(def, n, r);

  n := $nq$and (not ('rnpl'             = any(p_amenities)) or s.rent_now_pay_later)))$nq$;
  r := $rq$and (not ('rnpl'             = any(p_amenities) or 'rent_now_pay_later' = any(p_amenities)) or s.rent_now_pay_later)))$rq$;
  if strpos(def, n) = 0 then raise exception 'A4 needle missing'; end if;
  def := replace(def, n, r);

  execute def;

  -- ── B) property_age_option_counts_ar (platforms escape already present) ─────
  def := pg_get_functiondef('public.property_age_option_counts_ar'::regproc);

  n := $nq$or (p_rent_period = 'سنوي' and s.payment_monthly = false)$nq$;
  r := $rq$or (p_rent_period = 'سنوي' and s.rent_period_ar = 'سنوي')$rq$;
  if strpos(def, n) = 0 then raise exception 'B1 needle missing'; end if;
  def := replace(def, n, r);

  n := $nq$and (p_amenities is null or ($nq$;
  r := n || E'\n               not exists (select 1 from unnest(p_amenities) tok\n                           where tok not in (''elevator'',''parking'',''kitchen'',''ac'',''maid_room'',''driver_room'',''private_entrance'',''furnished'',''rnpl'',''rent_now_pay_later''))\n           and ';
  if strpos(def, n) = 0 then raise exception 'B3 needle missing'; end if;
  def := replace(def, n, r);

  n := $nq$and (not ('rnpl'             = any(p_amenities)) or s.rent_now_pay_later)))$nq$;
  r := $rq$and (not ('rnpl'             = any(p_amenities) or 'rent_now_pay_later' = any(p_amenities)) or s.rent_now_pay_later)))$rq$;
  if strpos(def, n) = 0 then raise exception 'B4 needle missing'; end if;
  def := replace(def, n, r);

  execute def;

  -- ── C) district_options_ar ──────────────────────────────────────────────────
  def := pg_get_functiondef('public.district_options_ar'::regproc);

  n := $nq$AND (p_payment_monthly IS NULL OR s.payment_monthly = p_payment_monthly)$nq$;
  r := $rq$AND (p_payment_monthly IS NULL
        OR (p_payment_monthly = true  AND s.payment_monthly = true)
        OR (p_payment_monthly = false AND (s.deal_ar <> 'إيجار' OR s.rent_period_ar = 'سنوي')))$rq$;
  if strpos(def, n) = 0 then raise exception 'C1 needle missing'; end if;
  def := replace(def, n, r);

  n := $nq$AND (k.macro = valid_category.v OR k.macro = 'both')$nq$;
  r := $rq$AND (k.macro = valid_category.v
                 OR (k.macro = 'both' AND (CASE valid_category.v
                       WHEN 'Residential' THEN s.source_table LIKE '%\_residential\_listings'
                       WHEN 'Commercial'  THEN s.source_table LIKE '%\_commercial\_listings'
                       ELSE true END)))$rq$;
  if strpos(def, n) = 0 then raise exception 'C2 needle missing'; end if;
  def := replace(def, n, r);

  execute def;

  -- ── D) top_cities_by_deal_ar ────────────────────────────────────────────────
  def := pg_get_functiondef('public.top_cities_by_deal_ar'::regproc);

  n := $nq$AND (p_payment_monthly IS NULL OR s.payment_monthly = p_payment_monthly)$nq$;
  r := $rq$AND (p_payment_monthly IS NULL
        OR (p_payment_monthly = true  AND s.payment_monthly = true)
        OR (p_payment_monthly = false AND (s.deal_ar <> 'إيجار' OR s.rent_period_ar = 'سنوي')))$rq$;
  if strpos(def, n) = 0 then raise exception 'D1 needle missing'; end if;
  def := replace(def, n, r);

  execute def;

  -- ── E) sync_search_listings_ar: track the 14 missing fields ─────────────────
  def := pg_get_functiondef('public.sync_search_listings_ar'::regproc);

  n := $nq$then v.direction end))))$nq$;
  r := $rq$then v.direction end)
                       or s3.bathrooms is distinct from v.bathrooms
                       or s3.furnished is distinct from (case when v.source_table ~ '^(gathern|aqarmonthly)_' then true else v.furnished end)
                       or s3.tenant_ar is distinct from (case when v.tenant_category in ('عزاب','عوائل') then v.tenant_category end)
                       or s3.license_number is distinct from v.license_number
                       or s3.street_width_m is distinct from v.street_width_m
                       or s3.elevator is distinct from v.elevator
                       or s3.parking is distinct from v.parking
                       or s3.kitchen is distinct from v.kitchen
                       or s3.air_conditioner is distinct from v.air_conditioner
                       or s3.maid_room is distinct from v.maid_room
                       or s3.driver_room is distinct from v.driver_room
                       or s3.private_entrance is distinct from v.private_entrance
                       or s3.type_ar is distinct from canon_type_ar(normalize(case
                when t.ar is not null then t.ar
                when v.property_type is null or btrim(v.property_type) = '' then 'غير معروف'
                when v.property_type ~ '[A-Za-z]' then 'غير معروف'
                else v.property_type
              end, NFC))
                       or s3.rent_period_ar is distinct from (case when lower(v.transaction_type)='rent' then
      case v.rent_period when 'monthly' then 'شهري' when 'annual' then 'سنوي' else null end end))))$rq$;
  if strpos(def, n) = 0 then raise exception 'E1 needle missing'; end if;
  def := replace(def, n, r);

  execute def;
end
$do$;