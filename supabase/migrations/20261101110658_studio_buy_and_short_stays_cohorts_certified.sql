-- Studio joins the Apartments & Co-living lists on Buy (78 ads: the Apartment Buy questions, a chip with 0 ads hides
-- itself) and on short stays (2,681 Gathern sub-type ads: the same 4 questions as Short stays → Apartment) — owner
-- handoff 2026-10-31, built 2026-11-01. The registry rows are what verify-af-cohort-questions-certified.ts reads:
-- a cohort that ships questions without a row is an uncertified cohort. Mirror: sql/mirrors/af_cohort_registry.sql.
insert into public.af_cohort_registry (deal_ar, rent_period_ar, type_ar, enabled, note) values
  ('بيع', null, 'استوديو', true, 'Certified 2026-11-01 — Studio/Buy: the Apartment Buy lists (owner handoff 2026-10-31).'),
  ('بيع', null, 'ستوديو', true, 'Certified 2026-11-01 — Studio/Buy: the Apartment Buy lists (owner handoff 2026-10-31).'),
  ('بيع', null, 'شقَّة صغيرة (استوديو)', true, 'Certified 2026-11-01 — Studio/Buy: the Apartment Buy lists (owner handoff 2026-10-31).'),
  ('إيجار', 'شهري', 'استوديو', true, 'Certified 2026-11-01 — Studio short stays: the one short-stays pool (owner handoff 2026-10-31).'),
  ('إيجار', 'شهري', 'ستوديو', true, 'Certified 2026-11-01 — Studio short stays: the one short-stays pool (owner handoff 2026-10-31).'),
  ('إيجار', 'شهري', 'شقَّة صغيرة (استوديو)', true, 'Certified 2026-11-01 — Studio short stays: the one short-stays pool (owner handoff 2026-10-31).')
on conflict do nothing;
