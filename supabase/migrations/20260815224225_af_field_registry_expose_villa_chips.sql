-- Villa cohort UI exposure (owner 2026-08-16 villa mandate). Both fields cleared the live gates on
-- FRESH data before exposure: car_entrance مدخل سيارة (buy 5,594 yes / 5,943 explicit no, 52.0%
-- known on 48h-fresh rows; rent 75.1% fresh) and sanitation صرف صحي (buy 7,377/2,829, 63.1% fresh;
-- rent 84.6% fresh). Exposed as VILLA-SCOPED amenity chips only (positive-only IS TRUE tokens;
-- unknown stays unknown and can never satisfy a chip). Tokens added to all 4 shared surfaces by
-- 20260815223500 with chips == direct SQL == referee asserted in-transaction.
insert into public.af_field_registry
  (canonical_key, label_ar, category, datatype, unknown_policy, ui_exposed, ui_group, not_exposed_reason, concept_note, filter_tier)
values
  ('car_entrance', 'مدخل سيارة', 'amenity', 'boolean', 'NULL', true, 'amenities', null,
   'Villa-form checkbox (aqar); near-perfect two-sided split on Buy. Villa-scoped chip since 2026-08-16.', 'advanced')
on conflict (canonical_key) do update
  set ui_exposed = true, ui_group = 'amenities', not_exposed_reason = null, filter_tier = 'advanced',
      concept_note = excluded.concept_note;

update public.af_field_registry
   set ui_exposed = true, ui_group = 'amenities', not_exposed_reason = null, filter_tier = 'advanced',
       concept_note = coalesce(concept_note,'') || ' Exposed 2026-08-16 as a villa-scoped chip (buy 7,377 yes / 2,829 explicit no; 63-85% known on fresh rows).'
 where canonical_key = 'sanitation';

do $$
begin
  if (select count(*) from public.af_field_registry
       where canonical_key in ('car_entrance','sanitation') and ui_exposed and filter_tier='advanced') <> 2 then
    raise exception 'ABORT: villa chip registry rows not as expected';
  end if;
end $$;