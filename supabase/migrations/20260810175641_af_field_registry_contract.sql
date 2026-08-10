-- ===========================================================================
-- ADVANCED FILTER FIELD REGISTRY — the one contract every layer reads.
--
-- Owner, 2026-08-10: "I want the architecture ready first... adding a new
-- platform later becomes mostly: discover -> map -> validate -> backfill ->
-- test -> activate, rather than creating new custom search logic."
--
-- The registry defines, ONCE, what Ezhalah collects for Annual Rent -> Apartment:
-- the canonical key, its datatype, its allowed values, whether it is exposed in
-- the Advanced Filter today, and WHY not when it isn't.
--
-- Two tables:
--   af_field_registry    - the canonical field contract (what a field MEANS)
--   af_platform_mapping  - per-platform source key -> canonical field (HOW a
--                          platform expresses it)
--
-- Deliberate separation of concerns:
--   backend decides what the field means      (af_field_registry)
--   the barrier decides whether we trust it   (detect_* tripwires)
--   search decides eligibility                (location_search_candidates_ar)
--   the Advanced Filter only presents it      (ui_exposed)
--
-- `ui_exposed = false` is NOT the same as "not collected". We save every
-- trustworthy structured fact; we expose only the questions that genuinely help
-- a user narrow a large result set.
-- ===========================================================================

create table if not exists public.af_field_registry (
  canonical_key   text primary key,
  label_ar        text        not null,
  category        text        not null,   -- amenity | installment | layout | location | legal | metadata | utility
  datatype        text        not null,   -- boolean | smallint | numeric | text | enum
  allowed_values  text[],                 -- non-null only for enum
  unknown_policy  text        not null default 'NULL',
  ui_exposed      boolean     not null default false,
  ui_group        text,                   -- primary | more_options | null (backend-only)
  not_exposed_reason text,
  concept_note    text,                   -- the DO-NOT-MERGE warning for this field
  created_at      timestamptz not null default now(),
  constraint af_field_registry_unknown_policy_ck check (unknown_policy = 'NULL'),
  constraint af_field_registry_enum_ck
    check (datatype <> 'enum' or allowed_values is not null),
  constraint af_field_registry_exposed_needs_reason_ck
    check (ui_exposed or not_exposed_reason is not null)
);

comment on table public.af_field_registry is
  'The Advanced Filter field contract. One row per canonical Ezhalah field. unknown_policy is fixed at NULL by CHECK - source silence may never become false. A field that is not ui_exposed must say why.';

create table if not exists public.af_platform_mapping (
  platform        text not null,
  canonical_key   text not null references public.af_field_registry(canonical_key) on delete cascade,
  source_key      text not null,          -- EXACT key as the platform publishes it
  source_location text not null,          -- raw_column | source_capture | additional_info | ar_data | extended_details | not_captured
  value_mapping   jsonb,                  -- source value -> canonical value, when not a straight copy
  verified_at     timestamptz,
  notes           text,
  primary key (platform, canonical_key, source_key)
);

comment on table public.af_platform_mapping is
  'Platform source key -> canonical Ezhalah field. Adding a platform means adding rows here, not redesigning search. source_location = not_captured records a field the platform publishes that we knowingly do not yet read.';

create index if not exists ix_af_platform_mapping_canonical on public.af_platform_mapping(canonical_key);

-- ---------------------------------------------------------------------------
-- The canonical field set for Annual Rent -> Apartment.
-- concept_note carries the DO-NOT-MERGE rule so it travels with the field.
-- ---------------------------------------------------------------------------
insert into public.af_field_registry
  (canonical_key, label_ar, category, datatype, allowed_values, ui_exposed, ui_group, not_exposed_reason, concept_note)
