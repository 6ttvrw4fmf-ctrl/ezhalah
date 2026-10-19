-- EVERY ADVANCED FILTER QUESTION TAKES SEVERAL ANSWERS, AND SEVERAL ANSWERS MEAN EXACTLY THEIR MIX
-- (owner 2026-10-03: «many users want to choose جديد or ١–٢ years. We should let users choose more than
-- one … It's a new rule», then «never force the user to select one thing», and for two ages that are
-- not next to each other: «you show a mixture of the ages you selected» — the exact union, no gap fill).
--
-- What the existing parameters can already say exactly, and stays client-side:
--   • bathrooms / street width are «at least» ladders — the union of ≥1 and ≥3 IS ≥1 (p_bath_min,
--     p_street_width_min carry the lowest pick);
--   • unit subtype already has p_unit_subtypes (an array, union).
-- What no existing parameter can say, and is added here — three array params, each the union of the
-- picked options, each absent/empty ⇒ no constraint (so every current caller is unaffected):
--   p_age_buckets text[]     'new' (age 0) · '1_2' · '3_5' · '6_9' · '10p' — the age question's own
--                            bucket keys, same edges as property_age_option_counts_ar's cnt_* columns;
--                            a NULL age is never in any bucket (unknown is not an answer).
--   p_rating_buckets text[]  '9.5' (≥9.5) · '9.0' (≥9.0) · '9.0_rc10' (≥9.0 with ≥10 reviews).
--   p_furnished_in boolean[] furnished = any(...) — «مفروش + غير مفروش» = the listings that STATED
--                            either; a NULL (silent) listing is in neither (silent → NULL, never NO).
--
-- ONE CLAUSE, SIX GENERATED RPCs. The three lines are appended to af_eligibility_clause() by a
-- needle-edit on its LIVE definition (the anchor must occur once; the definition must still be the
-- one this file was built from — md5 cbfa562eb5d75efc4180f2d20f64def7, the same step as the edit, so a
-- concurrent edit can never be clobbered). Each af_rpc_templates row gains the three params right
-- after p_is_new_construction, then rebuild_af_filter_rpcs() — which drops every overload first —
-- regenerates the six RPCs. No hand edit of an AF RPC.
--
-- CARD EVIDENCE GATE. location_search_candidates_ar packs `af_canon` (the per-listing values the card's
-- «مطابق لطلبك» strip proves an answer with) only when some AF param is set — see
-- sql/mirrors/af_canon_select.sql. The three new params join that gate here, or a search narrowed by
-- a mixture alone would return af_canon NULL and the card would show nothing for the answer.
--
-- SELF-CHECK at apply time (any failure aborts the whole migration):
--   • parity 0 after rebuild;
--   • six existing counts (three scopes × two surfaces) are byte-identical before and after;
--   • each union equals its parts measured with the OLD, trusted parameters:
--       age  [new, 6_9]        = new + (6..9)          [1_2] = (1..2)   [] = no filter
--       furn [true, false]     = furnished + unfurnished               [true] = furnished
--       rate [9.5, 9.0_rc10]   = ≥9.5 + (≥9.0 ∧ ≥10 rev) − (≥9.5 ∧ ≥10 rev)
--   • the guided-count surface agrees with the referee on a union.

