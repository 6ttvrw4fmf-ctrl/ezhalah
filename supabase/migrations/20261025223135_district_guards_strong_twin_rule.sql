-- District guards, the STRONG twin rule (owner 2026-10-25: «we need a very very strong guard — never duplicates»).
-- Checking the 225 names to add showed district_twin_check() misses copies that differ only by spaces, punctuation, «ال»,
-- the town's name stuck on («حي أشبيلية - بقيق», «الرابية بالهفوف»), the last letter («غبيرا» = «غبيرة», «الملقا» =
-- «الملقاه») or one wrong letter («البغددية» = «البغدادية»). From now on a new or renamed list name is refused when ANY of
-- these keys equals a name already on that city's list:
--   K1  letters only (norm_district_tok, every non-Arabic-letter char removed, trailing ا/ه/ء removed)
--   K2  K1 with every «ال» removed                                   «الملك عبدالله» = «ملك عبد الله»
--   K3  K1 with the town's own name stripped from either end        «أشبيلية - بقيق» = «أشبيلية»
--   K4  K1 one letter away (insert/delete/swap) when both are 5+ letters   «البغددية» = «البغدادية»
-- The owner exception now has to NAME the district: set ezhalah.district_guard_ok = '<that name>' lets that one name past
-- the twin / near-miss / junk checks (a real district that happens to be one letter from another, e.g. «الريحان» vs
-- «الريان»); it never allows a delete. Everything else in the guard is unchanged.

create or replace function public.district_key_letters(p text)
returns text
language sql immutable
as $function$
  select regexp_replace(regexp_replace(public.norm_district_tok(p), '[^ء-ي]', '', 'g'), '[اهء]+$', '')
$function$;

create or replace function public.district_edit_distance(a text, b text)
returns integer
language plpgsql immutable
as $function$
declare la int := length(a); lb int := length(b); prev int[]; cur int[]; cost int; i int; j int;
begin
  if a = b then return 0; end if;
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  prev := array(select generate_series(0, lb));
  for i in 1..la loop
    cur := array[i];
    for j in 1..lb loop
      cost := case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end;
      cur := cur || least(prev[j + 1] + 1, cur[j] + 1, prev[j] + cost);
    end loop;
    prev := cur;
  end loop;
  return prev[lb + 1];
end $function$;

create or replace function public.district_twin_strong(p_city_id integer, p_name text, p_except_district_id integer default null)
returns table (how text, twin_ar text)
language sql stable
as $function$
  with q as (
    select public.district_key_letters(p_name) k1,
           replace(public.district_key_letters(p_name), 'ال', '') k2,
           public.district_key_letters(coalesce((select city_ar from public.loc_catalog_city where city_id = p_city_id), '')) town
  ), c as (
    select d.district_id, d.district_ar, public.district_key_letters(d.district_ar) k1
      from public.loc_catalog_district d
     where d.city_id = p_city_id and (p_except_district_id is null or d.district_id <> p_except_district_id)
  )
  select how, c.district_ar
    from q, c,
    lateral (select case
      when c.k1 = q.k1 then 'same letters'
      when replace(c.k1, 'ال', '') = q.k2 then 'same letters without «ال»'
      when q.town <> '' and (regexp_replace(regexp_replace(regexp_replace(q.k1, '^(ب)?' || q.town, ''), '(ب)?' || q.town || '$', ''), '[اهء]+$', '') = c.k1
                             or regexp_replace(regexp_replace(regexp_replace(c.k1, '^(ب)?' || q.town, ''), '(ب)?' || q.town || '$', ''), '[اهء]+$', '') = q.k1) then 'same letters without the town name'
      when length(q.k1) >= 5 and length(c.k1) >= 5 and abs(length(q.k1) - length(c.k1)) <= 1
           and public.district_edit_distance(q.k1, c.k1) <= 1 then 'one letter away'
      end as how) h
   where how is not null
   order by case how when 'same letters' then 0 when 'same letters without «ال»' then 1 when 'same letters without the town name' then 2 else 3 end
   limit 1
$function$;

