-- «أرض» (Other Land) / Buy — Advanced Filter cohort certification (owner 2026-10-10: an Aqar plot whose
-- source states no usage gets its own «أرض أخرى» box in «الأراضي»). Product Contract R2.1.2: no question
-- ships without a registry row; this is that row. Questions = only what every land type already shares
-- (street width, facade) — true of any plot whatever its usage. Profiled on the 4,040 plots the rule
-- types «أرض» (all Buy): street width known 99% (p25 15 m, p75 30 m; ≥ 20 m 2,249), facade known 88%
-- (شمال 716 · شرق 671 · جنوب 605 · غرب 595 · diagonals 142–195 · 3/4 شوارع 154/96); Riyadh + شمال 177.
insert into public.af_cohort_registry (deal_ar, rent_period_ar, type_ar, enabled, note)
values ('بيع', null, 'أرض', true,
        'Certified 2026-10-10 — OtherLand/Buy (n=4,040; street 99% + direction 88%; sw>=20 2,249, Riyadh+شمال 177). Land with no stated usage; questions shared by every land type.')
on conflict do nothing;