do $do$
declare
  def text; occ int; t record; tpl text;
  clause_needle text := $x$and (p_unit_subtypes is null or cardinality(p_unit_subtypes) = 0 or s.unit_subtype_ar = any(p_unit_subtypes))$x$;
  clause_add text := $x$
      -- MULTI-PICK UNIONS (owner 2026-10-03: never force the user to select one thing). Each is the
      -- union of exactly the picked options; absent or empty means no constraint; NULL is in no bucket.
      and (p_furnished_in is null or cardinality(p_furnished_in) = 0 or s.furnished = any(p_furnished_in))
      and (p_age_buckets is null or cardinality(p_age_buckets) = 0 or (s.property_age is not null and (
            (''new'' = any(p_age_buckets) and s.property_age = 0)
         or (''1_2'' = any(p_age_buckets) and s.property_age between 1 and 2)
         or (''3_5'' = any(p_age_buckets) and s.property_age between 3 and 5)
         or (''6_9'' = any(p_age_buckets) and s.property_age between 6 and 9)
         or (''10p'' = any(p_age_buckets) and s.property_age >= 10))))
      and (p_rating_buckets is null or cardinality(p_rating_buckets) = 0 or (s.rating is not null and (
            (''9.5'' = any(p_rating_buckets) and s.rating >= 9.5)
         or (''9.0'' = any(p_rating_buckets) and s.rating >= 9.0)
         or (''9.0_rc10'' = any(p_rating_buckets) and s.rating >= 9.0 and s.reviews_count >= 10))))$x$;
  sig_needle text := $x$p_is_new_construction boolean DEFAULT NULL::boolean$x$;
  gate_needle text := $x$or p_is_new_construction is not null$x$;
  gate_new text := $x$or p_is_new_construction is not null or p_age_buckets is not null or p_rating_buckets is not null or p_furnished_in is not null$x$;
  canon jsonb;
  sig_new text := $x$p_is_new_construction boolean DEFAULT NULL::boolean, p_age_buckets text[] DEFAULT NULL::text[], p_rating_buckets text[] DEFAULT NULL::text[], p_furnished_in boolean[] DEFAULT NULL::boolean[]$x$;
  parity int;
  b_a bigint; b_b bigint; b_f bigint; g_a bigint; g_b bigint; g_f bigint;
  a_a bigint; a_b bigint; a_f bigint; h_a bigint; h_b bigint; h_f bigint;
  u bigint; p1 bigint; p2 bigint; p3 bigint;