create or replace function public.trg_district_list_guard()
returns trigger
language plpgsql set search_path to 'public'
as $function$
declare v_norm text; v_twin record; v_strong record; v_ok text := nullif(current_setting('ezhalah.district_guard_ok', true), '');
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'district list guard: districts are never deleted (owner 2026-10-25)';
  end if;
  v_norm := public.norm_district_tok(new.district_ar);
  if v_norm is null or v_norm = '' then
    raise exception 'district list guard: empty district name';
  end if;
  new.district_norm := coalesce(new.district_norm, v_norm);
  if v_ok is not null and public.norm_district_tok(v_ok) = v_norm then
    return new;
  end if;
  if char_length(v_norm) < 2 or new.district_ar ~ '[0-9٠-٩]'
     or v_norm ~ '(^|\s)(مخطط|مخططات|قاعده|شارع|طريق|قري)(\s|$)' then
    raise exception 'district list guard: «%» is not a district name (a number, plan, base, street, road, villages or one letter)', new.district_ar;
  end if;
  select * into v_twin from public.district_twin_check(new.city_id, new.district_ar) limit 1;
  if v_twin.verdict = 'twin' and not (tg_op = 'UPDATE' and v_twin.twin_ar is not distinct from old.district_ar) then
    raise exception 'district list guard: «%» is a spelling twin of «%» on the list for city % — use that name', new.district_ar, v_twin.twin_ar, new.city_id;
  end if;
  select * into v_strong from public.district_twin_strong(new.city_id, new.district_ar, case when tg_op = 'UPDATE' then old.district_id end) limit 1;
  if v_strong.twin_ar is not null then
    raise exception 'district list guard: «%» is the same district as «%» on the list for city % (%) — use that name, or the owner names it in ezhalah.district_guard_ok', new.district_ar, v_strong.twin_ar, new.city_id, v_strong.how;
  end if;
  return new;
end $function$;

-- PROOF, every case inside a rolled-back sub-transaction; nothing stays.
do $proof$
declare n0 bigint := (select count(*) from public.loc_catalog_district); caught boolean; msg text;
  c_malqa int := (select city_id from public.loc_catalog_district where district_ar = 'حي الملقاه' limit 1);
  c_ghub int := (select city_id from public.loc_catalog_district where district_ar = 'حي غبيرة' and city_id = 3 limit 1);
  c_bagh int := (select city_id from public.loc_catalog_district where district_ar = 'حي البغدادية الشرقية' limit 1);
  c_buq int := (select city_id from public.loc_catalog_city where city_ar = 'بقيق' limit 1);
