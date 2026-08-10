-- Platform -> canonical mappings, seeded from the 2026-08-10 source-discovery audit.
-- source_location tells the extraction layer WHERE to read the value:
--   raw_column        - a typed column on <platform>_residential_listings
--   ar_data           - wasalt's Arabic detail payload (jsonb, already stored on 62,681/62,693 rows)
--   source_capture    - the captured source payload (jsonb)
--   additional_info   - the captured attribute panel (jsonb)
--   extended_details  - aqar's nested detail object
--   not_captured      - the platform PUBLISHES it and we knowingly do not read it yet.
--                       Recorded on purpose: a known gap is a work item, not a fact to forget.
insert into public.af_platform_mapping (platform, canonical_key, source_key, source_location, verified_at, notes) values
  -- ---------------- aqar (11,127 annual-rent apartments) ----------------
  ('aqar','air_conditioner','ac','raw_column',now(),'10,486 non-null / 6,086 true'),
  ('aqar','elevator','lift','raw_column',now(),'10,443 non-null / 4,974 true'),
  ('aqar','kitchen','ketchen','raw_column',now(),'source spelling is "ketchen"; 10,546 non-null'),
  ('aqar','private_entrance','special_entrance','raw_column',now(),'10,105 non-null / 2,569 true'),
  ('aqar','parking','extended_details.special_parking','extended_details',now(),'only 429 non-null - genuinely thin at source'),
  ('aqar','maid_room','maid_room','raw_column',now(),'834 true, no falses - presence-only signal'),
  ('aqar','driver_room','driver_room','raw_column',now(),'186 true, no falses - presence-only signal'),
  ('aqar','furnished','furnished','raw_column',now(),'P0: trg_aqar_parse lets PROSE override the structured 0/1'),
  ('aqar','property_age','property_age','raw_column',now(),'10,551 non-null'),
  ('aqar','floor_number','fl','raw_column',now(),'source publishes a clean int; we currently prefer prose'),
  ('aqar','street_width_m','street_width_m','raw_column',now(),'2,652 non-null'),
  ('aqar','license_number','license_number','raw_column',now(),'9,287 non-null'),
  ('aqar','balcony','balcony_terrace','raw_column',now(),'376 non-null / 122 true'),
  ('aqar','laundry_room','laundry_room','raw_column',now(),'374 non-null / 123 true'),
  ('aqar','separate_electricity_meter','separate_electricity_meter','raw_column',now(),'426 non-null'),
  ('aqar','separate_water_meter','separate_water_meter','raw_column',now(),'382 non-null'),
  ('aqar','electricity','electricity','raw_column',now(),'1,856 non-null'),
  ('aqar','water_supply','water_supply','raw_column',now(),'1,855 non-null'),
  ('aqar','sanitation','sanitation','raw_column',now(),'1,855 non-null'),
  ('aqar','living_rooms','livings','raw_column',now(),'stored as halls; 7,335 non-null'),
  ('aqar','majlis_rooms','reception_rooms_majlis','raw_column',now(),'514 non-null - distinct from living_rooms'),
  ('aqar','installment_available','accept_monthly / accept_quarterly / accept_semiannually','not_captured',now(),'THE true landlord-acceptance signal. Present on ~87-91% of a live sample. Never scraped. Current rent_now_pay_later is only an "/rnpl/" marker scan'),
  ('aqar','installment_amount','rnpl_monthly_price','raw_column',now(),'rent_now_pay_later_monthly, 6,672 non-null - stored, never reaches search'),
  ('aqar','installment_count','price_2_payments / price_4_payments / price_12_payments','not_captured',now(),'source publishes split-payment prices on ~87% of a live sample'),
  ('aqar','direction_ar','direction_id','not_captured',now(),'our direction column is 99.98% empty and its 2 non-empty values are scraped page junk'),

  -- ---------------- wasalt (8,577) - ar_data already stored, no re-scrape needed ----------------
  ('wasalt','separate_electricity_meter','additionalAttributes[electricityMeter]','ar_data',now(),'8,577 published: 8,443 نعم / 134 لا - genuine tri-state'),
  ('wasalt','separate_water_meter','additionalAttributes[waterMeter]','ar_data',now(),'8,577 published: 8,280 نعم / 297 لا'),
  ('wasalt','property_age','additionalAttributes[completionYear]','ar_data',now(),'8,541 published'),
  ('wasalt','floor_number','additionalAttributes[floorNumber]','ar_data',now(),'210 published'),
  ('wasalt','total_floors','additionalAttributes[noOfFloors]','ar_data',now(),'128 published - no canonical column existed before'),
  ('wasalt','parking_count','additionalAttributes[noOfParkings]','ar_data',now(),'134 published, values 1-28'),
  ('wasalt','street_width_m','additionalAttributes[propertyStreetWidth]','ar_data',now(),'102 published; streetInfo.streetWidth adds 1,950'),
  ('wasalt','direction_ar','additionalAttributes[propertyFacade]','ar_data',now(),'1,911 are true compass values'),
  ('wasalt','frontage_count','additionalAttributes[propertyFacade]','ar_data',now(),'6,289 are «ثلاثة شوارع» / «اربعة شوارع» - a FRONTAGE COUNT, not a direction. Same source key, two different canonical fields'),
  ('wasalt','postal_code','additionalAttributes[zipCode]','ar_data',now(),'8,541 published'),
  ('wasalt','license_number','regaVerifiedInfo.adLicenseNumber','ar_data',now(),'2,172 published; regaAdvLicDate is the ISSUE DATE, not the number'),
  ('wasalt','living_rooms','attributes[noOfLivingrooms]','ar_data',now(),'304 published. Scraper reads noOfLivingRooms (capital R) so 0 are stored'),
  ('wasalt','majlis_rooms','attributes[noOfGuestrooms]','ar_data',now(),'163 published - distinct from living_rooms'),
  ('wasalt','furnishing_level','attributes[furnishingType]','ar_data',now(),'312 published in Arabic; only 5 reach search via the English panel'),
  ('wasalt','bathrooms','attributes[noOfBathrooms]','ar_data',now(),'385 published'),
  ('wasalt','parking','featureAmenities','raw_column',now(),'227 detail-fetched rows: 74 true / 153 false'),
  ('wasalt','maid_room','featureAmenities','raw_column',now(),'227 rows: 43 true'),
  ('wasalt','driver_room','featureAmenities','raw_column',now(),'227 rows: 14 true'),
  ('wasalt','balcony','featureAmenities','raw_column',now(),'227 rows: 48 true'),
  ('wasalt','laundry_room','featureAmenities','raw_column',now(),'227 rows: 41 true'),
  ('wasalt','kitchen','featureAmenities','raw_column',now(),'227 rows: 7 true'),
  ('wasalt','latitude','latitude','ar_data',now(),'8,577 published'),
  ('wasalt','longitude','longitude','ar_data',now(),'8,577 published'),

  -- ---------------- sanadak (184) - rich source_capture already stored ----------------
  ('sanadak','ac_type','acType','source_capture',now(),'76 typed: Central 17 / Split 54 / Duct 1 / None 3'),
  ('sanadak','air_conditioner','numberACs','source_capture',now(),'34 counts; acType None=3 is an explicit NO'),
  ('sanadak','kitchen_status','kitchenStatus / kitchenStatusText','source_capture',now(),'84 published: راكب 76 / تأسيس 1 / لا 7 - 3-value, not boolean'),
  ('sanadak','furnished','isFurnished','source_capture',now(),'64 published: 21 true / 43 false. No raw column exists to land it'),
  ('sanadak','floor_number','floorNo','source_capture',now(),'44 published'),
  ('sanadak','street_width_m','streetWidth','source_capture',now(),'184 published but only 2 are > 0'),
  ('sanadak','direction_ar','propertyFacingDirection','source_capture',now(),'184 published; 114 real, 70 are «لايوجد»'),
  ('sanadak','living_rooms','numberLivingRooms','source_capture',now(),'102 published'),
  ('sanadak','majlis_rooms','numberMenGuestRooms / numberWomenGuestRooms','source_capture',now(),'44 / 19 published - kept separate from living_rooms'),
  ('sanadak','maid_room','numberMaidRooms','source_capture',now(),'32 published'),
  ('sanadak','driver_room','isDriverRoomAvailable','source_capture',now(),'184/184 explicit FALSE - a source-published NO, not silence'),
  ('sanadak','pool','isSwimmingPoolAvailable','source_capture',now(),'184/184 explicit FALSE - a source-published NO'),
  ('sanadak','gym','isGymAvailable','source_capture',now(),'184/184 explicit FALSE - a source-published NO'),
  ('sanadak','garden','isGardenAvailable','source_capture',now(),'184/184 explicit FALSE - a source-published NO'),
  ('sanadak','property_age','buildingAge','source_capture',now(),'184 published, 0 reach search today'),
  ('sanadak','bathrooms','numberBathrooms','source_capture',now(),'published'),
  ('sanadak','license_number','advertisementNumber','source_capture',now(),'184 published'),

  -- ---------------- satel (42) ----------------
  ('satel','parking','parking','raw_column',now(),'42: 41 true / 1 false'),
  ('satel','parking_type','parkingType','source_capture',now(),'underground 81 / outdoor 22 / shaded 21 of the cohort'),
  ('satel','parking_count','parkingSpots','source_capture',now(),'values 0-2'),
  ('satel','kitchen','kitchen','raw_column',now(),'FIDELITY BUG: bool("without-appliances") = true, 26/125 wrongly stored as a plain yes'),
  ('satel','kitchen_status','kitchen','source_capture',now(),'2-value enum: with-appliances 99 / without-appliances 26'),
  ('satel','ac_type','acType','source_capture',now(),'split 63 / both 33 / concealed 28 of the cohort'),
  ('satel','furnishing_level','furnishing','source_capture',now(),'3-value: Unfurnished 59 / Fully 54 / Partially 12. No column exists to land it'),

  -- ---------------- aqarcity (347) - richest additional_info in the fleet ----------------
  ('aqarcity','electricity','services[كهرباء]','additional_info',now(),'340 published'),
  ('aqarcity','water_supply','services[مياه]','additional_info',now(),'337 published'),
  ('aqarcity','sanitation','services[صرف صحي]','additional_info',now(),'309 published'),
  ('aqarcity','property_age','property_age','additional_info',now(),'347/347, e.g. «اربع سنوات»'),
  ('aqarcity','direction_ar','facade','additional_info',now(),'43 published'),
  ('aqarcity','street_width_m','street_width','additional_info',now(),'2 published'),
  ('aqarcity','license_number','rega_ad_license_number','additional_info',now(),'347/347'),
  ('aqarcity','rega_license_status','rega_license_status','additional_info',now(),'347/347 «فعال» - the only platform publishing live licence status'),
  ('aqarcity','postal_code','postal_code','additional_info',now(),'347/347'),
  ('aqarcity','latitude','latitude','additional_info',now(),'347 (346 plausible, 1 bad row)'),
  ('aqarcity','longitude','longitude','additional_info',now(),'347'),

  -- ---------------- dealapp (711) ----------------
  ('dealapp','direction_ar','facade','additional_info',now(),'275 published'),
  ('dealapp','street_width_m','street_width','additional_info',now(),'517 published'),
  ('dealapp','property_age','property_age_text','additional_info',now(),'390 published'),
  ('dealapp','license_number','rega_ad_license_number','additional_info',now(),'710/711'),
  ('dealapp','latitude','latitude','additional_info',now(),'710'),
  ('dealapp','longitude','longitude','additional_info',now(),'710'),

  -- ---------------- aqaratikom (43) ----------------
  ('aqaratikom','elevator','details[مصعد]','raw_column',now(),'32 non-null: 17 true / 15 false'),
  ('aqaratikom','kitchen','details[مطبخ]','raw_column',now(),'32 non-null: 28 true / 4 false'),
  ('aqaratikom','driver_room','details[غرفة السائق]','raw_column',now(),'32 non-null, all false'),
  ('aqaratikom','pool','details[مسبح]','not_captured',now(),'18/18 of a sample publish it, 1 yes - currently discarded'),
  ('aqaratikom','garden','details[حوش]','not_captured',now(),'18/18 of a sample publish it, 2 yes - currently discarded'),
  ('aqaratikom','street_width_m','street_width_m','additional_info',now(),'32 published'),
  ('aqaratikom','license_number','rega_ad_license_number','additional_info',now(),'32 published'),
  ('aqaratikom','latitude','latitude','additional_info',now(),'43'),
  ('aqaratikom','longitude','longitude','additional_info',now(),'43'),

  -- ---------------- eastabha (51) ----------------
  ('eastabha','kitchen','مطبخ مجهز','raw_column',now(),'23 true, absence left unknown - correct presence-list handling'),
  ('eastabha','parking','كراج ملحق','raw_column',now(),'2 true'),
  ('eastabha','electricity','كهرباء','raw_column',now(),'38 true'),
  ('eastabha','water_supply','مياه','raw_column',now(),'38 true'),

  -- ---------------- abeea (26) - WP taxonomy fetched then discarded ----------------
  ('abeea','air_conditioner','property_feature[Air Condition / Central Cooling]','not_captured',now(),'26/29 of the cohort. We call the WP REST endpoint with _fields=link and throw the 73-term taxonomy away'),
  ('abeea','parking','property_feature[Garage] / fave_property_garage','not_captured',now(),'23/29, with a count'),
  ('abeea','pool','property_feature[Swimming Pool]','not_captured',now(),'6/29'),
  ('abeea','gym','property_feature[Gym]','not_captured',now(),'4/29'),
  ('abeea','garden','property_feature[Garden]','not_captured',now(),'1/29'),
  ('abeea','maid_room','property_feature[Maid Room]','not_captured',now(),'9/29')
on conflict (platform, canonical_key, source_key) do nothing;
