-- Prose-only sites store an explicit «لا» as no (owner, approved in chat 2026-10-24: has it / an explicit negation tied
-- to the token = no / silent, prepared or nearby = unknown — the 2026-09-20 four outcomes of amenities_from_text). The 21
-- yes-or-nothing readers moved to normalize.prose_amenities in PR 8674, which also ties a negation to its word (a «غير»
-- or «بدون» that owns the previous word no longer bleeds onto the next) and reads «المكيفات غير راكبه» as not installed.
-- Pinned by scripts/verify-labelled-no-is-not-a-yes.ts; ADVANCED_FILTER_SOURCE_TRUTH.md §2 carries the rule.
--
-- Repair = the readers replayed over the stored rows; a row changes only where it holds what the old reader wrote:
--   null -> false  a prose-only column the yes-only reader left unknown while the ad says «لا يوجد مصعد» / «بدون …»
--   true -> null   «المكيفات غير راكبه» / «مصعد غير مركب»: not installed, never a yes
--   false -> null / true   a «no» that only the untied negator produced («بدون صاله مكيفات راكبه» is ACs = yes)
-- Structured fields are never touched (each site's skip list; aqar, gathern and dwelleo's structured columns excluded).
--   abralosol_residential_listings     elevator          null -> false    1
--   alkhaas_residential_listings       parking           null -> false    1
--   dealapp_residential_listings       air_conditioner   true -> null     2
--   dealapp_residential_listings       elevator          true -> null     2
--   dwelleo_residential_listings       air_conditioner  false -> null     5
--   dwelleo_residential_listings       air_conditioner  false -> true     2
--   dwelleo_residential_listings       air_conditioner   true -> null     3
--   dwelleo_residential_listings       private_entrance false -> true     2
--   haraj_residential_listings         air_conditioner   null -> false   24
--   haraj_residential_listings         air_conditioner   true -> null     1
--   haraj_residential_listings         elevator          null -> false   50
--   haraj_residential_listings         furnished         null -> false   27
--   haraj_residential_listings         kitchen           null -> false    4
--   haraj_residential_listings         parking           null -> false    2
--   muhaysini_commercial_listings      air_conditioner   true -> null     2
--   muhaysini_commercial_listings      kitchen          false -> true     1
--   muhaysini_residential_listings     air_conditioner  false -> null     3
--   muhaysini_residential_listings     air_conditioner   true -> null    10
--   muhaysini_residential_listings     furnished        false -> true     1
--   muhaysini_residential_listings     kitchen          false -> true     1
--   muhaysini_residential_listings     parking          false -> true     1
--   raghdan_residential_listings       air_conditioner   true -> null     1
--   raghdan_residential_listings       parking           null -> false    2
--   rawasidark_residential_listings    air_conditioner   null -> false    1
--   reinvest_residential_listings      air_conditioner   true -> null     2
--   reinvest_residential_listings      car_entrance     false -> true     1
--   shomou_residential_listings        elevator          null -> false    7
--   therc_commercial_listings          furnished         null -> false    1
--   therc_residential_listings         air_conditioner   null -> false    4
--   therc_residential_listings         elevator          null -> false    1
--   therc_residential_listings         furnished         null -> false    1
--   therc_residential_listings         kitchen           null -> false    1
--   therc_residential_listings         parking           null -> false    1
--   tuba_residential_listings          air_conditioner   true -> null     2
--   vmksa_residential_listings         furnished         null -> false    1
--   wasalt_residential_listings        air_conditioner   null -> false   12
--   wasalt_residential_listings        elevator          null -> false   36
--   wasalt_residential_listings        private_entrance  null -> false    1

