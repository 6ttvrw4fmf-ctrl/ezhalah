-- mon_detect_city_resolution_ignores_region() has TWO limbs. Limb 2 (behavioural) is the one that
-- finds real damage: an overlay-resolved listing served under the wrong same-name twin. It has read
-- ZERO for the whole life of alert 1286 (P1, raised 2026-09-02, still open 2026-09-12).
--
-- Limb 1 (structural) is a code-shape heuristic: "touches loc_catalog_city + city_norm, never
-- mentions loc_catalog_region". That shape is shared by two DIFFERENT things — an object that
-- ASSIGNS a canonical city to a listing (must be region-scoped; this is the defect the detector
-- exists for) and an object that merely FILTERS or TESTS MEMBERSHIP against the caller's own scope
-- (must NOT be region-scoped — narrowing it would change search breadth or make a QA oracle diverge
-- from the RPC it mirrors). The detector's author already anticipated exactly this and built
-- ops_city_resolution_exempt as the lever; seven objects are declared there on that reasoning
-- (location_search_candidates_ar, composite_match_city_ids, ops_qa_search_differential, …).
--
-- These three are the same class, and none of them can assign a city to a listing. The barrier is
-- NOT loosened: limb 2 is untouched, limb 1 still fires for every object outside this table, and
-- removing any row below makes it fire again (proven by doing exactly that, 2026-09-12).
insert into public.ops_city_resolution_exempt (object_name, reason, decided_at) values
  ('district_trailing_catalog_city_norm',
   'ID-FREE MEMBERSHIP TEST, not a resolver. Its only catalog access is '
   || '`where exists (select 1 from loc_catalog_city c where c.city_norm = w.k)` and it returns the '
   || 'NAME (city_norm), never a city_id — so it cannot assign a city to anything. Region-scoping it '
   || 'would be actively WRONG: its whole purpose is to answer "is this trailing token a city name" '
   || 'for a row whose city is an unresolvable same-name twin, i.e. precisely where _pick_candidate() '
   || 'must stay silent. It is the oracle for the aqarmonthly glued-district rule '
   || '(mon_detect_aqarmonthly_district_city_suffix city-NULL limbs) and its Python mirror '
   || 'scrapers/common/arabic_location.py::trailing_catalog_city_norm().',
   now()),
  ('district_options_ar',
   'SEARCH-BREADTH EXPANSION, not a canonical assignment. It expands the CALLER''s city tokens to the '
   || 'SET of matching ids (`select cc.city_id from loc_catalog_city cc join city_tokens t on '
   || 'cc.city_norm = t.tok`, union the alias table) purely to filter which districts to offer. '
   || 'Identical reasoning to composite_match_city_ids, already exempt: deliberately many-to-many, '
   || 'never a canonical assignment. Narrowing it by region would silently drop districts from the '
   || 'options list for a twin city the user legitimately selected.',
   now()),
  ('ops_nf_cert_cell',
   'QA CERT ORACLE that mirrors location_search_candidates_ar''s row gate — exempt for the same '
   || 'reason already recorded for ops_qa_search_differential. Its catalog use is a filter '
   || '(`s.city_id in (select city_id from loc_catalog_city where city_norm = normalize_ar($1))` and '
   || 'the match_city_ids overlap test); it consumes the caller''s scope and never derives a canonical '
   || 'city from a name. Region-scoping it would make the oracle diverge from the RPC it exists to '
   || 'check, which is the one thing a differential oracle must never do.',
   now())
on conflict do nothing;