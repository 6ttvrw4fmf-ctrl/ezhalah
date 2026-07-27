-- Match-their-architecture sweep (2026-07-27): 3 real raw types with zero taxonomy entry, each
-- verified live-in-DB before mapping (aqarcity إستراحة x11 res, sanadak مجمع x8 res, sanadak برج x1 res).
-- Mirrors src/data/taxonomy.source.json / propertyTypes.ts CLEAN_TO_QUERY additions in the same PR.
insert into public.known_type_ar (type_ar, macro) values
  ('إستراحة', 'Residential'),
  ('مجمع', 'Residential'),
  ('برج', 'Residential')
on conflict (type_ar) do update set macro = excluded.macro;

insert into public.known_property_types (raw_type) values
  ('إستراحة'),
  ('مجمع'),
  ('برج')
on conflict (raw_type) do nothing;
