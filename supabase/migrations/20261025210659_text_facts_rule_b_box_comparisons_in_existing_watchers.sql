-- TEXT FACTS → ADVANCED FILTER: the watchers that compare the index with the BOX learn Rule B (owner 2026-10-25).
--
-- Six existing checks assert «search index = the site's own field». Under Rule B the index serves
-- af_rule_b(box, the ad's quoted sentence) for the 20 amenity columns (20261025205008), so each would raise on
-- every value the seller's words decided — false P1s that invite someone to "fix" the overlay away:
--   mon_detect_af_tri_state_violations   a quoted «لا يوجد مصعد» on a NULL box is a STATED no, not a manufactured one
--   mon_rich_attrs_barrier (C)           drift = index vs af_rule_b(listing_rich_attrs, overlay), not vs the box
--   ops_src_index_cert_run (A, B)        the sync's own source is now the merged value
--   mon_detect_dealapp_utilities_trapped, mon_detect_dwelleo_amenity_trapped, mon_detect_sanadak_unticked_box_as_no
--                                        judge only ads whose text did not decide those columns
-- Every other comparison in them is unchanged. The overlay's own correctness is watched by
-- mon_detect_text_facts (20261025205450). Same safety as part 2: md5 of each live body checked in this
-- transaction, every needle counted, any miss raises and nothing changes.

-- Did the ad's quoted sentence decide any of these columns for this listing (switch on, text not stale)?
create or replace function public.text_facts_decide(p_source_table text, p_listing_id bigint, p_cols text[])
returns boolean language sql stable as $$
  select exists (
    select 1 from public.listing_text_facts_af tf
     cross join lateral jsonb_each(to_jsonb(tf)) e
     where tf.source_table = p_source_table and tf.listing_id = p_listing_id
       and e.key = any (p_cols) and jsonb_typeof(e.value) = 'boolean')
$$;
revoke all on function public.text_facts_decide(text, bigint, text[]) from public, anon, authenticated;
grant execute on function public.text_facts_decide(text, bigint, text[]) to service_role;

do $$
declare
  fn text; want text; src text; e text[]; n int;
  plan jsonb := jsonb_build_object(
    'public.mon_detect_af_tri_state_violations()', 'b4c58a6339ef9c8cb15babf48a03b31f',
    'public.mon_rich_attrs_barrier()', '6d588ded7c13e7620b1df8375d01cf57',
    'public.ops_src_index_cert_run(text)', '6b2adbf2ebdf205776a4975201439698',
    'public.mon_detect_dealapp_utilities_trapped()', '4c8b1a0ed91f2eae2d193cca75540613',
    'public.mon_detect_dwelleo_amenity_trapped()', 'cbef75bbc2a6b2f7a13374a1d7a066df',
    'public.mon_detect_sanadak_unticked_box_as_no()', '6fa11dfe44131a3db82cdd44eb3dc5e2');
  edits text[][] := array[
    -- tri-state: a quoted «no» on a NULL box is a stated no
    ['public.mon_detect_af_tri_state_violations()',
     '          and s.%I is false and e.%I is null
        limit 10) q$q$, fld, fld) into sample;',
     '          and s.%I is false and e.%I is null
          -- RULE B (2026-10-25): the ad''s own quoted «no» is a stated no, not a negative made from an unknown
          and not exists (select 1 from public.listing_text_facts_af tf
                            where tf.source_table = s.source_table and tf.listing_id = s.listing_id and tf.%I is false)
        limit 10) q$q$, fld, fld, fld) into sample;', '1'],
    -- rich barrier: drift against the merged value
    ['public.mon_rich_attrs_barrier()',
     '  select string_agg(format(''s.%I is distinct from r.%I'', c, c), '' or '') into diff_list from unnest(cols) c;',
     '  -- RULE B (2026-10-25): for the overlay columns the index serves af_rule_b(box, the ad''s quoted sentence).
  select string_agg(case when c = any (public.text_facts_af_columns())
                         then format(''s.%1$I is distinct from public.af_rule_b(r.%1$I, tf.%1$I)'', c)
                         else format(''s.%I is distinct from r.%I'', c, c) end, '' or '') into diff_list from unnest(cols) c;', '1'],
    ['public.mon_rich_attrs_barrier()',
     '        on r.source_table = s.source_table and r.listing_id = s.listing_id
     where (%s)$f$, diff_list)',
     '        on r.source_table = s.source_table and r.listing_id = s.listing_id
      left join public.listing_text_facts_af tf
        on tf.source_table = s.source_table and tf.listing_id = s.listing_id
     where (%s)$f$, diff_list)', '1'],
    -- certification: the sync's own source is the merged value
    ['public.ops_src_index_cert_run(text)',
     '           v.furnished, v.property_age, v.direction, v.street_width_m, v.floor_number,
           v.elevator, v.parking, v.kitchen, v.air_conditioner, v.maid_room, v.driver_room, v.private_entrance
      from public.listing_native_location_v2 v
',
     '           public.af_rule_b(v.furnished, tf.furnished) furnished, v.property_age, v.direction, v.street_width_m, v.floor_number,
           public.af_rule_b(v.elevator, tf.elevator) elevator, public.af_rule_b(v.parking, tf.parking) parking,
           public.af_rule_b(v.kitchen, tf.kitchen) kitchen, public.af_rule_b(v.air_conditioner, tf.air_conditioner) air_conditioner,
           public.af_rule_b(v.maid_room, tf.maid_room) maid_room, public.af_rule_b(v.driver_room, tf.driver_room) driver_room,
           public.af_rule_b(v.private_entrance, tf.private_entrance) private_entrance
      from public.listing_native_location_v2 v
      -- RULE B (2026-10-25): the sync''s own source is the box merged with the ad''s quoted sentence
      left join public.listing_text_facts_af tf on tf.source_table = v.source_table and tf.listing_id = v.listing_id
', '1'],
    ['public.ops_src_index_cert_run(text)',
     'count(*) filter (where s.%I is distinct from r.%I),',
     'count(*) filter (where s.%I is distinct from (case when %4$L = any (public.text_facts_af_columns())
               then public.af_rule_b(r.%4$I, (to_jsonb(tf) ->> %4$L)::boolean) else r.%4$I end)),', '1'],
    ['public.ops_src_index_cert_run(text)',
     'join public.listing_rich_attrs r on r.source_table = s.source_table and r.listing_id = s.listing_id',
     'join public.listing_rich_attrs r on r.source_table = s.source_table and r.listing_id = s.listing_id
        left join public.listing_text_facts_af tf on tf.source_table = s.source_table and tf.listing_id = s.listing_id', '1'],
    -- platform watchers: judge only ads whose text did not decide the columns they watch
    ['public.mon_detect_dealapp_utilities_trapped()',
     '     where s.source_table = ''dealapp_residential_listings''
       and s.first_seen_at > now() - interval ''7 days'' and s.first_seen_at < now() - interval ''2 hours''',
     '     where s.source_table = ''dealapp_residential_listings''
       and s.first_seen_at > now() - interval ''7 days'' and s.first_seen_at < now() - interval ''2 hours''
       and not public.text_facts_decide(s.source_table, s.listing_id, array[''electricity'',''water_supply'',''sanitation''])', '1'],
    ['public.mon_detect_dealapp_utilities_trapped()',
     '     where s.source_table = ''dealapp_commercial_listings''
       and s.first_seen_at > now() - interval ''7 days'' and s.first_seen_at < now() - interval ''2 hours''',
     '     where s.source_table = ''dealapp_commercial_listings''
       and s.first_seen_at > now() - interval ''7 days'' and s.first_seen_at < now() - interval ''2 hours''
       and not public.text_facts_decide(s.source_table, s.listing_id, array[''electricity'',''water_supply'',''sanitation''])', '1'],
    ['public.mon_detect_dwelleo_amenity_trapped()',
     '     where s.platform = ''dwelleo'' and s.first_seen_at > now() - interval ''7 days''
       and s.first_seen_at < now() - interval ''2 hours''',
     '     where s.platform = ''dwelleo'' and s.first_seen_at > now() - interval ''7 days''
       and s.first_seen_at < now() - interval ''2 hours''
       and not public.text_facts_decide(s.source_table, s.listing_id, array[''gym'',''pool'',''garden''])', '2'],
    ['public.mon_detect_sanadak_unticked_box_as_no()',
     '     and (driver_room is false or pool is false or gym is false or garden is false);',
     '     and (driver_room is false or pool is false or gym is false or garden is false)
     and not public.text_facts_decide(source_table, listing_id, array[''driver_room'',''pool'',''gym'',''garden'']);', '1']
  ];
begin
  for fn, want in select key, value #>> '{}' from jsonb_each(plan) loop
    src := pg_get_functiondef(fn::regprocedure);
    if md5(src) <> want then
      raise exception '% moved since this migration was written (md5 %); rebase the needles', fn, md5(src);
    end if;
    foreach e slice 1 in array edits loop
      continue when e[1] <> fn;
      n := (length(src) - length(replace(src, e[2], ''))) / length(e[2]);
      if n <> e[4]::int then
        raise exception '%: needle found % times, expected %: %', fn, n, e[4], left(e[2], 80);
      end if;
      src := replace(src, e[2], e[3]);
    end loop;
    execute src;
  end loop;
end $$;
