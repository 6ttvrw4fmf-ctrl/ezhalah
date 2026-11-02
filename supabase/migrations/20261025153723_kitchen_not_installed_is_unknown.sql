-- «مطبخ غير راكب / غير مركب» — the kitchen is NOT installed: unknown, never yes (coordinator for the owner's four outcomes,
-- 2026-10-25: "prepared only" = NULL, like «مصعد مؤسس» and the AC / elevator «غير راكب» rule of PR 8674). PR 8686 makes the
-- shared reader say so: kitchen joins the not-installed rule, which is now word-bounded («مطبخ صغير راكب» is a small
-- FITTED kitchen), takes up to two describing words or a «و» co-subject («المكيفات والمطبخ: غير راكبة») but never another
-- fixture's word, and outranks a plain mention elsewhere in the ad. It also keeps a negator tied across a broken word
-- («وغير مُ مؤثثة», tuba 13261239). Pinned by scripts/verify-labelled-no-is-not-a-yes.ts.
--
-- Repair = main's reader replayed against PR 8686's over every stored row whose text says «غير راكب/مركب»; a row changes only
-- where it still holds main's answer. Sites whose own structured field states the column are never touched (aqar,
-- aqaratikom, eaqartabuk, goldendeal, muktamel, abaad, nufouth; muhaysini / dwelleo / tuba / reinvest / ebriza rows whose
-- chips or counts name a kitchen).
--   aqarcity_residential_listings        kitchen           true -> null    1
--   dealapp_residential_listings         air_conditioner   true -> null   14
--   dealapp_residential_listings         kitchen           true -> null   51
--   dwelleo_residential_listings         air_conditioner   true -> null    2
--   dwelleo_residential_listings         elevator          true -> null    1
--   dwelleo_residential_listings         kitchen           true -> null   25
--   ebriza_residential_listings          kitchen           true -> null    1
--   eilmalriyada_residential_listings    kitchen           true -> null    2
--   haraj_residential_listings           air_conditioner   true -> null    9
--   haraj_residential_listings           kitchen           true -> null   27
--   muhaysini_commercial_listings        kitchen           true -> null    2
--   muhaysini_residential_listings       air_conditioner   true -> null    1
--   muhaysini_residential_listings       kitchen           true -> null   25
--   raghdan_residential_listings         kitchen           true -> null    2
--   reinvest_residential_listings        air_conditioner   true -> null    1
--   reinvest_residential_listings        kitchen           true -> null    8
--   sirdab_commercial_listings           air_conditioner   true -> null    1
--   sirdab_commercial_listings           kitchen           true -> null    1
--   therc_residential_listings           air_conditioner   true -> null    1
--   therc_residential_listings           kitchen           true -> null    1
--   tuba_residential_listings            kitchen           true -> null    3
--   tuba_residential_listings            furnished         true -> false   1

