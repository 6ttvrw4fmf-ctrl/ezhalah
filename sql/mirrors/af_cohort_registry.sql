-- MIRROR of the LIVE production TABLE public.af_cohort_registry. NOT a migration — this file is
-- READ, never applied; the rows below already exist in production and the insert is written
-- idempotently only so the mirror is a runnable statement rather than a blob.
-- Re-verified 2026-09-02 during the AF option-truth certification: the production ROWS md5,
--   re-derived with the exact recipe below, = e24bc3e63b85a7d2c84714b03ff5b710 — identical to the
--   value recorded here, 59 rows all enabled, so the registry is UNCHANGED. Re-stamped only
--   because that certification's migrations READ this table by name. Nothing was edited.
-- Refreshed 2026-08-30 (first capture) by the AF + Trending Data Integrity routine
--   (docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md).
--
--   WHY THIS MIRROR EXISTS. Product Contract R2.1.2 — «No question ships without a ledger entry» —
--   was enforced by NOTHING (graded N in scripts/lib/afContractCoverage.ts). The registry is the
--   stronger of the two anchors the contract names: it is per `type_ar × deal × rent_period` with
--   the certification evidence in its `note`, and AF_COHORT_LEDGER.md's own header calls the file
--   PLUS this table "the control plane". `npm test` is hermetic and cannot query production, so
--   scripts/verify-af-cohort-questions-certified.ts reads this mirror instead.
--
-- Verified byte-exact against production 2026-08-30. Two digests, both re-derivable:
--   • md5 of everything below this header block: 0253222268a6c60ee2be861a894e2c95
--     (what scripts/verify-sql-mirrors-not-stale.ts checks — self-consistency of THIS file)
--   • md5 of the production ROWS themselves: e24bc3e63b85a7d2c84714b03ff5b710
--     re-derive with, and compare, exactly this:
--       select md5(string_agg(format('%s|%s|%s|%s', deal_ar, coalesce(rent_period_ar,''),
--                                    type_ar, enabled), E'\n'
--                   order by deal_ar, coalesce(rent_period_ar,''), type_ar))
--       from af_cohort_registry;
--     59 rows, 0 disabled, on the day of capture. A mismatch means the registry moved and this
--     mirror (and any cohort that newly lost its certification) needs re-checking — never that the
--     barrier should be loosened.
insert into public.af_cohort_registry (deal_ar, rent_period_ar, type_ar, enabled) values
  ('إيجار', 'سنوي', 'أرض سكنية', true),
  ('إيجار', 'سنوي', 'استراحة', true),
  ('إيجار', 'سنوي', 'استوديو', true),
  ('إيجار', 'سنوي', 'برج', true),
  ('إيجار', 'سنوي', 'بيت', true),
  ('إيجار', 'سنوي', 'تاون هاوس', true),
  ('إيجار', 'سنوي', 'درايف ثرو', true),
  ('إيجار', 'سنوي', 'دور', true),
  ('إيجار', 'سنوي', 'ستوديو', true),
  ('إيجار', 'سنوي', 'شقة', true),
  ('إيجار', 'سنوي', 'شقَّة صغيرة (استوديو)', true),
  ('إيجار', 'سنوي', 'عمارة', true),
  ('إيجار', 'سنوي', 'غرفة', true),
  ('إيجار', 'سنوي', 'فيلا', true),
  ('إيجار', 'سنوي', 'كشك', true),
  ('إيجار', 'سنوي', 'مبنى تجاري', true),
  ('إيجار', 'سنوي', 'مجمع', true),
  ('إيجار', 'سنوي', 'مجمع سكني', true),
  ('إيجار', 'سنوي', 'محطة وقود', true),
  ('إيجار', 'سنوي', 'محل', true),
  ('إيجار', 'سنوي', 'مستودع', true),
  ('إيجار', 'سنوي', 'مصنع', true),
  ('إيجار', 'سنوي', 'معرض', true),
  ('إيجار', 'سنوي', 'مكاتب مشتركة', true),
  ('إيجار', 'سنوي', 'مكتب', true),
  ('إيجار', 'سنوي', 'ورشة', true),
  ('إيجار', 'شهري', 'شقة', true),
  ('إيجار', 'شهري', 'غرفة', true),
  ('إيجار', 'شهري', 'فيلا', true),
  ('بيع', NULL, 'أرض تجارية', true),
  ('بيع', NULL, 'أرض زراعية', true),
  ('بيع', NULL, 'أرض سكنية', true),
  ('بيع', NULL, 'أرض صناعية', true),
  ('بيع', NULL, 'استراحة', true),
  ('بيع', NULL, 'برج', true),
  ('بيع', NULL, 'بيت', true),
  ('بيع', NULL, 'تاون هاوس', true),
  ('بيع', NULL, 'درايف ثرو', true),
  ('بيع', NULL, 'دوبلكس', true),
  ('بيع', NULL, 'دور', true),
  ('بيع', NULL, 'شقة', true),
  ('بيع', NULL, 'عمارة', true),
  ('بيع', NULL, 'فندق', true),
  ('بيع', NULL, 'فيلا', true),
  ('بيع', NULL, 'كشك', true),
  ('بيع', NULL, 'مبنى تجاري', true),
  ('بيع', NULL, 'مبنى شقق مخدومة', true),
  ('بيع', NULL, 'مجمع', true),
  ('بيع', NULL, 'مجمع سكني', true),
  ('بيع', NULL, 'محطة وقود', true),
  ('بيع', NULL, 'محل', true),
  ('بيع', NULL, 'مزرعة', true),
  ('بيع', NULL, 'مستودع', true),
  ('بيع', NULL, 'مصنع', true),
  ('بيع', NULL, 'معرض', true),
  ('بيع', NULL, 'مكاتب مشتركة', true),
  ('بيع', NULL, 'مكتب', true),
  ('بيع', NULL, 'ملحق علوي', true),
  ('بيع', NULL, 'ورشة', true)
on conflict do nothing;