begin
  -- ── 0. baselines with the CURRENT functions (only parameters that already exist) ──────────────
  select af_eligible_count(p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential') into b_a;
  select af_eligible_count(p_deal:='إيجار', p_rent_period:='شهري', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential') into b_b;
  select af_eligible_count() into b_f;
  select cnt_total_base into g_a from apartment_guided_counts_ar(p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential');
  select cnt_total_base into g_b from apartment_guided_counts_ar(p_deal:='إيجار', p_rent_period:='شهري', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential');
  select cnt_total_base into g_f from apartment_guided_counts_ar();

  -- ── 1. the clause, needle-edited on its live definition ───────────────────────────────────────
  def := pg_get_functiondef('public.af_eligibility_clause()'::regprocedure);
  if position('p_age_buckets' in def) > 0 then
    raise notice 'af_eligibility_clause already carries p_age_buckets — clause step skipped';
  else
    if md5(def) <> 'cbfa562eb5d75efc4180f2d20f64def7' then
      raise exception 'ABORT: af_eligibility_clause changed since this file was written (md5 %) — rebase it', md5(def);
    end if;
    occ := (length(def) - length(replace(def, clause_needle, ''))) / length(clause_needle);
    if occ <> 1 then raise exception 'ABORT: clause needle occurs %', occ; end if;
    execute replace(def, clause_needle, clause_needle || clause_add);
  end if;

  -- ── 2. every template gains the three params ──────────────────────────────────────────────────
  for t in select fn_name, template from af_rpc_templates order by fn_name loop
    if position('p_age_buckets' in t.template) > 0 then continue; end if;
    occ := (length(t.template) - length(replace(t.template, sig_needle, ''))) / length(sig_needle);
    if occ <> 1 then raise exception 'ABORT: % signature needle occurs %', t.fn_name, occ; end if;
    tpl := replace(t.template, sig_needle, sig_new);
    if t.fn_name = 'location_search_candidates_ar' then
      occ := (length(tpl) - length(replace(tpl, gate_needle, ''))) / length(gate_needle);
      if occ <> 1 then raise exception 'ABORT: af_canon gate needle occurs %', occ; end if;
      tpl := replace(tpl, gate_needle, gate_new);
    end if;
    update af_rpc_templates set template = tpl where fn_name = t.fn_name;
  end loop;

  perform * from rebuild_af_filter_rpcs();
  select public.mon_af_predicate_parity() into parity;
  if parity <> 0 then raise exception 'ABORT: parity=% after rebuild', parity; end if;

  -- ── 3. nothing that exists today moved ────────────────────────────────────────────────────────
  select af_eligible_count(p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential') into a_a;
  select af_eligible_count(p_deal:='إيجار', p_rent_period:='شهري', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential') into a_b;
  select af_eligible_count() into a_f;
  select cnt_total_base into h_a from apartment_guided_counts_ar(p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential');
  select cnt_total_base into h_b from apartment_guided_counts_ar(p_deal:='إيجار', p_rent_period:='شهري', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential');
  select cnt_total_base into h_f from apartment_guided_counts_ar();
  if (b_a, b_b, b_f, g_a, g_b, g_f) is distinct from (a_a, a_b, a_f, h_a, h_b, h_f) then
    raise exception 'ABORT: an existing count moved: before (% % % / % % %) after (% % % / % % %)', b_a, b_b, b_f, g_a, g_b, g_f, a_a, a_b, a_f, h_a, h_b, h_f;
  end if;

  -- ── 4. each union equals its parts, measured with the old trusted params ──────────────────────
  -- age, Riyadh annual apartments
  select af_eligible_count(p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential', p_age_buckets:=array['new','6_9']) into u;
  select af_eligible_count(p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential', p_is_new_construction:=true) into p1;
  select af_eligible_count(p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential', p_age_min:=6, p_age_max:=9) into p2;
  if u <> p1 + p2 then raise exception 'ABORT: age [new,6_9] % <> new % + 6..9 %', u, p1, p2; end if;
  if u = 0 then raise exception 'ABORT: age union proven on an empty set — pick a richer scope'; end if;
  select af_eligible_count(p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential', p_age_buckets:=array['1_2']) into u;
  select af_eligible_count(p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential', p_age_min:=1, p_age_max:=2) into p1;
  if u <> p1 then raise exception 'ABORT: age [1_2] % <> 1..2 %', u, p1; end if;
  select af_eligible_count(p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential', p_age_buckets:='{}'::text[]) into u;
  if u <> a_a then raise exception 'ABORT: an empty age list filtered (% vs %)', u, a_a; end if;
  -- the guided surface agrees with the referee on a union
  select cnt_total_base into u from apartment_guided_counts_ar(p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential', p_age_buckets:=array['new','6_9']);
  select af_eligible_count(p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential', p_age_buckets:=array['new','6_9']) into p1;
  if u <> p1 then raise exception 'ABORT: guided % <> referee % on the age union', u, p1; end if;

  -- furnished, Riyadh annual apartments
  select af_eligible_count(p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential', p_furnished_in:=array[true,false]) into u;
  select af_eligible_count(p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential', p_furnished:=true) into p1;
  select af_eligible_count(p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential', p_furnished:=false) into p2;
  if u <> p1 + p2 then raise exception 'ABORT: furnished [t,f] % <> % + %', u, p1, p2; end if;
  select af_eligible_count(p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential', p_furnished_in:=array[true]) into u;
  if u <> p1 then raise exception 'ABORT: furnished [t] % <> %', u, p1; end if;

  -- rating, Riyadh monthly apartments (inclusion–exclusion)
  select af_eligible_count(p_deal:='إيجار', p_rent_period:='شهري', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential', p_rating_buckets:=array['9.5','9.0_rc10']) into u;
  select af_eligible_count(p_deal:='إيجار', p_rent_period:='شهري', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential', p_rating_min:=9.5) into p1;
  select af_eligible_count(p_deal:='إيجار', p_rent_period:='شهري', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential', p_rating_min:=9.0, p_reviews_min:=10) into p2;
  select af_eligible_count(p_deal:='إيجار', p_rent_period:='شهري', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential', p_rating_min:=9.5, p_reviews_min:=10) into p3;
  if u <> p1 + p2 - p3 then raise exception 'ABORT: rating [9.5,9.0_rc10] % <> % + % - %', u, p1, p2, p3; end if;
  if u = 0 then raise exception 'ABORT: rating union proven on an empty set — pick a richer scope'; end if;

  -- the card evidence gate opens for a mixture alone
  select to_jsonb(r) -> 'af_canon' into canon from location_search_candidates_ar(
    p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential',
    p_age_buckets:=array['new','6_9']) r limit 1;
  if canon is null or jsonb_typeof(canon) <> 'object' or not (canon ? 'property_age') then
    raise exception 'ABORT: a mixture-only search returns no af_canon (%)', canon;
  end if;

  raise notice 'OK: three union params live; existing counts unchanged (% / % / %)', a_a, a_b, a_f;
end
$do$;