do $r$
declare k int; done int := 0;
  g0 bigint[] := '{593976}';
  g1 bigint[] := '{7999973,16236234,16678801,17021376,17346530,17347517,17492422,17548194,17788668,17789448,18172220,18563521,20483660,20484678}';
  g2 bigint[] := '{9111947,14837941,15308621,16153563,16156361,16156580,16156677,16157291,16157321,16240311,16672134,16674973,16676982,16678801,16679132,16680646,17020751,17021376,17347517,17353274,17490077,17492422,17492554,17548194,17548830,17641057,17643795,17789448,17789958,17926734,17927170,17927652,18172220,18173876,18563521,18566529,18566849,18567549,18567873,18568950,18790777,18988712,19347709,19687758,19697399,19863338,20292067,20483591,20483660,20484678,20484862}';
  g3 bigint[] := '{13128852,13137016}';
  g4 bigint[] := '{15771579}';
  g5 bigint[] := '{13128852,13129579,13130133,13130141,13130149,13130232,13131752,13131874,13132449,13134294,13134340,13134769,13134771,13134822,13135184,13135188,13135608,13136229,13138299,13138436,13138605,13673027,13928399,13929065,15383189}';
  g6 bigint[] := '{17513425}';
  g7 bigint[] := '{13140474,13140506}';
  g8 bigint[] := '{18362431,18562741,18743819,18745693,18778080,18897867,18942858,18946194,18946391}';
  g9 bigint[] := '{18362431,18483716,18483990,18541154,18541261,18562693,18562741,18563004,18590902,18624564,18695064,18706609,18708845,18743819,18745693,18745741,18745815,18778080,18784147,18865797,18897867,18897950,18911857,18942858,19063134,19435544,20481193}';
  g10 bigint[] := '{17581999,17582088}';
  g11 bigint[] := '{18013097}';
  g12 bigint[] := '{14188669,17434399,17434410,17434418,17436779,17437172,17437173,17578174,17578175,17578176,17578177,17578178,17580053,17580057,17580201,17580368,17580845,17581061,17581380,17581516,17729326,17867527,17867848,17868141,18013097}';
  g13 bigint[] := '{12585787,15704174}';
  g14 bigint[] := '{17384273}';
  g15 bigint[] := '{13256829,13257665,13257783,13257825,13257996,13258154,14400071,17384273}';
  g16 bigint[] := '{13707314}';
  g17 bigint[] := '{13707314}';
  g18 bigint[] := '{11634237}';
  g19 bigint[] := '{11634237}';
  g20 bigint[] := '{13262569,13262570,13262571}';
  g21 bigint[] := '{13261239}';