begin
  if c_malqa is null or c_ghub is null or c_bagh is null or c_buq is null then raise exception 'PROOF: fixture districts not found (% % % %)', c_malqa, c_ghub, c_bagh, c_buq; end if;
  if public.district_edit_distance('البغدديه', 'البغداديه') <> 1 or public.district_edit_distance('ريحان', 'ريان') <> 1 or public.district_edit_distance('سلام', 'سلام') <> 0 then
    raise exception 'PROOF: edit distance is wrong';
  end if;
  -- last letter: «الملقا» = «حي الملقاه»
  caught := false;
  begin insert into public.loc_catalog_district (city_id, district_ar) values (c_malqa, 'الملقا');
  exception when others then caught := sqlerrm like 'district list guard: «الملقا» is the same district as «حي الملقاه»%same letters%'; msg := sqlerrm; end;
  if not caught then raise exception 'PROOF: «الملقا» was not refused (%)', msg; end if;
  -- last letter: «غبيرا» = «حي غبيرة»
  caught := false;
  begin insert into public.loc_catalog_district (city_id, district_ar) values (c_ghub, 'غبيرا');
  exception when others then caught := sqlerrm like 'district list guard: «غبيرا» is the same district as «حي غبيرة»%'; msg := sqlerrm; end;
  if not caught then raise exception 'PROOF: «غبيرا» was not refused (%)', msg; end if;
  -- «ال» and spaces: «ملك عبد الله» = «حي الملك عبدالله» (الرياض has it)
  if exists (select 1 from public.loc_catalog_district where city_id = 3 and district_ar = 'حي الملك عبدالله') then
    caught := false;
    begin insert into public.loc_catalog_district (city_id, district_ar) values (3, 'ملك عبد الله');
    exception when others then caught := sqlerrm like 'district list guard: «ملك عبد الله» is the same district as%'; msg := sqlerrm; end;
    if not caught then raise exception 'PROOF: «ملك عبد الله» was not refused (%)', msg; end if;
  end if;
  -- one letter away: «البغددية الشرقية» = «حي البغدادية الشرقية»
  caught := false;
  begin insert into public.loc_catalog_district (city_id, district_ar) values (c_bagh, 'البغددية الشرقية');
  exception when others then caught := sqlerrm like 'district list guard: «البغددية الشرقية» is the same district as «حي البغدادية الشرقية»%one letter away%'; msg := sqlerrm; end;
  if not caught then raise exception 'PROOF: «البغددية الشرقية» was not refused (%)', msg; end if;
  -- town name stuck on: «حي أشبيلية» IS on بقيق's list, so «حي أشبيلية - بقيق» (51 ads write it so) must be refused
  caught := false;
  begin insert into public.loc_catalog_district (city_id, district_ar) values (c_buq, 'حي أشبيلية - بقيق');
  exception when others then caught := sqlerrm like 'district list guard: «حي أشبيلية - بقيق» is the same district as «حي أشبيلية»%'; msg := sqlerrm; end;
  if not caught then raise exception 'PROOF: «حي أشبيلية - بقيق» was not refused (%)', msg; end if;
  -- and the same with a made-up base (rolled back), so the proof does not depend on the list
  begin
    insert into public.loc_catalog_district (city_id, district_ar) values (c_buq, 'حي ضمان الحراسة');
    caught := false;
    begin insert into public.loc_catalog_district (city_id, district_ar) values (c_buq, 'حي ضمان الحراسة - بقيق');
    exception when others then caught := sqlerrm like 'district list guard: «حي ضمان الحراسة - بقيق» is the same district as «حي ضمان الحراسة»%town name%'; msg := sqlerrm; end;
    if not caught then raise exception 'PROOF: «حي ضمان الحراسة - بقيق» was not refused (%)', msg; end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if; end;
  -- the owner exception must NAME the district: a different name in the setting does not unlock
  begin
    perform set_config('ezhalah.district_guard_ok', 'شيء آخر', true);
    caught := false;
    begin insert into public.loc_catalog_district (city_id, district_ar) values (c_malqa, 'الملقا');
    exception when others then caught := sqlerrm like 'district list guard: «الملقا» is the same district as%'; end;
    if not caught then raise exception 'PROOF: a wrong exception name unlocked the guard'; end if;
    perform set_config('ezhalah.district_guard_ok', 'الملقا', true);
    insert into public.loc_catalog_district (city_id, district_ar) values (c_malqa, 'الملقا');
    caught := false;
    begin delete from public.loc_catalog_district where district_ar = 'الملقا' and city_id = c_malqa;
    exception when others then caught := sqlerrm like 'district list guard: districts are never deleted%'; end;
    if not caught then raise exception 'PROOF: the exception allowed a delete'; end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if; end;
  -- the old proofs still hold
  caught := false;
  begin delete from public.loc_catalog_district where district_id = (select min(district_id) from public.loc_catalog_district);
  exception when others then caught := sqlerrm like 'district list guard: districts are never deleted%'; end;
  if not caught then raise exception 'PROOF: a delete was not refused'; end if;
  caught := false;
  begin insert into public.loc_catalog_district (city_id, district_ar) values (6, 'مخطط 5');
  exception when others then caught := sqlerrm like 'district list guard:%not a district name%'; end;
  if not caught then raise exception 'PROOF: a plan name was not refused'; end if;
  begin
    insert into public.loc_catalog_district (city_id, district_ar) values (6, 'حي اختبار الحراسة الجديدة تماما');
    raise exception 'ROLLBACK_REVERT';
  exception when others then if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if; end;
  if (select count(*) from public.loc_catalog_district) <> n0 then raise exception 'PROOF: the list changed'; end if;
  raise notice 'PROOF OK: last letter, «ال»/spaces, one letter away and town-suffix copies refused; exception must name the district and never deletes; clean name accepted';
end $proof$;
