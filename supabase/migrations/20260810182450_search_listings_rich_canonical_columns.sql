-- Rich canonical columns for Annual Rent -> Apartment.
--
-- EVERY column is nullable with NO DEFAULT. That is not an oversight - it is the
-- Safety Barrier expressed in DDL. A DEFAULT would manufacture a value for every
-- row that omits the column, with no code involved and nothing to grep. That is
-- exactly the defect that put 849,299 invented negatives into this database.
-- detect_boolean_column_defaults() fails the build if one is ever added.
--
-- Adding nullable columns without defaults is metadata-only in PG11+ - no table
-- rewrite, no load. (Learned the hard way today: never bulk-rewrite this table.)
--
-- Concepts kept deliberately apart (see af_field_registry.concept_note):
--   air_conditioner (availability)  vs  ac_type (typed value)
--   parking         (availability)  vs  parking_count  vs  parking_type
--   kitchen         (boolean)       vs  kitchen_status (راكب/تأسيس/لا يوجد)
--   furnished       (boolean)       vs  furnishing_level (3-value)
--   living_rooms (صالة)             vs  majlis_rooms (مجلس)
--   floor_number (the unit)         vs  total_floors (the building)
--   direction_ar (compass)          vs  frontage_count (how many streets)
alter table public.search_listings_ar
  add column if not exists ac_type                    text,
  add column if not exists parking_count              smallint,
  add column if not exists parking_type               text,
  add column if not exists kitchen_status             text,
  add column if not exists furnishing_level           text,
  add column if not exists balcony                    boolean,
  add column if not exists laundry_room               boolean,
  add column if not exists pool                       boolean,
  add column if not exists gym                        boolean,
  add column if not exists garden                     boolean,
  add column if not exists separate_electricity_meter boolean,
  add column if not exists separate_water_meter       boolean,
  add column if not exists electricity                boolean,
  add column if not exists water_supply               boolean,
  add column if not exists sanitation                 boolean,
  add column if not exists living_rooms               smallint,
  add column if not exists majlis_rooms               smallint,
  add column if not exists total_floors               smallint,
  add column if not exists frontage_count             smallint,
  add column if not exists installment_available      boolean,
  add column if not exists installment_amount         numeric,
  add column if not exists installment_count          smallint,
  add column if not exists latitude                   numeric,
  add column if not exists longitude                  numeric,
  add column if not exists rega_license_status        text,
  add column if not exists postal_code                text;

comment on column public.search_listings_ar.installment_available is
  'Tri-state. TRUE only when the SOURCE publishes a landlord/provider instalment offer. A finance calculator quote (wasalt monthlyRentEMI = annual rent x1.10/1.13/1.15 / 12) is NOT an offer. Financing eligibility is NOT an offer. An annual lease payable in instalments stays إيجار/سنوي and must never become Monthly.';
comment on column public.search_listings_ar.installment_amount is
  'Only when the source publishes the amount. NEVER computed from the rent.';
comment on column public.search_listings_ar.installment_count is
  'Only when the source publishes the count. NEVER derived.';
comment on column public.search_listings_ar.frontage_count is
  'How many streets the property faces (wasalt «ثلاثة شوارع» = 3). NOT a compass direction - that is direction_ar.';
comment on column public.search_listings_ar.majlis_rooms is
  'مجلس - guest reception. NOT صالة (living_rooms). wasalt publishes both separately.';
comment on column public.search_listings_ar.total_floors is
  'Floors in the BUILDING. NOT the unit floor (floor_number).';
comment on column public.search_listings_ar.kitchen_status is
  '3-value: راكب / تأسيس / لا يوجد. "without appliances" is NOT the same as no kitchen.';
comment on column public.search_listings_ar.furnishing_level is
  '3-value: غير مفروش / مفروش جزئيا / مفروش بالكامل. A boolean cannot express "partially".';
