-- af_field_registry described a DIFFERENT Advanced Filter than the one that ships (ops_incident #217).
--
-- The registry is the repo's record of what every canonical field is and whether a user can filter on
-- it. Six fields disagreed with the shipped app, measured against production on 2026-09-13 over
-- 213,900 searchable rows:
--
--   direction_ar      ui_exposed=false, reason «9% coverage - too thin to be useful yet».
--                     ACTUAL 98,674/213,900 = 46.1%. The question is in COHORT_QUESTIONS
--                     (src/lib/afCohorts.ts) for Apartment/Buy, ResBldg RentAnnual+Buy, Villa and
--                     more; src/data/remote.ts sends p_directions; src/lib/afEvidence.ts renders a
--                     direction chip on the card.
--   street_width_m    ui_exposed=false, reason «12.5% coverage today». ACTUAL 89,511 = 41.8%. Same:
--                     live question, p_street_width_min sent, chip rendered.
--   rating            NO ROW AT ALL. RATING_QUESTION is live (9.5+ / 9.0+ / 9.0+ with 10+ reviews),
--                     p_rating_min is sent, star chip rendered. 25,024 rows = 11.7%.
--   reviews_count     NO ROW AT ALL. The 9.0+rc10 rung sets reviewsMin and p_reviews_min is sent, so
--                     a user can already filter on it. 25,024 rows = 11.7%.
--   unit_subtype_ar   NO ROW AT ALL. UNIT_SUBTYPE_QUESTION is live, p_unit_subtypes sent, chip
--                     rendered. 29,687 rows = 13.9%.
--   tenant_ar         NO ROW AT ALL, and the OPPOSITE direction: p_tenant is a live predicate inside
--                     af_eligibility_clause over 12,473 populated rows, and no file in src/ sends it
--                     -- an undeclared backend-only predicate.
--
-- WHICH LAYER IS WRONG: the REGISTRY. The questions are in the shipped cohort pool, the params are
-- sent by remote.ts, and afEvidence.ts renders chips for four of them. Nothing here changes product
-- behaviour -- af_field_registry is read by ZERO production functions (the one src/ mention,
-- src/app/interview.tsx, is a comment). This records what the owner-approved cohort pool already does.
--
-- THE filter_tier CORRECTION IS NOT A PRODUCT DECISION. 20260811181508 defines the vocabulary:
--   normal = Normal-Filter territory, never auto-asked  ·  advanced = the interview's question pool
--   more_options = manual «خيارات إضافية» sheet only, NEVER auto-asked  ·  backend = no UI control.
-- direction_ar and street_width_m were set to 'more_options' on 2026-08-11, before they joined the
-- interview pool. The app auto-asks both, and there is no «خيارات إضافية» sheet anywhere in src/ --
-- so 'more_options' described a UI that was never built while the interview was already asking the
-- question. 'advanced' is what the shipped product does.
--
-- BARRIER: scripts/lib/uiControlPredicates.ts registryProblems() gains the tier rule over the WHOLE
-- discovered question pool (it previously checked only the five hand-listed INTERVIEW_FIELDS, which
-- is exactly why a 'more_options' tier survived on two auto-asked fields), mutation-proven offline in
-- scripts/verify-ui-controls-have-predicates.ts and re-run live every day by
-- scripts/verify-ui-controls-have-predicates-live.ts in .github/workflows/af-live-truth-check.yml.

update public.af_field_registry
   set ui_exposed = true,
       not_exposed_reason = null,
       filter_tier = 'advanced'
 where canonical_key in ('direction_ar', 'street_width_m');

insert into public.af_field_registry
  (canonical_key, label_ar, category, datatype, allowed_values, unknown_policy,
   ui_exposed, ui_group, not_exposed_reason, concept_note, filter_tier)
values
  ('rating', 'التقييم', 'metadata', 'numeric', null, 'NULL',
   true, 'primary', null,
   'guest rating out of 10, published by gathern on monthly stays. A listing with no rating is UNKNOWN and is excluded from any rating answer - never scored 0.',
   'advanced'),
  ('reviews_count', 'عدد التقييمات', 'metadata', 'integer', null, 'NULL',
   true, 'primary', null,
   'how many reviews the rating is based on. Filterable only through the 9.0+ with 10+ reviews rung, which sets ratingMin AND reviewsMin together.',
   'advanced'),
  ('unit_subtype_ar', 'نوع الوحدة', 'metadata', 'text', null, 'NULL',
   true, 'primary', null,
   'gathern monthly sub-classification under a type_ar that stays شقة: استديو / شقق مخدومة / شقة (also غرفة, فيلا in the index). STRICT equality - a NULL subtype stays UNKNOWN and is never bucketed as شقة by default.',
   'advanced'),
  ('tenant_ar', 'نوع المستأجر', 'metadata', 'text', null, 'NULL',
   false, null,
   'backend-only: p_tenant is a live predicate in af_eligibility_clause over 12,473 populated rows (عوائل 11,810 / عزاب 663, measured 2026-09-13) but no UI control sends it. Declared here so the predicate is not undeclared; exposing it is an owner product decision, not a registry edit.',
   'tenant type the landlord will accept. Absence is UNKNOWN, never "any tenant".',
   'backend')
on conflict (canonical_key) do nothing;