do $r$
declare k int; done int := 0;
  g0 bigint[] := '{18281489}';
  g1 bigint[] := '{645835}';
  g2 bigint[] := '{16156361,16156677}';
  g3 bigint[] := '{12750236,16233812}';
  g4 bigint[] := '{13131874,13134769,13134771,13135184,13928667}';
  g5 bigint[] := '{13132273,13203702}';
  g6 bigint[] := '{13130149,13132334,13929065}';
  g7 bigint[] := '{13134164,14823708}';
  g8 bigint[] := '{18362419,18483716,18541367,18541544,18563028,18624178,18624564,18626128,18659886,18706524,18708788,18745642,18745645,18745815,18749952,18841676,18897917,18942835,18981631,18981837,18987270,19063163,20440765,20464445}';
  g9 bigint[] := '{18590902}';
  g10 bigint[] := '{18362381,18362502,18482520,18541224,18541362,18541532,18541541,18541868,18541880,18562814,18591060,18591149,18591262,18624223,18624765,18659393,18660079,18695211,18706362,18706395,18706548,18706602,18708594,18708719,18743828,18745471,18745667,18749616,18749823,18750006,18784147,18866045,18866062,18866155,18911707,18911853,18911898,18924476,18946153,18946234,18957800,18981653,19008940,19115769,19520454,19814767,19832542,19861989,20464445,20611449}';
  g11 bigint[] := '{18263158,18362402,18483428,18483545,18541434,18541929,18562585,18562958,18562978,18591477,18659563,18659694,18659946,18695112,18695176,18706360,18750010,18778064,18814879,18814941,18841676,18924440,18964212,18981774,18987268,19415129,19832504}';
  g12 bigint[] := '{18362488,18541367,18695092,18750028}';
  g13 bigint[] := '{18708638,18942742}';
  g14 bigint[] := '{17581999,17582088}';
  g15 bigint[] := '{17868499}';
  g16 bigint[] := '{17580053,17580368,17867527}';
  g17 bigint[] := '{17578175,17578176,17578179,17578194,17580055,17580057,17580058,17580201,17581552,17868141}';
  g18 bigint[] := '{18894245}';
  g19 bigint[] := '{13277587}';
  g20 bigint[] := '{17868085}';
  g21 bigint[] := '{15704174}';
  g22 bigint[] := '{12585784,17662887}';
  g23 bigint[] := '{10283300}';
  g24 bigint[] := '{13257783,13257825}';
  g25 bigint[] := '{13859934}';
  g26 bigint[] := '{13850787,13850788,13850796,13850829,13850840,13850842,13850899}';
  g27 bigint[] := '{10283717}';
  g28 bigint[] := '{10283345,10283347,11241120,11241121}';
  g29 bigint[] := '{10283468}';
  g30 bigint[] := '{10283331}';
  g31 bigint[] := '{10283341}';
  g32 bigint[] := '{10283347}';
  g33 bigint[] := '{13262569,13262570}';
  g34 bigint[] := '{15352281}';
  g35 bigint[] := '{432553,432686,451913,451916,482273,491138,8776244,11888977,13622158,13995673,16476871,17904750}';
  g36 bigint[] := '{432422,436230,438343,438844,441520,447976,453324,454150,479016,481676,481677,2071897,2199815,2377346,5004535,7643101,9313822,9405394,10303608,10775169,11655297,11916157,12613981,12619169,13990693,14029568,14246194,14247759,14247760,14373503,15221293,15570122,17171723,18445311,19174059,19188784}';
  g37 bigint[] := '{2389223}';
