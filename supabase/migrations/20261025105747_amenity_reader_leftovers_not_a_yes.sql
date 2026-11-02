-- The amenity reader's leftovers after 20261025083536: «لا تأتي الشقة مفروشة», «عدم وجود مصعد», «موقف سيارات ومساحة
-- خارجية: غير موضحة», «لا توجد مكيفات», the same «مفروشة: لا» template on other sites, and dwelleo's own furnishing
-- status contradicting the ad. The writers are fixed in PR 8656 (shared reader; sirdab reads a stated no; dwelleo
-- stores unknown when its status and its text disagree), pinned by scripts/verify-labelled-no-is-not-a-yes.ts.
--
-- Repair = the readers before and after the fix replayed over every stored row whose text could carry one of the
-- phrases; a stored YES the fixed reader no longer says moves to what it says now. Excluded on purpose: aqar and
-- gathern (their columns come from the site's own boxes), three inactive dwelleo rows whose AC / driver room / fibre
-- may come from dwelleo's structured fields, and haraj goes to unknown (its writer stores yes or nothing).
-- dwelleo's furnished follows its writer: status and text agree → status; disagree → unknown.
-- Data only: the companion detector (mon_detect_labelled_no_served_as_furnished) ships in the next migration, applied
-- when the API is quiet (a function change reloads PostgREST's schema cache). Until then the check below is inline.
--   dealapp_residential_listings   elevator          true -> false    2
--   dealapp_residential_listings   elevator          true -> null     1
--   dealapp_residential_listings   furnished         true -> false    5
--   dwelleo_commercial_listings    furnished        false -> null     8
--   dwelleo_commercial_listings    furnished         true -> null     3
--   dwelleo_commercial_listings    parking           true -> false    1
--   dwelleo_residential_listings   furnished        false -> null    68
--   dwelleo_residential_listings   furnished         true -> false    1
--   dwelleo_residential_listings   furnished         true -> null    17
--   dwelleo_residential_listings   kitchen           true -> null     1
--   dwelleo_residential_listings   parking           true -> null     1
--   haraj_residential_listings     elevator          true -> null     2
--   haraj_residential_listings     kitchen           true -> null     1
--   ibaax_residential_listings     furnished         true -> false    4
--   jawher_residential_listings    driver_room       true -> false    1
--   muhaysini_commercial_listings  furnished         true -> false    1
--   muhaysini_residential_listings air_conditioner   true -> false    1
--   muhaysini_residential_listings air_conditioner   true -> null     1
--   muhaysini_residential_listings furnished         true -> false    7
--   muhaysini_residential_listings kitchen           true -> false    1
--   muhaysini_residential_listings parking           true -> null    20
--   sirdab_commercial_listings     furnished         true -> false    5
--   tuba_commercial_listings       furnished         true -> false    4
--   tuba_residential_listings      air_conditioner   true -> null     1
--   tuba_residential_listings      furnished         true -> false   90
--   tuba_residential_listings      furnished         true -> null     5
--   tuba_residential_listings      kitchen           true -> null     1

do $r$
declare k int; done int := 0;
  g0 bigint[] := '{18792342,20483657}';
  g1 bigint[] := '{18987609}';
  g2 bigint[] := '{11626920,11627029,14739480,14840047,14907995}';
  g3 bigint[] := '{13139131,13139242,13139296,13940110,14832144,14832147,14832150,14832348}';
  g4 bigint[] := '{13139176,13139241,13139263}';
  g5 bigint[] := '{14832320}';
  g6 bigint[] := '{13128550,13128554,13128809,13128812,13128846,13128850,13129505,13129555,13129580,13129581,13129582,13130332,13130641,13130654,13130857,13130938,13131252,13131558,13131747,13131967,13131973,13132085,13132444,13132517,13132747,13132843,13132852,13132942,13133215,13133576,13133714,13133931,13133932,13134339,13134432,13134493,13134541,13134560,13134592,13135114,13135465,13135469,13135599,13135646,13135771,13135862,13136470,13136799,13136949,13137122,13137340,13137626,13137704,13137811,13137933,13137952,13137969,13138124,13138252,13138258,13138338,13203716,13673022,13929671,13929803,14823299,14824135,14827861}';
  g7 bigint[] := '{14823470}';
  g8 bigint[] := '{13129308,13129342,13129343,13129767,13130631,13130994,13131160,13132972,13134528,13134610,13135068,13135619,13135642,13136926,13137338,13137460,13928446}';
  g9 bigint[] := '{13131988}';
  g10 bigint[] := '{14823401}';
  g11 bigint[] := '{18866045,19520454}';
  g12 bigint[] := '{18750028}';
  g13 bigint[] := '{13569207,13569212,13569213,13569222}';
  g14 bigint[] := '{20534871}';
  g15 bigint[] := '{17582113}';
  g16 bigint[] := '{14818771}';
  g17 bigint[] := '{17436399}';
  g18 bigint[] := '{15379527,15766258,17436048,18010255,18682748,18684995,18685093}';
  g19 bigint[] := '{17570277}';
  g20 bigint[] := '{15378156,15379756,15379818,15379929,15380419,17432840,17434748,17435344,17436270,17436365,17580099,17580100,17580101,17580173,17581040,17581096,17727535,18687344,18687345,18687522}';
  g21 bigint[] := '{13707352,13707489,13707716,13707722,13707730}';
  g22 bigint[] := '{13265498,13265499,13265523,13265524}';
  g23 bigint[] := '{13260993}';
  g24 bigint[] := '{13259397,13259401,13259796,13260191,13260193,13260197,13260199,13260202,13260203,13260204,13260206,13260207,13260211,13260221,13260240,13260253,13260260,13260261,13260266,13260268,13260271,13260274,13260278,13260281,13260289,13260294,13260298,13260302,13260305,13260307,13260309,13260310,13260315,13260318,13260326,13260331,13260334,13260337,13260338,13260831,13260837,13260840,13260842,13260843,13260847,13260848,13260851,13260853,13260856,13260863,13260869,13260871,13260874,13260876,13260877,13260879,13260888,13260894,13260897,13260903,13261233,13261241,13261242,13261243,13261244,13261247,13261248,13261254,13261269,13261271,13261276,13261282,13261288,13261295,13261297,13261299,13261305,13261310,13262173,13262175,13262237,13262399,13262965,13263307,13263311,13263471,13264561,13264845,13264885,13265314}';
  g25 bigint[] := '{13259817,13260226,13260290,13260864,13264886}';
  g26 bigint[] := '{13261958}';
begin
  if md5(array_to_string(g0, ',')) <> '755403a88beac80c233945d82150d847' then raise exception 'id list g0 does not match the replay'; end if;
  update public.dealapp_residential_listings set elevator = false where elevator is not distinct from true and id = any(g0);
  get diagnostics k = row_count; done := done + k;
  if k > 2 then raise exception 'dealapp_residential_listings elevator true->false: % rows, measured 2', k; end if;
  if md5(array_to_string(g1, ',')) <> 'c4cbc8b052e9ef44792b37de17965c59' then raise exception 'id list g1 does not match the replay'; end if;
  update public.dealapp_residential_listings set elevator = null where elevator is not distinct from true and id = any(g1);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'dealapp_residential_listings elevator true->null: % rows, measured 1', k; end if;
  if md5(array_to_string(g2, ',')) <> 'fb1b2b593694073cc4a2b2c6008020e9' then raise exception 'id list g2 does not match the replay'; end if;
  update public.dealapp_residential_listings set furnished = false where furnished is not distinct from true and id = any(g2);
  get diagnostics k = row_count; done := done + k;
  if k > 5 then raise exception 'dealapp_residential_listings furnished true->false: % rows, measured 5', k; end if;
  if md5(array_to_string(g3, ',')) <> '46c681da62c7458331dffcbd884d267f' then raise exception 'id list g3 does not match the replay'; end if;
  update public.dwelleo_commercial_listings set furnished = null where furnished is not distinct from false and id = any(g3);
  get diagnostics k = row_count; done := done + k;
  if k > 8 then raise exception 'dwelleo_commercial_listings furnished false->null: % rows, measured 8', k; end if;
  if md5(array_to_string(g4, ',')) <> '9007930047f0a4986ef55f125ae41175' then raise exception 'id list g4 does not match the replay'; end if;
  update public.dwelleo_commercial_listings set furnished = null where furnished is not distinct from true and id = any(g4);
  get diagnostics k = row_count; done := done + k;
  if k > 3 then raise exception 'dwelleo_commercial_listings furnished true->null: % rows, measured 3', k; end if;
  if md5(array_to_string(g5, ',')) <> '7d04837da4b0ce8447b74d2ced2d600e' then raise exception 'id list g5 does not match the replay'; end if;
  update public.dwelleo_commercial_listings set parking = false where parking is not distinct from true and id = any(g5);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'dwelleo_commercial_listings parking true->false: % rows, measured 1', k; end if;
  if md5(array_to_string(g6, ',')) <> 'ee4101bfa49e66c12dd33ddec88c3532' then raise exception 'id list g6 does not match the replay'; end if;
  update public.dwelleo_residential_listings set furnished = null where furnished is not distinct from false and id = any(g6);
  get diagnostics k = row_count; done := done + k;
  if k > 68 then raise exception 'dwelleo_residential_listings furnished false->null: % rows, measured 68', k; end if;
  if md5(array_to_string(g7, ',')) <> '68dd1c2b400f6ec0208ee9386fa5733c' then raise exception 'id list g7 does not match the replay'; end if;
  update public.dwelleo_residential_listings set furnished = false where furnished is not distinct from true and id = any(g7);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'dwelleo_residential_listings furnished true->false: % rows, measured 1', k; end if;
  if md5(array_to_string(g8, ',')) <> '7ffcb4a5dca19c3f0ede1e481fb78b24' then raise exception 'id list g8 does not match the replay'; end if;
  update public.dwelleo_residential_listings set furnished = null where furnished is not distinct from true and id = any(g8);
  get diagnostics k = row_count; done := done + k;
  if k > 17 then raise exception 'dwelleo_residential_listings furnished true->null: % rows, measured 17', k; end if;
  if md5(array_to_string(g9, ',')) <> '143b3938c09933e862a0ed96bed63386' then raise exception 'id list g9 does not match the replay'; end if;
  update public.dwelleo_residential_listings set kitchen = null where kitchen is not distinct from true and id = any(g9);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'dwelleo_residential_listings kitchen true->null: % rows, measured 1', k; end if;
  if md5(array_to_string(g10, ',')) <> 'e687378ba9a01a685ca8741cc75ec9d4' then raise exception 'id list g10 does not match the replay'; end if;
  update public.dwelleo_residential_listings set parking = null where parking is not distinct from true and id = any(g10);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'dwelleo_residential_listings parking true->null: % rows, measured 1', k; end if;
  if md5(array_to_string(g11, ',')) <> '4169279646e44911f791a96348e053d6' then raise exception 'id list g11 does not match the replay'; end if;
  update public.haraj_residential_listings set elevator = null where elevator is not distinct from true and id = any(g11);
  get diagnostics k = row_count; done := done + k;
  if k > 2 then raise exception 'haraj_residential_listings elevator true->null: % rows, measured 2', k; end if;
  if md5(array_to_string(g12, ',')) <> '9aa9a7168a9e836d4f095b493b6b258b' then raise exception 'id list g12 does not match the replay'; end if;
  update public.haraj_residential_listings set kitchen = null where kitchen is not distinct from true and id = any(g12);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'haraj_residential_listings kitchen true->null: % rows, measured 1', k; end if;
  if md5(array_to_string(g13, ',')) <> '44455d2f68a728570dbaf4ba2c51737e' then raise exception 'id list g13 does not match the replay'; end if;
  update public.ibaax_residential_listings set furnished = false where furnished is not distinct from true and id = any(g13);
  get diagnostics k = row_count; done := done + k;
  if k > 4 then raise exception 'ibaax_residential_listings furnished true->false: % rows, measured 4', k; end if;
  if md5(array_to_string(g14, ',')) <> 'ca8bf6eea3c22901854810d487d186e8' then raise exception 'id list g14 does not match the replay'; end if;
  update public.jawher_residential_listings set driver_room = false where driver_room is not distinct from true and id = any(g14);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'jawher_residential_listings driver_room true->false: % rows, measured 1', k; end if;
  if md5(array_to_string(g15, ',')) <> 'e11d59dc9be2ceab9d1106a4873a400b' then raise exception 'id list g15 does not match the replay'; end if;
  update public.muhaysini_commercial_listings set furnished = false where furnished is not distinct from true and id = any(g15);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'muhaysini_commercial_listings furnished true->false: % rows, measured 1', k; end if;
  if md5(array_to_string(g16, ',')) <> 'd630a5615918df381e0a60a951b446e5' then raise exception 'id list g16 does not match the replay'; end if;
  update public.muhaysini_residential_listings set air_conditioner = false where air_conditioner is not distinct from true and id = any(g16);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'muhaysini_residential_listings air_conditioner true->false: % rows, measured 1', k; end if;
  if md5(array_to_string(g17, ',')) <> '8f27ca6d743af108a1f9710a5f48a723' then raise exception 'id list g17 does not match the replay'; end if;
  update public.muhaysini_residential_listings set air_conditioner = null where air_conditioner is not distinct from true and id = any(g17);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'muhaysini_residential_listings air_conditioner true->null: % rows, measured 1', k; end if;
  if md5(array_to_string(g18, ',')) <> '70beeb86c9d4a9d31b57493129332d26' then raise exception 'id list g18 does not match the replay'; end if;
  update public.muhaysini_residential_listings set furnished = false where furnished is not distinct from true and id = any(g18);
  get diagnostics k = row_count; done := done + k;
  if k > 7 then raise exception 'muhaysini_residential_listings furnished true->false: % rows, measured 7', k; end if;
  if md5(array_to_string(g19, ',')) <> 'c24f65696385eebeed2a54d67ac68a3f' then raise exception 'id list g19 does not match the replay'; end if;
  update public.muhaysini_residential_listings set kitchen = false where kitchen is not distinct from true and id = any(g19);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'muhaysini_residential_listings kitchen true->false: % rows, measured 1', k; end if;
  if md5(array_to_string(g20, ',')) <> '28f328f057d190a2708e3ff78ee6da4d' then raise exception 'id list g20 does not match the replay'; end if;
  update public.muhaysini_residential_listings set parking = null where parking is not distinct from true and id = any(g20);
  get diagnostics k = row_count; done := done + k;
  if k > 20 then raise exception 'muhaysini_residential_listings parking true->null: % rows, measured 20', k; end if;
  if md5(array_to_string(g21, ',')) <> '7551d03055a683f823539d15efbe5f8a' then raise exception 'id list g21 does not match the replay'; end if;
  update public.sirdab_commercial_listings set furnished = false where furnished is not distinct from true and id = any(g21);
  get diagnostics k = row_count; done := done + k;
  if k > 5 then raise exception 'sirdab_commercial_listings furnished true->false: % rows, measured 5', k; end if;
  if md5(array_to_string(g22, ',')) <> 'd42d606446fa9e94e847729c657fc767' then raise exception 'id list g22 does not match the replay'; end if;
  update public.tuba_commercial_listings set furnished = false where furnished is not distinct from true and id = any(g22);
  get diagnostics k = row_count; done := done + k;
  if k > 4 then raise exception 'tuba_commercial_listings furnished true->false: % rows, measured 4', k; end if;
  if md5(array_to_string(g23, ',')) <> '5dd948ea217e146d97a7813d32bfefd0' then raise exception 'id list g23 does not match the replay'; end if;
  update public.tuba_residential_listings set air_conditioner = null where air_conditioner is not distinct from true and id = any(g23);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'tuba_residential_listings air_conditioner true->null: % rows, measured 1', k; end if;
  if md5(array_to_string(g24, ',')) <> '3a212bf1935bf8aefcb04a0593823562' then raise exception 'id list g24 does not match the replay'; end if;
  update public.tuba_residential_listings set furnished = false where furnished is not distinct from true and id = any(g24);
  get diagnostics k = row_count; done := done + k;
  if k > 90 then raise exception 'tuba_residential_listings furnished true->false: % rows, measured 90', k; end if;
  if md5(array_to_string(g25, ',')) <> '1f909eb4454bfe282fe89bac7f4fa919' then raise exception 'id list g25 does not match the replay'; end if;
  update public.tuba_residential_listings set furnished = null where furnished is not distinct from true and id = any(g25);
  get diagnostics k = row_count; done := done + k;
  if k > 5 then raise exception 'tuba_residential_listings furnished true->null: % rows, measured 5', k; end if;
  if md5(array_to_string(g26, ',')) <> '6e3c32f287dc39070fcbc1f0ae7ecba4' then raise exception 'id list g26 does not match the replay'; end if;
  update public.tuba_residential_listings set kitchen = null where kitchen is not distinct from true and id = any(g26);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'tuba_residential_listings kitchen true->null: % rows, measured 1', k; end if;
  raise notice 'amenity reader leftovers: % rows changed of 253 measured', done;
end $r$;

-- Check, inline: no active ad on these sites stores furnished = yes while its own label answers «لا» (ibaax's
-- structured «Furnished» chip excepted), and muhaysini's own detector still resolves.
do $c$
declare k int;
begin
  with t as (
    select 'tuba_residential_listings' tbl, id, furnished, coalesce(description, '') d, false chip
      from public.tuba_residential_listings where active
    union all
    select 'tuba_commercial_listings' tbl, id, furnished, coalesce(description, '') d, false chip
      from public.tuba_commercial_listings where active
    union all
    select 'dealapp_residential_listings' tbl, id, furnished, coalesce(description, '') d, false chip
      from public.dealapp_residential_listings where active
    union all
    select 'ibaax_residential_listings' tbl, id, furnished, coalesce(description, '') d, coalesce(additional_info->'amenity_words', '[]'::jsonb) ? 'Furnished' chip
      from public.ibaax_residential_listings where active
    union all
    select 'sirdab_commercial_listings' tbl, id, furnished, coalesce(description, '') d, false chip
      from public.sirdab_commercial_listings where active
    union all
    select 'dwelleo_residential_listings' tbl, id, furnished, coalesce(description, '') d, false chip
      from public.dwelleo_residential_listings where active
    union all
    select 'dwelleo_commercial_listings' tbl, id, furnished, coalesce(description, '') d, false chip
      from public.dwelleo_commercial_listings where active)
  select count(*) into k from t
   where furnished and not chip
     and d ~ '(مفروش|مؤثث)[ء-ي]{0,4}[ \t*]*[:：][ \t*]*(لا(?![ \t]*[يت]وجد[ \t]+(تفاصيل|معلومات|بيانات))|لايوجد|لاتوجد|بدون)([^ء-ي]|$)';
  if k <> 0 then raise exception '% labelled-no furnished rows still served as yes after the repair', k; end if;
  perform public.mon_detect_muhaysini_labelled_no_read_as_furnished();
  select count(*) into k from public.alert_event
   where kind = 'muhaysini_labelled_no_read_as_furnished' and resolved_at is null and dedup_key like '%:yes_served';
  if k <> 0 then raise exception 'muhaysini labelled-no detector reopened'; end if;
end $c$;
