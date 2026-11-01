-- «أرض خام» / Buy — Advanced Filter cohort certification (owner 2026-10-09: «make an advanced filter for
-- أرض خام»). Product Contract R2.1.2: no question ships without a registry row; this is that row.
-- Profiled on the 6,008 tagged rows (5,939 Buy / 69 Rent → Buy only): street width known 92% (p25 15 m,
-- p75 25 m), direction known 84% over 8 values (شرق 1,083 · جنوب 1,059 · شمال 1,006 · غرب 986 · four
-- diagonals 194–242). Parity measured live, RPC vs direct SQL: street ≥ 20 m 2,816 = 2,816; Riyadh +
-- شمال 220 = 220. No utility chips: a raw land is defined by «no electricity/water/sewage».
insert into public.af_cohort_registry (deal_ar, rent_period_ar, type_ar, enabled, note)
values ('بيع', null, 'أرض خام', true,
        'Certified 2026-10-09 — RawLand/Buy (n=5,939; street 92% + direction 84%; parity sw>=20 2,816=2,816, Riyadh+شمال 220=220). Type token = unit_subtype_ar tag, not a stored type_ar.')
on conflict do nothing;