begin
  if md5(array_to_string(g0, ',')) <> 'c08fa653ddd15b00c24a6c2772d9b8f7' then raise exception 'id list g0 does not match the replay'; end if;
  update public.abralosol_residential_listings set elevator = false where elevator is not distinct from null and id = any(g0);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'abralosol_residential_listings elevator null->false: % rows, measured 1', k; end if;
  if md5(array_to_string(g1, ',')) <> '6f560e12afb4dab6c9e656f355b29f01' then raise exception 'id list g1 does not match the replay'; end if;
  update public.alkhaas_residential_listings set parking = false where parking is not distinct from null and id = any(g1);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'alkhaas_residential_listings parking null->false: % rows, measured 1', k; end if;
  if md5(array_to_string(g2, ',')) <> '7a9b8368f58b5b4784954a3ea3030606' then raise exception 'id list g2 does not match the replay'; end if;
  update public.dealapp_residential_listings set air_conditioner = null where air_conditioner is not distinct from true and id = any(g2);
  get diagnostics k = row_count; done := done + k;
  if k > 2 then raise exception 'dealapp_residential_listings air_conditioner true->null: % rows, measured 2', k; end if;
  if md5(array_to_string(g3, ',')) <> '4f21fe5b12ecd970ed55a268811103ba' then raise exception 'id list g3 does not match the replay'; end if;
  update public.dealapp_residential_listings set elevator = null where elevator is not distinct from true and id = any(g3);
  get diagnostics k = row_count; done := done + k;
  if k > 2 then raise exception 'dealapp_residential_listings elevator true->null: % rows, measured 2', k; end if;
  if md5(array_to_string(g4, ',')) <> '2067371fc7e5cbe94a7989ac1c219a8a' then raise exception 'id list g4 does not match the replay'; end if;
  update public.dwelleo_residential_listings set air_conditioner = null where air_conditioner is not distinct from false and id = any(g4);
  get diagnostics k = row_count; done := done + k;
  if k > 5 then raise exception 'dwelleo_residential_listings air_conditioner false->null: % rows, measured 5', k; end if;
  if md5(array_to_string(g5, ',')) <> '7fad74e0d4a56edead7f026dfe411476' then raise exception 'id list g5 does not match the replay'; end if;
  update public.dwelleo_residential_listings set air_conditioner = true where air_conditioner is not distinct from false and id = any(g5);
  get diagnostics k = row_count; done := done + k;
  if k > 2 then raise exception 'dwelleo_residential_listings air_conditioner false->true: % rows, measured 2', k; end if;
  if md5(array_to_string(g6, ',')) <> '5f340a3cd230b8d3e93c64a07ce2a981' then raise exception 'id list g6 does not match the replay'; end if;
  update public.dwelleo_residential_listings set air_conditioner = null where air_conditioner is not distinct from true and id = any(g6);
  get diagnostics k = row_count; done := done + k;
  if k > 3 then raise exception 'dwelleo_residential_listings air_conditioner true->null: % rows, measured 3', k; end if;
  if md5(array_to_string(g7, ',')) <> 'bfc2ee22135e07f84dd17e0d30e05397' then raise exception 'id list g7 does not match the replay'; end if;
  update public.dwelleo_residential_listings set private_entrance = true where private_entrance is not distinct from false and id = any(g7);
  get diagnostics k = row_count; done := done + k;
  if k > 2 then raise exception 'dwelleo_residential_listings private_entrance false->true: % rows, measured 2', k; end if;
  if md5(array_to_string(g8, ',')) <> '57646c84a2c22726e910c7609015798b' then raise exception 'id list g8 does not match the replay'; end if;
  update public.haraj_residential_listings set air_conditioner = false where air_conditioner is not distinct from null and id = any(g8);
  get diagnostics k = row_count; done := done + k;
  if k > 24 then raise exception 'haraj_residential_listings air_conditioner null->false: % rows, measured 24', k; end if;
  if md5(array_to_string(g9, ',')) <> '436faafaf80290cd66b4b6c4badc0829' then raise exception 'id list g9 does not match the replay'; end if;
  update public.haraj_residential_listings set air_conditioner = null where air_conditioner is not distinct from true and id = any(g9);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'haraj_residential_listings air_conditioner true->null: % rows, measured 1', k; end if;
  if md5(array_to_string(g10, ',')) <> '66ca8832c77207df4853534a3cb25061' then raise exception 'id list g10 does not match the replay'; end if;
  update public.haraj_residential_listings set elevator = false where elevator is not distinct from null and id = any(g10);
  get diagnostics k = row_count; done := done + k;
  if k > 50 then raise exception 'haraj_residential_listings elevator null->false: % rows, measured 50', k; end if;
  if md5(array_to_string(g11, ',')) <> '7da71a298c4c974b196a5ae5c43ee807' then raise exception 'id list g11 does not match the replay'; end if;
  update public.haraj_residential_listings set furnished = false where furnished is not distinct from null and id = any(g11);
  get diagnostics k = row_count; done := done + k;
  if k > 27 then raise exception 'haraj_residential_listings furnished null->false: % rows, measured 27', k; end if;
  if md5(array_to_string(g12, ',')) <> 'f91b8ca8000aebeced0f764ec491350a' then raise exception 'id list g12 does not match the replay'; end if;
  update public.haraj_residential_listings set kitchen = false where kitchen is not distinct from null and id = any(g12);
  get diagnostics k = row_count; done := done + k;
  if k > 4 then raise exception 'haraj_residential_listings kitchen null->false: % rows, measured 4', k; end if;
  if md5(array_to_string(g13, ',')) <> '147a27b9e572baf9c56699ecc5c1548f' then raise exception 'id list g13 does not match the replay'; end if;
  update public.haraj_residential_listings set parking = false where parking is not distinct from null and id = any(g13);
  get diagnostics k = row_count; done := done + k;
  if k > 2 then raise exception 'haraj_residential_listings parking null->false: % rows, measured 2', k; end if;
  if md5(array_to_string(g14, ',')) <> '758b457c7a37a18e6687c7d4237b8a44' then raise exception 'id list g14 does not match the replay'; end if;
  update public.muhaysini_commercial_listings set air_conditioner = null where air_conditioner is not distinct from true and id = any(g14);
  get diagnostics k = row_count; done := done + k;
  if k > 2 then raise exception 'muhaysini_commercial_listings air_conditioner true->null: % rows, measured 2', k; end if;
  if md5(array_to_string(g15, ',')) <> '25c26b09d9a9542926e6f14da7957b7a' then raise exception 'id list g15 does not match the replay'; end if;
  update public.muhaysini_commercial_listings set kitchen = true where kitchen is not distinct from false and id = any(g15);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'muhaysini_commercial_listings kitchen false->true: % rows, measured 1', k; end if;
  if md5(array_to_string(g16, ',')) <> 'dedafb4db95c90981209b62c45412b8f' then raise exception 'id list g16 does not match the replay'; end if;
  update public.muhaysini_residential_listings set air_conditioner = null where air_conditioner is not distinct from false and id = any(g16);
  get diagnostics k = row_count; done := done + k;
  if k > 3 then raise exception 'muhaysini_residential_listings air_conditioner false->null: % rows, measured 3', k; end if;
  if md5(array_to_string(g17, ',')) <> '239d4508323bb18a0f4389028528dadc' then raise exception 'id list g17 does not match the replay'; end if;
  update public.muhaysini_residential_listings set air_conditioner = null where air_conditioner is not distinct from true and id = any(g17);
  get diagnostics k = row_count; done := done + k;
  if k > 10 then raise exception 'muhaysini_residential_listings air_conditioner true->null: % rows, measured 10', k; end if;
  if md5(array_to_string(g18, ',')) <> '17bb10b82308de84fbddae06feb3101f' then raise exception 'id list g18 does not match the replay'; end if;
  update public.muhaysini_residential_listings set furnished = true where furnished is not distinct from false and id = any(g18);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'muhaysini_residential_listings furnished false->true: % rows, measured 1', k; end if;
  if md5(array_to_string(g19, ',')) <> '444962a9851224c0801180c4aa047c66' then raise exception 'id list g19 does not match the replay'; end if;
  update public.muhaysini_residential_listings set kitchen = true where kitchen is not distinct from false and id = any(g19);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'muhaysini_residential_listings kitchen false->true: % rows, measured 1', k; end if;
  if md5(array_to_string(g20, ',')) <> 'dcde360aa1b50087286e48594e7622d5' then raise exception 'id list g20 does not match the replay'; end if;
  update public.muhaysini_residential_listings set parking = true where parking is not distinct from false and id = any(g20);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'muhaysini_residential_listings parking false->true: % rows, measured 1', k; end if;
  if md5(array_to_string(g21, ',')) <> '192cf477393d9e7e08f014cd97711255' then raise exception 'id list g21 does not match the replay'; end if;
  update public.raghdan_residential_listings set air_conditioner = null where air_conditioner is not distinct from true and id = any(g21);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'raghdan_residential_listings air_conditioner true->null: % rows, measured 1', k; end if;
  if md5(array_to_string(g22, ',')) <> 'd061727ca37a061322c7a27ea89f2c77' then raise exception 'id list g22 does not match the replay'; end if;
  update public.raghdan_residential_listings set parking = false where parking is not distinct from null and id = any(g22);
  get diagnostics k = row_count; done := done + k;
  if k > 2 then raise exception 'raghdan_residential_listings parking null->false: % rows, measured 2', k; end if;
  if md5(array_to_string(g23, ',')) <> 'f20d33dae3944d0044b9ff084cf8367c' then raise exception 'id list g23 does not match the replay'; end if;
  update public.rawasidark_residential_listings set air_conditioner = false where air_conditioner is not distinct from null and id = any(g23);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'rawasidark_residential_listings air_conditioner null->false: % rows, measured 1', k; end if;
  if md5(array_to_string(g24, ',')) <> 'e342ddfee06e358a24568711a99d6ef8' then raise exception 'id list g24 does not match the replay'; end if;
  update public.reinvest_residential_listings set air_conditioner = null where air_conditioner is not distinct from true and id = any(g24);
  get diagnostics k = row_count; done := done + k;
  if k > 2 then raise exception 'reinvest_residential_listings air_conditioner true->null: % rows, measured 2', k; end if;
  if md5(array_to_string(g25, ',')) <> 'b3f77c95bafd9518f86f82d75fbba013' then raise exception 'id list g25 does not match the replay'; end if;
  update public.reinvest_residential_listings set car_entrance = true where car_entrance is not distinct from false and id = any(g25);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'reinvest_residential_listings car_entrance false->true: % rows, measured 1', k; end if;
  if md5(array_to_string(g26, ',')) <> 'd366c3a55fd221170a0b1ca7ce4376ce' then raise exception 'id list g26 does not match the replay'; end if;
  update public.shomou_residential_listings set elevator = false where elevator is not distinct from null and id = any(g26);
  get diagnostics k = row_count; done := done + k;
  if k > 7 then raise exception 'shomou_residential_listings elevator null->false: % rows, measured 7', k; end if;
  if md5(array_to_string(g27, ',')) <> '72f0ed279b1de2108a37deadf05bde4e' then raise exception 'id list g27 does not match the replay'; end if;
  update public.therc_commercial_listings set furnished = false where furnished is not distinct from null and id = any(g27);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'therc_commercial_listings furnished null->false: % rows, measured 1', k; end if;
  if md5(array_to_string(g28, ',')) <> 'ce268aa700abe79c1d321c010e8a79ec' then raise exception 'id list g28 does not match the replay'; end if;
  update public.therc_residential_listings set air_conditioner = false where air_conditioner is not distinct from null and id = any(g28);
  get diagnostics k = row_count; done := done + k;
  if k > 4 then raise exception 'therc_residential_listings air_conditioner null->false: % rows, measured 4', k; end if;
  if md5(array_to_string(g29, ',')) <> '8807f90e3538718f9d307e55fd780ca2' then raise exception 'id list g29 does not match the replay'; end if;
  update public.therc_residential_listings set elevator = false where elevator is not distinct from null and id = any(g29);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'therc_residential_listings elevator null->false: % rows, measured 1', k; end if;
  if md5(array_to_string(g30, ',')) <> '9c493e401fa87cedef062ad6205f16cb' then raise exception 'id list g30 does not match the replay'; end if;
  update public.therc_residential_listings set furnished = false where furnished is not distinct from null and id = any(g30);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'therc_residential_listings furnished null->false: % rows, measured 1', k; end if;
  if md5(array_to_string(g31, ',')) <> '64dc12197b3381dff4ba4ac17b3a1f74' then raise exception 'id list g31 does not match the replay'; end if;
  update public.therc_residential_listings set kitchen = false where kitchen is not distinct from null and id = any(g31);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'therc_residential_listings kitchen null->false: % rows, measured 1', k; end if;
  if md5(array_to_string(g32, ',')) <> '25dff1f20e30fc97cd84b2cd2312eb15' then raise exception 'id list g32 does not match the replay'; end if;
  update public.therc_residential_listings set parking = false where parking is not distinct from null and id = any(g32);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'therc_residential_listings parking null->false: % rows, measured 1', k; end if;
  if md5(array_to_string(g33, ',')) <> 'd6d22e914d0b82508d71db1f6a318d50' then raise exception 'id list g33 does not match the replay'; end if;
  update public.tuba_residential_listings set air_conditioner = null where air_conditioner is not distinct from true and id = any(g33);
  get diagnostics k = row_count; done := done + k;
  if k > 2 then raise exception 'tuba_residential_listings air_conditioner true->null: % rows, measured 2', k; end if;
  if md5(array_to_string(g34, ',')) <> '0677e90142892eb529fcfdc343891ccb' then raise exception 'id list g34 does not match the replay'; end if;
  update public.vmksa_residential_listings set furnished = false where furnished is not distinct from null and id = any(g34);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'vmksa_residential_listings furnished null->false: % rows, measured 1', k; end if;
  if md5(array_to_string(g35, ',')) <> 'b51b9a327ec2a185196120f64c4470c3' then raise exception 'id list g35 does not match the replay'; end if;
  update public.wasalt_residential_listings set air_conditioner = false where air_conditioner is not distinct from null and id = any(g35);
  get diagnostics k = row_count; done := done + k;
  if k > 12 then raise exception 'wasalt_residential_listings air_conditioner null->false: % rows, measured 12', k; end if;
  if md5(array_to_string(g36, ',')) <> '3d9a99ffdb0afcbf0aff83f3f8d65f02' then raise exception 'id list g36 does not match the replay'; end if;
  update public.wasalt_residential_listings set elevator = false where elevator is not distinct from null and id = any(g36);
  get diagnostics k = row_count; done := done + k;
  if k > 36 then raise exception 'wasalt_residential_listings elevator null->false: % rows, measured 36', k; end if;
  if md5(array_to_string(g37, ',')) <> '0a00d7676d8b8885d3bc4506c7972d36' then raise exception 'id list g37 does not match the replay'; end if;
  update public.wasalt_residential_listings set private_entrance = false where private_entrance is not distinct from null and id = any(g37);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'wasalt_residential_listings private_entrance null->false: % rows, measured 1', k; end if;
  raise notice 'prose readers: % rows changed of 220 measured', done;
