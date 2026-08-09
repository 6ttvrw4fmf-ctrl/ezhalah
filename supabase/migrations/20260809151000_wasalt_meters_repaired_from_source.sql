-- Repair the manufactured negatives the dropped defaults had already written, for the one platform
-- where source truth is fully provable: wasalt states waterMeter / electricityMeter as "Yes"/"No"
-- in its own additionalAttributes panel, which we already store in additional_info.
--   Yes -> true, No -> false, key absent -> NULL. Nothing is inferred.
-- Before: 0 true / 52,892 false on both columns. Source said "Yes" on 45,723 (water) and 51,801
-- (electricity). After: 0 mismatches against the source on all 52,892 active rows.
create table if not exists wasalt_meter_fabrication_repair_20260809 as
select id, active, separate_water_meter, separate_electricity_meter, now() captured_at
from wasalt_residential_listings where false;

insert into wasalt_meter_fabrication_repair_20260809
select id, active, separate_water_meter, separate_electricity_meter, now()
from wasalt_residential_listings
where separate_water_meter is not null or separate_electricity_meter is not null;

update wasalt_residential_listings w
   set separate_water_meter = case s.wm when 'Yes' then true when 'No' then false else null end,
       separate_electricity_meter = case s.em when 'Yes' then true when 'No' then false else null end
from (
  select w2.id,
    (select elem->>'value' from jsonb_array_elements(w2.additional_info) elem
      where elem->>'key'='waterMeter' limit 1) wm,
    (select elem->>'value' from jsonb_array_elements(w2.additional_info) elem
      where elem->>'key'='electricityMeter' limit 1) em
  from wasalt_residential_listings w2
) s
where s.id = w.id;
