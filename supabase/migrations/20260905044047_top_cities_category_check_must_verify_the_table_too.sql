-- top_cities_by_deal_ar's p_category filter trusted known_type_ar.macro ALONE for a type whose
-- macro is a single category (not 'both') — it only cross-checked the row's own source_table
-- suffix when macro='both'. That is a SECOND, independent definition of "is this row Residential
-- or Commercial", separate from the one location_search_candidates_ar / the client actually use
-- (p_tables / p_tables2, derived from SEARCHABLE_TABLES filtered by table-name suffix — see
-- src/data/remote.ts resTables()/comTables()). Exactly the class this repo already has a permanent
-- rule against: a count surface must share the results scope, never keep a second copy
-- (feedback_a-count-surface-must-share-the-results-scope).
--
-- THE SYMPTOM (owner-reported, reproduced twice, independently confirmed here a third time):
-- شقة (apartment) has macro='Residential' in known_type_ar. Row dealapp_commercial_listings#693812
-- is type_ar='شقة', deal_ar='إيجار', city_ar='مكة المكرمة', production_ready=true — a شقة-typed row
-- sitting in a _commercial_listings table. top_cities_by_deal_ar's old clause admitted it into the
-- Residential/مكة المكرمة/شقة/إيجار/سنوي cohort purely because macro='Residential' matched
-- p_category='Residential' — it never checked that the table itself is a commercial one. Measured:
-- Trending 556 vs. location_search_candidates_ar (called the way the real client scopes it, with
-- p_tables restricted to residential-suffix tables) = 555, and an independent oracle directly on
-- search_listings_ar also 555, id-sets identical (0 missing/extra). +1 exactly this one row.
--
-- THE FIX: require the table-suffix check UNCONDITIONALLY whenever p_category is Residential or
-- Commercial — not only on the macro='both' branch. A row now counts toward p_category only when
-- BOTH its type's macro is compatible (exact match or 'both') AND its own source_table physically
-- ends in the matching suffix. This is the SAME predicate location_search_candidates_ar effectively
-- enforces via p_tables/p_tables2, so the two surfaces can no longer disagree on this axis for any
-- type/table combination, not just the one row measured today.
--
-- top_cities_by_deal_ar is NOT in af_rpc_templates (confirmed: only af_eligible_count,
-- apartment_guided_counts_ar, location_search_candidates_ar, property_age_option_counts_ar are
-- templated), so this is a needle-edit from pg_get_functiondef of the LIVE function, never a stale
-- copy — the 37-param signature is untouched (CREATE OR REPLACE on an unchanged signature, no new
-- overload risk). Verified 2026-09-05 in a rolled-back DO block against a pg_temp copy of this exact
-- fix: Makkah 556 -> 555 (matches the independently-measured correct value); four unrelated scopes
-- (Riyadh residential apartment rent, Dammam residential land buy, Jeddah residential villa buy,
-- Riyadh COMMERCIAL office rent) were byte-identical before and after — confirming no regression on
-- either category and no double-fix on the commercial side.
--
-- Self-verifying: needle-edit only if the OLD anchor is present and occurs exactly once (idempotent
-- if a prior run already applied it); re-measures the same 5 scopes against the LIVE function after
-- CREATE OR REPLACE and ABORTS if Makkah is not exactly 555 or if any of the four control scopes
-- moved from their pre-migration value.
do $migration$
declare
  def text;
  old_clause text := $x$and (p_category is null
           or exists (
             select 1 from known_type_ar k
             where k.type_ar = s.type_ar
               and (
                 k.macro = p_category
                 or (
                   k.macro = 'both'
                   and (case p_category
                          when 'Residential' then s.source_table like '%\_residential\_listings'
                          when 'Commercial'  then s.source_table like '%\_commercial\_listings'
                          else true
                        end)
                 )
               )
           ))$x$;
  new_clause text := $x$and (p_category is null
           or exists (
             select 1 from known_type_ar k
             where k.type_ar = s.type_ar
               and (k.macro = p_category or k.macro = 'both')
               and (case p_category
                      when 'Residential' then s.source_table like '%\_residential\_listings'
                      when 'Commercial'  then s.source_table like '%\_commercial\_listings'
                      else true
                    end)
           ))$x$;
  occ int;
  makkah_after int;
  riyadh_before int := 3678;
  dammam_before int := 381;
  jeddah_before int := 3565;
  office_before int := 1669;
  riyadh_after int;
  dammam_after int;
  jeddah_after int;
  office_after int;
begin
  select pg_get_functiondef(oid) into def from pg_proc where proname = 'top_cities_by_deal_ar';
  if def is null then
    raise exception 'ABORT: public.top_cities_by_deal_ar not found';
  end if;

  if position(new_clause in def) > 0 then
    raise notice 'top_cities_by_deal_ar already carries the fixed category clause — skipping';
  else
    occ := (length(def) - length(replace(def, old_clause, ''))) / length(old_clause);
    if occ <> 1 then
      raise exception 'ABORT: old category-clause anchor occurs % (expected exactly 1) — refusing to guess', occ;
    end if;

    def := replace(def, old_clause, new_clause);
    execute def;
  end if;

  -- self-check against the LIVE function post-apply
  select listing_count into makkah_after
    from public.top_cities_by_deal_ar(p_deal := 'إيجار', p_rent_period := 'سنوي', p_category := 'Residential', p_types := array['شقة'])
    where city_ar = 'مكة المكرمة';
  if makkah_after is distinct from 555 then
    raise exception 'ABORT: مكة المكرمة/شقة/إيجار/سنوي listing_count = % after fix, expected 555', makkah_after;
  end if;

  select listing_count into riyadh_after
    from public.top_cities_by_deal_ar(p_deal := 'إيجار', p_rent_period := 'سنوي', p_category := 'Residential', p_types := array['شقة'], p_bath_min := 1)
    where city_ar = 'الرياض';
  select listing_count into dammam_after
    from public.top_cities_by_deal_ar(p_deal := 'بيع', p_category := 'Residential', p_types := array['أرض سكنية'])
    where city_ar = 'الدمام';
  select listing_count into jeddah_after
    from public.top_cities_by_deal_ar(p_deal := 'بيع', p_category := 'Residential', p_types := array['فيلا'])
    where city_ar = 'جدة';
  select listing_count into office_after
    from public.top_cities_by_deal_ar(p_deal := 'إيجار', p_category := 'Commercial', p_types := array['مكتب'])
    where city_ar = 'الرياض';

  if riyadh_after is distinct from riyadh_before or dammam_after is distinct from dammam_before
     or jeddah_after is distinct from jeddah_before or office_after is distinct from office_before then
    raise exception 'ABORT: a control scope moved — riyadh % (was %), dammam % (was %), jeddah % (was %), office % (was %)',
      riyadh_after, riyadh_before, dammam_after, dammam_before, jeddah_after, jeddah_before, office_after, office_before;
  end if;

  raise notice 'top_cities_by_deal_ar category fix applied and self-verified: مكة المكرمة/شقة/إيجار/سنوي = 555, four control scopes unchanged (riyadh=%, dammam=%, jeddah=%, office=%)',
    riyadh_after, dammam_after, jeddah_after, office_after;
end;
$migration$;