end $r$;

-- Watch: a prose-only site storing elevator = yes while the ad's own words say «بدون مصعد» / «لا يوجد مصعد» next to it.
create or replace function public.mon_detect_prose_no_served_as_yes()
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
  re_no    constant text := '(^|[^ء-ي])(لا يوجد|لايوجد|لا يتوفر|لا تتوفر|بدون|غير متوفر|عدم وجود|لعدم وجود)[ \t]*(ال)?(مصعد|مصاعد)';
begin
  with t as (
    select 'abralosol_commercial_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.abralosol_commercial_listings where active
    union all
    select 'abralosol_residential_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.abralosol_residential_listings where active
    union all
    select 'akariyoun_commercial_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.akariyoun_commercial_listings where active
    union all
    select 'akariyoun_residential_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.akariyoun_residential_listings where active
    union all
    select 'alhoshan_commercial_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.alhoshan_commercial_listings where active
    union all
    select 'alhoshan_residential_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.alhoshan_residential_listings where active
    union all
    select 'alkhaas_commercial_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.alkhaas_commercial_listings where active
    union all
    select 'alkhaas_residential_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.alkhaas_residential_listings where active
    union all
    select 'awal_commercial_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.awal_commercial_listings where active
    union all
    select 'awal_residential_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.awal_residential_listings where active
    union all
    select 'haraj_commercial_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.haraj_commercial_listings where active
    union all
    select 'haraj_residential_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.haraj_residential_listings where active
    union all
    select 'jurash_commercial_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.jurash_commercial_listings where active
    union all
    select 'jurash_residential_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.jurash_residential_listings where active
    union all
    select 'ksaaqar_commercial_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.ksaaqar_commercial_listings where active
    union all
    select 'ksaaqar_residential_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.ksaaqar_residential_listings where active
    union all
    select 'opensooq_commercial_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.opensooq_commercial_listings where active
    union all
    select 'opensooq_residential_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.opensooq_residential_listings where active
    union all
    select 'raghdan_commercial_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.raghdan_commercial_listings where active
    union all
    select 'raghdan_residential_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.raghdan_residential_listings where active
    union all
    select 'rakez_commercial_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.rakez_commercial_listings where active
    union all
    select 'rakez_residential_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.rakez_residential_listings where active
    union all
    select 'rawasidark_commercial_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.rawasidark_commercial_listings where active
    union all
    select 'rawasidark_residential_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.rawasidark_residential_listings where active
    union all
    select 'remal_commercial_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.remal_commercial_listings where active
    union all
    select 'remal_residential_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.remal_residential_listings where active
    union all
    select 'sadiqeltajer_commercial_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.sadiqeltajer_commercial_listings where active
    union all
    select 'sadiqeltajer_residential_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.sadiqeltajer_residential_listings where active
    union all
    select 'shomou_commercial_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.shomou_commercial_listings where active
    union all
    select 'shomou_residential_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.shomou_residential_listings where active
    union all
    select 'sirdab_commercial_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.sirdab_commercial_listings where active
    union all
    select 'sirdab_residential_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.sirdab_residential_listings where active
    union all
    select 'therc_commercial_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.therc_commercial_listings where active
    union all
    select 'therc_residential_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.therc_residential_listings where active
    union all
    select 'vmksa_commercial_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.vmksa_commercial_listings where active
    union all
    select 'vmksa_residential_listings' tbl, id, elevator, coalesce(title, '') || ' ' || coalesce(description, '') d from public.vmksa_residential_listings where active)
  select count(*) filter (where d ~ re_no),
         count(*) filter (where elevator and d ~ re_no),
         jsonb_agg(jsonb_build_object('t', tbl, 'id', id)) filter (where elevator and d ~ re_no)
    into v_seen, v_bad, v_sample
    from t;

  if v_seen = 0 then
    live := live || 'prose_no_served_as_yes:BLIND'::text;
    n := n + public.mon_raise('P2', 'prose_no_served_as_yes', null, 'prose_no_served_as_yes:BLIND',
      jsonb_build_object('blind', true,
        'why', 'No active ad on the prose-only sites says «بدون مصعد» / «لا يوجد مصعد», so a stated no served as yes cannot be seen.',
        'action', 'Check those sites still store title and description.'));
  elsif v_bad > 0 then
    live := live || 'prose_no_served_as_yes:yes_served'::text;
    n := n + public.mon_raise('P1', 'prose_no_served_as_yes', null, 'prose_no_served_as_yes:yes_served',
      jsonb_build_object('rows', v_bad, 'stating_no', v_seen,
        'sample', (select jsonb_agg(x) from (select x from jsonb_array_elements(v_sample) x limit 10) z),
        'why', 'The ad''s own words say «بدون مصعد» / «لا يوجد مصعد» yet elevator = yes is stored on a site with no structured elevator field, so a customer asking for an elevator gets it.',
        'action', 'scrapers/common/normalize.py prose_amenities / _negated_before; replay the site''s reader over the stored rows and repair.'));
  end if;

  perform public.mon_resolve_stale_keys('prose_no_served_as_yes', live);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_prose_no_served_as_yes' in src) > 0 then
    raise notice 'mon_detect_prose_no_served_as_yes already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_labelled_no_served_as_furnished'',',
    E'    ''mon_detect_labelled_no_served_as_furnished'',\n    ''mon_detect_prose_no_served_as_yes'',');
  if out_def = src then
    raise exception 'roster anchor not found, refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- Raise path, proven on a real repaired row (haraj 18362502), rolled back.
do $p$
declare k int;
begin
  begin
    update public.haraj_residential_listings set elevator = true where id = 18362502 and active;
    perform public.mon_detect_prose_no_served_as_yes();
    select count(*) into k from public.alert_event
     where kind = 'prose_no_served_as_yes' and resolved_at is null and dedup_key = 'prose_no_served_as_yes:yes_served';
    raise exception 'probe_done:%', k;
  exception when others then
    if sqlerrm <> 'probe_done:1' then
      raise exception 'detector did not raise on a planted stated-no yes (%)', sqlerrm;
    end if;
  end;
end $p$;

-- And it is clean on the repaired data.
do $c$
declare k int;
begin
  perform public.mon_detect_prose_no_served_as_yes();
  select count(*) into k from public.alert_event where kind = 'prose_no_served_as_yes' and resolved_at is null;
  if k <> 0 then raise exception 'detector reports % open alert(s) on the repaired data', k; end if;
end $c$;
