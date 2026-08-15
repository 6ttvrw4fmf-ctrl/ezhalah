-- Commercial cohort UI exposure (2026-08-16 overnight mandate). Both utility fields cleared the
-- fresh-band gates before exposure: electricity (Shop rent 943y/25n, fresh 64/wk; positive chip —
-- no-side is publish-only-when-yes on most types) and water_supply (Shop rent 840y/128n and
-- AgriPlot buy genuinely two-sided). Exposed as COHORT_CHIPS-scoped amenity chips (positive-only
-- IS TRUE tokens; unknown stays unknown). Tokens live on all 4 surfaces via 20260815234444.
insert into public.af_field_registry
  (canonical_key, label_ar, category, datatype, unknown_policy, ui_exposed, ui_group, not_exposed_reason, concept_note, filter_tier)
values
  ('electricity', 'كهرباء', 'utility', 'boolean', 'NULL', true, 'amenities', null,
   'Commercial/rural utility chip since 2026-08-16 (COHORT_CHIPS-scoped). Publish-only-when-yes on most types — positive chip, never a no-filter.', 'advanced'),
  ('water_supply', 'توفر الماء', 'utility', 'boolean', 'NULL', true, 'amenities', null,
   'Commercial/rural utility chip since 2026-08-16 (COHORT_CHIPS-scoped). Two-sided on Shop rent and AgriPlot buy.', 'advanced')
on conflict (canonical_key) do update
  set ui_exposed = true, ui_group = 'amenities', not_exposed_reason = null, filter_tier = 'advanced',
      concept_note = excluded.concept_note;

do $$
begin
  if (select count(*) from public.af_field_registry
       where canonical_key in ('electricity','water_supply') and ui_exposed and filter_tier='advanced') <> 2 then
    raise exception 'ABORT: utility chip registry rows not as expected';
  end if;
end $$;