begin
  if md5(array_to_string(g0, ',')) <> '841833b30d270b3991a83020f3fa7e39' then raise exception 'id list g0 does not match the replay'; end if;
  update public.aqarcity_residential_listings set kitchen = null where kitchen is not distinct from true and id = any(g0);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'aqarcity_residential_listings kitchen true->null: % rows, measured 1', k; end if;
  if md5(array_to_string(g1, ',')) <> 'd8390aa78ddb301092c63f2c5750e61f' then raise exception 'id list g1 does not match the replay'; end if;
  update public.dealapp_residential_listings set air_conditioner = null where air_conditioner is not distinct from true and id = any(g1);
  get diagnostics k = row_count; done := done + k;
  if k > 14 then raise exception 'dealapp_residential_listings air_conditioner true->null: % rows, measured 14', k; end if;
  if md5(array_to_string(g2, ',')) <> 'c58babc38a6c9209ca6361c8e864e6f4' then raise exception 'id list g2 does not match the replay'; end if;
  update public.dealapp_residential_listings set kitchen = null where kitchen is not distinct from true and id = any(g2);
  get diagnostics k = row_count; done := done + k;
  if k > 51 then raise exception 'dealapp_residential_listings kitchen true->null: % rows, measured 51', k; end if;
  if md5(array_to_string(g3, ',')) <> '56625bfb76d0407d53ee920c2f8150b6' then raise exception 'id list g3 does not match the replay'; end if;
  update public.dwelleo_residential_listings set air_conditioner = null where air_conditioner is not distinct from true and id = any(g3);
  get diagnostics k = row_count; done := done + k;
  if k > 2 then raise exception 'dwelleo_residential_listings air_conditioner true->null: % rows, measured 2', k; end if;
  if md5(array_to_string(g4, ',')) <> '589a0461a402fee74e177ce7827d0db5' then raise exception 'id list g4 does not match the replay'; end if;
  update public.dwelleo_residential_listings set elevator = null where elevator is not distinct from true and id = any(g4);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'dwelleo_residential_listings elevator true->null: % rows, measured 1', k; end if;
  if md5(array_to_string(g5, ',')) <> 'ba3ddf3268cf12ec6d40f52723d4c51f' then raise exception 'id list g5 does not match the replay'; end if;
  update public.dwelleo_residential_listings set kitchen = null where kitchen is not distinct from true and id = any(g5);
  get diagnostics k = row_count; done := done + k;
  if k > 25 then raise exception 'dwelleo_residential_listings kitchen true->null: % rows, measured 25', k; end if;
  if md5(array_to_string(g6, ',')) <> '854dd0942dad3f12798214357ab57d90' then raise exception 'id list g6 does not match the replay'; end if;
  update public.ebriza_residential_listings set kitchen = null where kitchen is not distinct from true and id = any(g6);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'ebriza_residential_listings kitchen true->null: % rows, measured 1', k; end if;
  if md5(array_to_string(g7, ',')) <> '7a242f18a64d5dd427d613064159687c' then raise exception 'id list g7 does not match the replay'; end if;
  update public.eilmalriyada_residential_listings set kitchen = null where kitchen is not distinct from true and id = any(g7);
  get diagnostics k = row_count; done := done + k;
  if k > 2 then raise exception 'eilmalriyada_residential_listings kitchen true->null: % rows, measured 2', k; end if;
  if md5(array_to_string(g8, ',')) <> 'd69783ac0c61495cfb918b02aedbef26' then raise exception 'id list g8 does not match the replay'; end if;
  update public.haraj_residential_listings set air_conditioner = null where air_conditioner is not distinct from true and id = any(g8);
  get diagnostics k = row_count; done := done + k;
  if k > 9 then raise exception 'haraj_residential_listings air_conditioner true->null: % rows, measured 9', k; end if;
  if md5(array_to_string(g9, ',')) <> '57f5c8a414d6c717e9a83fbd2b8741a6' then raise exception 'id list g9 does not match the replay'; end if;
  update public.haraj_residential_listings set kitchen = null where kitchen is not distinct from true and id = any(g9);
  get diagnostics k = row_count; done := done + k;
  if k > 27 then raise exception 'haraj_residential_listings kitchen true->null: % rows, measured 27', k; end if;
  if md5(array_to_string(g10, ',')) <> '758b457c7a37a18e6687c7d4237b8a44' then raise exception 'id list g10 does not match the replay'; end if;
  update public.muhaysini_commercial_listings set kitchen = null where kitchen is not distinct from true and id = any(g10);
  get diagnostics k = row_count; done := done + k;
  if k > 2 then raise exception 'muhaysini_commercial_listings kitchen true->null: % rows, measured 2', k; end if;
  if md5(array_to_string(g11, ',')) <> 'd41da3c4a4ad6a6cd99336f21291f8ca' then raise exception 'id list g11 does not match the replay'; end if;
  update public.muhaysini_residential_listings set air_conditioner = null where air_conditioner is not distinct from true and id = any(g11);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'muhaysini_residential_listings air_conditioner true->null: % rows, measured 1', k; end if;
  if md5(array_to_string(g12, ',')) <> '57b46b5d00f4cefaea1ab181955b6267' then raise exception 'id list g12 does not match the replay'; end if;
  update public.muhaysini_residential_listings set kitchen = null where kitchen is not distinct from true and id = any(g12);
  get diagnostics k = row_count; done := done + k;
  if k > 25 then raise exception 'muhaysini_residential_listings kitchen true->null: % rows, measured 25', k; end if;
  if md5(array_to_string(g13, ',')) <> 'c103e29a7268aeb5ed71579d13f70530' then raise exception 'id list g13 does not match the replay'; end if;
  update public.raghdan_residential_listings set kitchen = null where kitchen is not distinct from true and id = any(g13);
  get diagnostics k = row_count; done := done + k;
  if k > 2 then raise exception 'raghdan_residential_listings kitchen true->null: % rows, measured 2', k; end if;
  if md5(array_to_string(g14, ',')) <> 'ef6d941cce82af433a71382029e680a9' then raise exception 'id list g14 does not match the replay'; end if;
  update public.reinvest_residential_listings set air_conditioner = null where air_conditioner is not distinct from true and id = any(g14);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'reinvest_residential_listings air_conditioner true->null: % rows, measured 1', k; end if;
  if md5(array_to_string(g15, ',')) <> 'f38c4b1dceed29015031bc3cec01501b' then raise exception 'id list g15 does not match the replay'; end if;
  update public.reinvest_residential_listings set kitchen = null where kitchen is not distinct from true and id = any(g15);
  get diagnostics k = row_count; done := done + k;
  if k > 8 then raise exception 'reinvest_residential_listings kitchen true->null: % rows, measured 8', k; end if;
  if md5(array_to_string(g16, ',')) <> '355c4ae59a53c0b4de00cfb15b202b20' then raise exception 'id list g16 does not match the replay'; end if;
  update public.sirdab_commercial_listings set air_conditioner = null where air_conditioner is not distinct from true and id = any(g16);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'sirdab_commercial_listings air_conditioner true->null: % rows, measured 1', k; end if;
  if md5(array_to_string(g17, ',')) <> '355c4ae59a53c0b4de00cfb15b202b20' then raise exception 'id list g17 does not match the replay'; end if;
  update public.sirdab_commercial_listings set kitchen = null where kitchen is not distinct from true and id = any(g17);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'sirdab_commercial_listings kitchen true->null: % rows, measured 1', k; end if;
  if md5(array_to_string(g18, ',')) <> 'fb0d559f95947d4f3910f602731249fe' then raise exception 'id list g18 does not match the replay'; end if;
  update public.therc_residential_listings set air_conditioner = null where air_conditioner is not distinct from true and id = any(g18);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'therc_residential_listings air_conditioner true->null: % rows, measured 1', k; end if;
  if md5(array_to_string(g19, ',')) <> 'fb0d559f95947d4f3910f602731249fe' then raise exception 'id list g19 does not match the replay'; end if;
  update public.therc_residential_listings set kitchen = null where kitchen is not distinct from true and id = any(g19);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'therc_residential_listings kitchen true->null: % rows, measured 1', k; end if;
  if md5(array_to_string(g20, ',')) <> 'c599b8f5ba8d1dbdba7a3d406551141b' then raise exception 'id list g20 does not match the replay'; end if;
  update public.tuba_residential_listings set kitchen = null where kitchen is not distinct from true and id = any(g20);
  get diagnostics k = row_count; done := done + k;
  if k > 3 then raise exception 'tuba_residential_listings kitchen true->null: % rows, measured 3', k; end if;
  if md5(array_to_string(g21, ',')) <> '3d9f49825a641bd08fa22ed27774a85d' then raise exception 'id list g21 does not match the replay'; end if;
  update public.tuba_residential_listings set furnished = false where furnished is not distinct from true and id = any(g21);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'tuba_residential_listings furnished true->false: % rows, measured 1', k; end if;
  raise notice 'not installed: % rows changed of 180 measured', done;