values
  -- amenities (booleans)
  ('air_conditioner','تكييف','amenity','boolean',null,true,'primary',null,'availability only; the TYPE lives in ac_type and must never be collapsed into this'),
  ('elevator','مصعد','amenity','boolean',null,true,'primary',null,null),
  ('private_entrance','مدخل خاص','amenity','boolean',null,true,'primary',null,null),
  ('kitchen','مطبخ','amenity','boolean',null,true,'more_options',null,'boolean only; sanadak/satel publish a RICHER status - see kitchen_status. "without appliances" is NOT false'),
  ('parking','موقف سيارات','amenity','boolean',null,true,'more_options',null,'availability only; count and type are separate fields'),
  ('maid_room','غرفة خادمة','amenity','boolean',null,true,'more_options',null,null),
  ('driver_room','غرفة سائق','amenity','boolean',null,true,'more_options',null,null),
  ('balcony','شرفة','amenity','boolean',null,false,null,'stored, coverage still thin outside aqar/wasalt',null),
  ('laundry_room','غرفة غسيل','amenity','boolean',null,false,null,'stored, coverage still thin',null),
  ('pool','مسبح','amenity','boolean',null,false,null,'only sanadak publishes it and says NO on 184/184 - a UI chip would return zero results',null),
  ('gym','نادي رياضي','amenity','boolean',null,false,null,'only sanadak publishes it and says NO on 184/184 - a UI chip would return zero results',null),
  ('garden','حديقة / حوش','amenity','boolean',null,false,null,'only sanadak publishes it and says NO on 184/184 - a UI chip would return zero results',null),
  ('separate_electricity_meter','عداد كهرباء مستقل','utility','boolean',null,false,null,'97.6% yes among known - filters data coverage, not the property',null),
  ('separate_water_meter','عداد مياه مستقل','utility','boolean',null,false,null,'94.1% yes among known - filters data coverage, not the property',null),
  ('electricity','كهرباء','utility','boolean',null,false,null,'backend-only for now',null),
  ('water_supply','مياه','utility','boolean',null,false,null,'backend-only for now',null),
  ('sanitation','صرف صحي','utility','boolean',null,false,null,'backend-only for now',null),

  -- rich companions (never collapsed into their boolean)
  ('ac_type','نوع التكييف','amenity','text',null,false,null,'backend-only; sanadak + satel publish typed values','Split / Central / Duct / Window. Availability is air_conditioner - do NOT merge'),
  ('parking_count','عدد المواقف','amenity','smallint',null,false,null,'backend-only; wasalt 1-28, satel 0-2','a count is not availability'),
  ('parking_type','نوع الموقف','amenity','text',null,false,null,'backend-only; satel underground/outdoor/shaded',null),
  ('kitchen_status','حالة المطبخ','amenity','enum',array['راكب','تأسيس','لا يوجد'],false,null,'backend-only until coverage beyond sanadak','3-value; "تأسيس" is neither yes nor no'),
  ('furnishing_level','مستوى التأثيث','amenity','enum',array['غير مفروش','مفروش جزئيا','مفروش بالكامل'],false,null,'backend-only until the aqar prose override is fixed','a boolean cannot express "partially" - do NOT collapse into furnished'),

  -- layout
  ('living_rooms','صالة','layout','smallint',null,false,null,'backend-only','صالة is NOT مجلس - wasalt publishes both separately'),
  ('majlis_rooms','مجلس','layout','smallint',null,false,null,'backend-only','مجلس is NOT صالة - guest reception, not living room'),
  ('floor_number','الدور','layout','smallint',null,false,null,'16.6% coverage - too thin to be useful yet',null),
  ('total_floors','عدد الأدوار','layout','smallint',null,false,null,'never built in the pipeline; wasalt/aldarim publish it','building height, NOT the unit floor'),

  -- location / dimensions
  ('direction_ar','اتجاه العقار','location','enum',array['شمال','جنوب','شرق','غرب','شمال شرقي','شمال غربي','جنوب شرقي','جنوب غربي'],false,null,'9% coverage - too thin to be useful yet','compass bearing ONLY. "ثلاثة شوارع" is frontage_count, a different concept'),
  ('frontage_count','عدد الواجهات','location','smallint',null,false,null,'backend-only; wasalt 6,289','how many streets the property faces. NOT a compass direction'),
  ('street_width_m','عرض الشارع','location','smallint',null,false,null,'12.5% coverage today','single width; aldarim publishes per-side widths separately'),
  ('latitude','خط العرض','location','numeric',null,false,null,'backend-only; ~10,100 listings carry exact coordinates',null),
  ('longitude','خط الطول','location','numeric',null,false,null,'backend-only; ~10,100 listings carry exact coordinates',null),

  -- installments  (the owner-critical distinctions)
  ('installment_available','التقسيط','installment','boolean',null,true,'primary',null,'ONLY a landlord/source-published instalment offer. A finance CALCULATOR quote (wasalt EMI = rent x1.10/1.13/1.15 / 12) is NOT this. Financing ELIGIBILITY is not this. And an annual lease payable monthly stays إيجار/سنوي - it never becomes Monthly'),
  ('installment_amount','قيمة القسط','installment','numeric',null,false,null,'backend-only, shown on listing detail','store ONLY if the source publishes the amount. Never compute it'),
  ('installment_count','عدد الأقساط','installment','smallint',null,false,null,'backend-only, shown on listing detail','store ONLY if the source publishes the count. Never derive it'),

  -- already-live canonical fields
  ('property_age','عمر العقار','metadata','smallint',null,true,'primary',null,'age in years. Build year is a DIFFERENT fact - never convert one into the other'),
  ('bedrooms','غرف النوم','layout','smallint',null,true,'primary',null,'bedrooms only - NOT total rooms'),
  ('bathrooms','دورات المياه','layout','smallint',null,true,'primary',null,null),
  ('furnished','مفروش','amenity','boolean',null,true,'more_options',null,'boolean; the graded value is furnishing_level'),

  -- legal
  ('license_number','رقم ترخيص الإعلان','legal','text',null,false,null,'p_has_license exists but no UI control references it','the REGA AD licence number. Not the issue date, not the FAL broker licence, not the deed number'),
  ('rega_license_status','حالة الترخيص','legal','text',null,false,null,'backend-only; aqarcity is the only publisher',null),
  ('postal_code','الرمز البريدي','location','text',null,false,null,'backend-only',null)
on conflict (canonical_key) do nothing;