end $r$;

-- Watch: a site whose kitchen answer comes from the ad's own words storing kitchen = yes while those words say
-- «مطبخ غير راكب» / «المطبخ: غير مركب» / «مطبخ (غير راكب)» right after it. Rows whose structured chips / counts name a
-- kitchen are not ours to judge and are left out.
create or replace function public.mon_detect_not_installed_served_as_yes()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n        int := 0;
  live     text[] := '{}';
  v_seen   bigint;
  v_bad    bigint;
  v_sample jsonb;
  re_ni    constant text := '(المطبخ|مطبخ)[ \t]*[(:*]?[ \t]*غير[ \t]+(راكب|مركب)';
begin
  with t as (
    select 'abralosol_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.abralosol_commercial_listings where active
    union all
    select 'abralosol_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.abralosol_residential_listings where active
    union all
    select 'akariyoun_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.akariyoun_commercial_listings where active
    union all
    select 'akariyoun_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.akariyoun_residential_listings where active
    union all
    select 'alhoshan_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.alhoshan_commercial_listings where active
    union all
    select 'alhoshan_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.alhoshan_residential_listings where active
    union all
    select 'alkhaas_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.alkhaas_commercial_listings where active
    union all
    select 'alkhaas_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.alkhaas_residential_listings where active
    union all
    select 'aqarcity_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.aqarcity_commercial_listings where active
    union all
    select 'aqarcity_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.aqarcity_residential_listings where active
    union all
    select 'awal_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.awal_commercial_listings where active
    union all
    select 'awal_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.awal_residential_listings where active
    union all
    select 'dealapp_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.dealapp_commercial_listings where active
    union all
    select 'dealapp_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.dealapp_residential_listings where active
    union all
    select 'dwelleo_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.dwelleo_commercial_listings where active and coalesce(additional_info->>'amenities', '') || coalesce(additional_info->>'tags', '') !~ 'مطبخ'
    union all
    select 'dwelleo_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.dwelleo_residential_listings where active and coalesce(additional_info->>'amenities', '') || coalesce(additional_info->>'tags', '') !~ 'مطبخ'
    union all
    select 'ebriza_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.ebriza_commercial_listings where active and coalesce(additional_info->>'features_raw', '') !~ 'مطبخ'
    union all
    select 'ebriza_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.ebriza_residential_listings where active and coalesce(additional_info->>'features_raw', '') !~ 'مطبخ'
    union all
    select 'eilmalriyada_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.eilmalriyada_commercial_listings where active
    union all
    select 'eilmalriyada_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.eilmalriyada_residential_listings where active
    union all
    select 'haraj_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.haraj_commercial_listings where active
    union all
    select 'haraj_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.haraj_residential_listings where active
    union all
    select 'jurash_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.jurash_commercial_listings where active
    union all
    select 'jurash_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.jurash_residential_listings where active
    union all
    select 'ksaaqar_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.ksaaqar_commercial_listings where active
    union all
    select 'ksaaqar_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.ksaaqar_residential_listings where active
    union all
    select 'muhaysini_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.muhaysini_commercial_listings where active and coalesce(additional_info->>'feature_words', '') !~ 'مطبخ'
    union all
    select 'muhaysini_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.muhaysini_residential_listings where active and coalesce(additional_info->>'feature_words', '') !~ 'مطبخ'
    union all
    select 'opensooq_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.opensooq_commercial_listings where active
    union all
    select 'opensooq_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.opensooq_residential_listings where active
    union all
    select 'raghdan_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.raghdan_commercial_listings where active
    union all
    select 'raghdan_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.raghdan_residential_listings where active
    union all
    select 'rakez_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.rakez_commercial_listings where active
    union all
    select 'rakez_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.rakez_residential_listings where active
    union all
    select 'rawasidark_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.rawasidark_commercial_listings where active
    union all
    select 'rawasidark_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.rawasidark_residential_listings where active
    union all
    select 'reinvest_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.reinvest_commercial_listings where active and coalesce(additional_info->>'amenity_words', '') !~ 'مطبخ'
    union all
    select 'reinvest_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.reinvest_residential_listings where active and coalesce(additional_info->>'amenity_words', '') !~ 'مطبخ'
    union all
    select 'remal_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.remal_commercial_listings where active
    union all
    select 'remal_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.remal_residential_listings where active
    union all
    select 'sadiqeltajer_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.sadiqeltajer_commercial_listings where active
    union all
    select 'sadiqeltajer_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.sadiqeltajer_residential_listings where active
    union all
    select 'shomou_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.shomou_commercial_listings where active
    union all
    select 'shomou_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.shomou_residential_listings where active
    union all
    select 'sirdab_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.sirdab_commercial_listings where active
    union all
    select 'sirdab_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.sirdab_residential_listings where active
    union all
    select 'therc_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.therc_commercial_listings where active
    union all
    select 'therc_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.therc_residential_listings where active
    union all
    select 'tuba_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.tuba_commercial_listings where active and coalesce(additional_info->>'utility_words', '') !~ 'مطبخ' and coalesce(description, '') !~ 'المطابخ\s*:\s*[0-9]'
    union all
    select 'tuba_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.tuba_residential_listings where active and coalesce(additional_info->>'utility_words', '') !~ 'مطبخ' and coalesce(description, '') !~ 'المطابخ\s*:\s*[0-9]'
    union all
    select 'vmksa_commercial_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.vmksa_commercial_listings where active
    union all
    select 'vmksa_residential_listings' tbl, id, kitchen, coalesce(title, '') || ' ' || coalesce(description, '') d from public.vmksa_residential_listings where active)
  select count(*) filter (where d ~ re_ni),
         count(*) filter (where kitchen and d ~ re_ni),
         jsonb_agg(jsonb_build_object('t', tbl, 'id', id)) filter (where kitchen and d ~ re_ni)
    into v_seen, v_bad, v_sample
    from t;

  if v_seen = 0 then
    live := live || 'not_installed_served_as_yes:BLIND'::text;
    n := n + public.mon_raise('P2', 'not_installed_served_as_yes', null, 'not_installed_served_as_yes:BLIND',
      jsonb_build_object('blind', true,
        'why', 'No active ad on the prose-read kitchen sites says «مطبخ غير راكب», so a not-installed kitchen served as yes cannot be seen.',
        'action', 'Check those sites still store title and description.'));
  elsif v_bad > 0 then
    live := live || 'not_installed_served_as_yes:yes_served'::text;
    n := n + public.mon_raise('P1', 'not_installed_served_as_yes', null, 'not_installed_served_as_yes:yes_served',
      jsonb_build_object('rows', v_bad, 'stating_not_installed', v_seen,
        'sample', (select jsonb_agg(x) from (select x from jsonb_array_elements(v_sample) x limit 10) z),
        'why', 'The ad''s own words say the kitchen is not installed («مطبخ غير راكب») yet kitchen = yes is stored, so a customer asking for a kitchen gets an unfitted one.',
        'action', 'scrapers/common/normalize.py _NOT_INSTALLED_RE / _veto_not_installed; replay the site''s reader over the stored rows and repair.'));
  end if;

  perform public.mon_resolve_stale_keys('not_installed_served_as_yes', live);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_not_installed_served_as_yes' in src) > 0 then
    raise notice 'mon_detect_not_installed_served_as_yes already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_prose_no_served_as_yes'',',
    E'    ''mon_detect_prose_no_served_as_yes'',\n    ''mon_detect_not_installed_served_as_yes'',');
  if out_def = src then
    raise exception 'roster anchor not found, refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- Raise path, proven on a real repaired row (haraj 18897950 «مطبخ غير راكب 🏠 مكيفات اسبلت راكبة»), rolled back.
do $p$
declare k int;
begin
  begin
    update public.haraj_residential_listings set kitchen = true where id = 18897950 and active;
    perform public.mon_detect_not_installed_served_as_yes();
    select count(*) into k from public.alert_event
     where kind = 'not_installed_served_as_yes' and resolved_at is null and dedup_key = 'not_installed_served_as_yes:yes_served';
    raise exception 'probe_done:%', k;
  exception when others then
    if sqlerrm <> 'probe_done:1' then
      raise exception 'detector did not raise on a planted not-installed yes (%)', sqlerrm;
    end if;
  end;
end $p$;

-- And it is clean on the repaired data.
do $c$
declare k int;
begin
  perform public.mon_detect_not_installed_served_as_yes();
  select count(*) into k from public.alert_event where kind = 'not_installed_served_as_yes' and resolved_at is null;
  if k <> 0 then raise exception 'detector reports % open alert(s) on the repaired data', k; end if;
end $c$;
