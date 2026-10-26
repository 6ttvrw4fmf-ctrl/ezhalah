-- TEXT FACTS → ADVANCED FILTER: the watchers (owner 2026-10-25, Rule B). Parts 1–2: 20261025203351 (store +
-- switch) and 20261025205008 (both index writers merge). This part adds what Quality & Repair reads and what
-- raises when the overlay misbehaves, plus the two schedules.
--
--   ops_text_facts_vs_index     every quoted text fact next to the value the index serves for that column
--   ops_text_facts_conflicts    THE FLAG LIST: box ticked, the ad's own words say no → served as unknown
--   ops_text_facts_status()     the «📊 Text facts» line of docs/ops/QUALITY_REPAIR_ENGINEER.md
--   mon_detect_text_facts()     five checks, each a pure predicate proven by mon_selftest_text_facts():
--     text_facts_not_applied    a fresh quoted fact the index does not serve under Rule B          (P1)
--     text_facts_stale_applied  a fact still applying after its ad's text changed                  (P1)
--     text_facts_unquoted       a value the overlay serves with no quote behind it                 (P1)
--     text_facts_switch_ignored the switch is off but the index still carries a text-only value     (P1)
--     text_facts_reader_stale   the nightly reader has not read anything for 36 h                    (P2)
-- Lag rule: the hourly sync (and wasalt's rich columns every 3 h) needs time to catch up, so a fact read, or
-- a switch flipped, less than 4 h ago is never judged.

create or replace function public.text_facts_overlay_on()
returns boolean language sql stable as $$
  select coalesce((select k.enabled from public.ops_feature_flags k where k.name = 'af_text_facts_overlay'), false)
$$;

create or replace view public.ops_text_facts_vs_index as
select f.source_table, f.listing_id, f.platform, f.listing_key, f.read_at, f.stale_at, e.key as col,
       (e.value ->> 'v')::boolean as text_value, e.value ->> 'q' as quote,
       s.listing_id is not null as in_index,
       (jsonb_build_object(
          'furnished', s.furnished, 'elevator', s.elevator, 'parking', s.parking, 'kitchen', s.kitchen,
          'air_conditioner', s.air_conditioner, 'maid_room', s.maid_room, 'driver_room', s.driver_room,
          'private_entrance', s.private_entrance, 'separate_electricity_meter', s.separate_electricity_meter,
          'separate_water_meter', s.separate_water_meter, 'electricity', s.electricity,
          'water_supply', s.water_supply, 'sanitation', s.sanitation, 'balcony', s.balcony,
          'laundry_room', s.laundry_room, 'pool', s.pool, 'gym', s.gym, 'garden', s.garden,
          'car_entrance', s.car_entrance, 'optical_fibers', s.optical_fibers) ->> e.key)::boolean as index_value
  from public.listing_text_facts f
 cross join lateral jsonb_each(f.facts) e
  left join public.search_listings_ar s on s.source_table = f.source_table and s.listing_id = f.listing_id;

-- Box ticked + the ad explicitly says no. With the switch on, Rule B serves NULL, and an indexed NULL beside a
-- quoted «no» can only come from a ticked box (box NULL or false + text no → false). With the switch off the
-- index is the box, so the same ads show as a served true beside a quoted no.
create or replace view public.ops_text_facts_conflicts as
select v.source_table, v.listing_id, v.platform, v.listing_key, v.col, v.quote, v.read_at
  from public.ops_text_facts_vs_index v
 where v.stale_at is null and v.in_index and v.text_value = false
   and v.read_at < now() - interval '4 hours'
   and case when public.text_facts_overlay_on() then v.index_value is null else v.index_value is true end;

-- ── the predicates (pure, so the selftest can feed them a deliberately broken input) ─────────────────────
create or replace function public.text_facts_not_applied(p_text boolean, p_index boolean)
returns boolean language sql immutable parallel safe as $$
  -- text yes → Rule B always serves yes; text no → never yes (false, or NULL on a conflict)
  select case when p_text then p_index is distinct from true else p_index is true end
$$;

create or replace function public.text_facts_unquoted(p_served boolean, p_quote text)
returns boolean language sql immutable parallel safe as $$
  select p_served is not null and coalesce(length(btrim(p_quote)), 0) = 0
$$;

create or replace function public.text_facts_stale_applied(p_src_hash text, p_cur_hash text, p_stale_at timestamptz)
returns boolean language sql immutable parallel safe as $$
  select p_stale_at is null and p_cur_hash is distinct from p_src_hash
$$;

create or replace function public.text_facts_switch_ignored(p_on boolean, p_view_rows bigint, p_text_only bigint)
returns boolean language sql immutable parallel safe as $$
  select not p_on and (coalesce(p_view_rows, 0) > 0 or coalesce(p_text_only, 0) > 0)
$$;

-- ── the detector ────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.mon_detect_text_facts()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  r int := 0;
  on_ boolean := public.text_facts_overlay_on();
  since timestamptz := coalesce((select k.changed_at from public.ops_feature_flags k where k.name = 'af_text_facts_overlay'), now());
  marker timestamptz := (select l.refreshed_at from public.mon_mv_refresh_log l where l.object_name = 'text_facts_mark_stale');
  n bigint; m bigint; d jsonb; t text; k bigint; ks bigint[]; stale jsonb := '[]'::jsonb;
begin
  -- 1. a fresh quoted fact the index does not serve under Rule B
  n := 0; d := null;
  if on_ and since < now() - interval '4 hours' then
    select count(*), jsonb_agg(jsonb_build_object('key', x.source_table || ':' || x.listing_id, 'col', x.col,
                                                  'text', x.text_value, 'index', x.index_value)) filter (where x.rn <= 10)
      into n, d
      from (select v.*, row_number() over () rn from public.ops_text_facts_vs_index v
             where v.stale_at is null and v.in_index and v.read_at < now() - interval '4 hours'
               and public.text_facts_not_applied(v.text_value, v.index_value)) x;
  end if;
  if n > 0 then
    r := r + public.mon_raise('P1', 'text_facts_not_applied', 'all', 'text_facts_not_applied',
      jsonb_build_object('rows', n, 'sample', d, 'for', '🔧',
        'why', 'A quoted ad-text fact older than 4 h is not what the index serves under Rule B (text yes must be served yes; text no never yes). A writer lost its af_rule_b merge or stopped running: compare sync_search_listings_ar / sync_listing_rich_attrs with 20261025205008.'));
  else
    perform public.mon_resolve('text_facts_not_applied', 'all');
  end if;

  -- 2. a fact still applying after its ad's text changed (only text changes the last marker pass could see)
  n := 0;
  if on_ and marker is not null then
    for t in select distinct f.source_table from public.listing_text_facts f where f.stale_at is null and f.facts <> '{}'::jsonb loop
      continue when to_regclass('public.' || t) is null;
      execute format(
        'select count(*), (array_agg(f.listing_id order by f.listing_id))[1:5]
           from public.listing_text_facts f join public.%I x on x.id = f.listing_id
          where f.source_table = %L and f.facts <> ''{}''::jsonb and x.scraped_at < $1
            and public.text_facts_stale_applied(f.src_hash, %s, f.stale_at)',
        t, t, public.text_facts_hash_expr(t, 'x'))
        into k, ks using marker - interval '15 minutes';
      if k > 0 then
        n := n + k;
        stale := stale || jsonb_build_object('table', t, 'rows', k, 'ids', to_jsonb(ks));
      end if;
    end loop;
  end if;
  if n > 0 then
    r := r + public.mon_raise('P1', 'text_facts_stale_applied', 'all', 'text_facts_stale_applied',
      jsonb_build_object('rows', n, 'tables', stale, 'marker', marker, 'for', '🔧',
        'why', 'These ads'' text changed before the last text_facts_mark_stale() pass, yet their old facts still apply. The marker is not running at the head of sync_search_listings_ar, or skipped a table.'));
  else
    perform public.mon_resolve('text_facts_stale_applied', 'all');
  end if;

  -- 3. a value the overlay serves with no quote behind it (and the table constraint that forbids one)
  select count(*) into n
    from public.listing_text_facts_af a
    join public.listing_text_facts f on f.source_table = a.source_table and f.listing_id = a.listing_id
   cross join lateral jsonb_each(to_jsonb(a) - 'source_table' - 'listing_id') e
   where public.text_facts_unquoted(case jsonb_typeof(e.value) when 'boolean' then e.value::text::boolean end,
                                    f.facts -> e.key ->> 'q');
  select count(*) into m from pg_constraint c
   where c.conrelid = 'public.listing_text_facts'::regclass and pg_get_constraintdef(c.oid) like '%text_facts_all_quoted%';
  if n > 0 or m = 0 then
    r := r + public.mon_raise('P1', 'text_facts_unquoted', 'all', 'text_facts_unquoted',
      jsonb_build_object('values_without_quote', n, 'quote_constraint_present', m > 0, 'for', '🔧',
        'why', 'Owner rule 2026-10-25: every text value needs its quote. listing_text_facts_af served a value with no quote, or the CHECK (text_facts_all_quoted) is gone.'));
  else
    perform public.mon_resolve('text_facts_unquoted', 'all');
  end if;

  -- 4. kill switch: off must mean box-only (view empty; no index value differs from the box on an ad with facts)
  n := 0; m := 0;
  if not on_ and since < now() - interval '4 hours' then
    select count(*) into n from public.listing_text_facts_af;
    select count(*) into m
      from public.listing_text_facts f
      join public.search_listings_ar s on s.source_table = f.source_table and s.listing_id = f.listing_id
      join public.listing_extra_attrs_mv e on e.source_table = f.source_table and e.listing_id = f.listing_id
     where f.facts <> '{}'::jsonb
       and (s.furnished, s.elevator, s.parking, s.kitchen, s.air_conditioner, s.maid_room, s.driver_room, s.private_entrance)
           is distinct from
           (e.furnished, e.elevator, e.parking, e.kitchen, e.air_conditioner, e.maid_room, e.driver_room, e.private_entrance);
  end if;
  if public.text_facts_switch_ignored(on_, n, m) then
    r := r + public.mon_raise('P1', 'text_facts_switch_ignored', 'all', 'text_facts_switch_ignored',
      jsonb_build_object('overlay_rows_while_off', n, 'index_rows_not_box', m, 'switched_off_at', since, 'for', '🔧',
        'why', 'ops_feature_flags.af_text_facts_overlay is OFF but the overlay still serves values (view rows) or the index still differs from the box. Run text_facts_apply_slice() over the listed tables.'));
  else
    perform public.mon_resolve('text_facts_switch_ignored', 'all');
  end if;

  -- 5. the nightly reader
  if coalesce((select max(f.read_at) from public.listing_text_facts f), '-infinity') < now() - interval '36 hours' then
    r := r + public.mon_raise('P2', 'text_facts_reader_stale', 'all', 'text_facts_reader_stale',
      jsonb_build_object('last_read', (select max(f.read_at) from public.listing_text_facts f), 'for', '🔧',
        'why', 'facts-words.yml (incremental, pg_cron gh-facts-words-nightly 07:05 UTC) has not read any ad for 36 h: new and changed ads get no text facts.'));
  else
    perform public.mon_resolve('text_facts_reader_stale', 'all');
  end if;
  return r;
end $$;

-- ── mutation proof: every predicate above must fire on a broken input and stay quiet on a clean one,
--    and the switch must actually empty the overlay (proven live, inside a rolled-back sub-transaction) ──
create or replace function public.mon_selftest_text_facts()
returns integer language plpgsql as $$
declare bad text[] := array[]::text[]; n_on bigint; n_off bigint; n_stale bigint;
begin
  -- Rule B itself
  if not (public.af_rule_b(null, true) is true and public.af_rule_b(null, false) is false
      and public.af_rule_b(false, true) is true and public.af_rule_b(true, null) is true
      and public.af_rule_b(true, false) is null and public.af_rule_b(false, null) is false) then
    bad := bad || 'af_rule_b is not Rule B'::text;
  end if;
  -- not applied: clean / broken
  if public.text_facts_not_applied(true, true) or public.text_facts_not_applied(false, false)
     or public.text_facts_not_applied(false, null) then
    bad := bad || 'not_applied fires on a correctly served value'::text;
  end if;
  if not (public.text_facts_not_applied(true, false) and public.text_facts_not_applied(true, null)
          and public.text_facts_not_applied(false, true)) then
    bad := bad || 'not_applied misses a box-only value beside a quoted fact'::text;
  end if;
  -- unquoted
  if public.text_facts_unquoted(true, 'يوجد مصعد') or public.text_facts_unquoted(null, '') then
    bad := bad || 'unquoted fires on a quoted (or unserved) value'::text;
  end if;
  if not (public.text_facts_unquoted(true, '') and public.text_facts_unquoted(false, null) and public.text_facts_unquoted(true, '  ')) then
    bad := bad || 'unquoted misses a value with no quote'::text;
  end if;
  -- stale
  if public.text_facts_stale_applied('a', 'a', null) or public.text_facts_stale_applied('a', 'b', now()) then
    bad := bad || 'stale_applied fires on fresh or already-stamped text'::text;
  end if;
  if not public.text_facts_stale_applied('a', 'b', null) then
    bad := bad || 'stale_applied misses changed text still applying'::text;
  end if;
  -- switch
  if public.text_facts_switch_ignored(true, 5, 5) or public.text_facts_switch_ignored(false, 0, 0) then
    bad := bad || 'switch_ignored fires when the switch is honoured'::text;
  end if;
  if not (public.text_facts_switch_ignored(false, 1, 0) and public.text_facts_switch_ignored(false, 0, 1)) then
    bad := bad || 'switch_ignored misses an overlay still serving while off'::text;
  end if;
  -- LIVE wiring of the switch and the stale stamp, rolled back
  begin
    insert into public.listing_text_facts (source_table, listing_id, platform, listing_key, src_hash, facts, run_id)
    values ('selftest_x_listings', -1, 'selftest', 'selftest', md5('selftest'), '{"elevator": {"v": true, "q": "يوجد مصعد"}}', 'selftest');
    update public.ops_feature_flags set enabled = true where name = 'af_text_facts_overlay';
    select count(*) into n_on from public.listing_text_facts_af where source_table = 'selftest_x_listings';
    update public.ops_feature_flags set enabled = false where name = 'af_text_facts_overlay';
    select count(*) into n_off from public.listing_text_facts_af where source_table = 'selftest_x_listings';
    update public.ops_feature_flags set enabled = true where name = 'af_text_facts_overlay';
    update public.listing_text_facts set stale_at = now() where source_table = 'selftest_x_listings';
    select count(*) into n_stale from public.listing_text_facts_af where source_table = 'selftest_x_listings';
    raise exception using errcode = 'P0001', message = 'text_facts_selftest_rollback';
  exception when others then
    if sqlerrm <> 'text_facts_selftest_rollback' then raise; end if;
  end;
  if n_on is distinct from 1 then bad := bad || 'switch ON does not serve a quoted fact'::text; end if;
  if n_off is distinct from 0 then bad := bad || 'switch OFF still serves a fact'::text; end if;
  if n_stale is distinct from 0 then bad := bad || 'a stale-stamped fact is still served'::text; end if;
  if cardinality(bad) > 0 then
    raise exception 'mon_selftest_text_facts FAILED: %', array_to_string(bad, ' | ');
  end if;
  return 0;
end $$;

-- ── the «📊 Text facts» line for Quality & Repair ──────────────────────────────────────────────────────
create or replace function public.ops_text_facts_status()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'switch', (select jsonb_build_object('on', k.enabled, 'changed_at', k.changed_at, 'reason', k.reason)
                 from public.ops_feature_flags k where k.name = 'af_text_facts_overlay'),
    'last_read_at', (select max(read_at) from public.listing_text_facts),
    'ads_read_last_36h', (select count(*) from public.listing_text_facts where read_at > now() - interval '36 hours'),
    'ads_read', (select count(*) from public.listing_text_facts),
    'ads_with_af_fact', (select count(*) from public.listing_text_facts where facts <> '{}'::jsonb),
    'stale_waiting_reread', (select count(*) from public.listing_text_facts where stale_at is not null),
    'conflicts', (select count(*) from public.ops_text_facts_conflicts),
    'served_from_text', (select count(*) from public.ops_text_facts_vs_index v
                          where v.stale_at is null and v.in_index and v.index_value is not distinct from v.text_value),
    'open_alerts', (select coalesce(jsonb_agg(a.dedup_key), '[]'::jsonb) from public.alert_event a
                     where a.dedup_key like 'text_facts_%' and a.resolved_at is null))
$$;

revoke all on table public.ops_text_facts_vs_index, public.ops_text_facts_conflicts from public, anon, authenticated;
grant select on table public.ops_text_facts_vs_index, public.ops_text_facts_conflicts to service_role;
revoke all on function public.text_facts_overlay_on() from public, anon, authenticated;
revoke all on function public.text_facts_not_applied(boolean, boolean) from public, anon, authenticated;
revoke all on function public.text_facts_unquoted(boolean, text) from public, anon, authenticated;
revoke all on function public.text_facts_stale_applied(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.text_facts_switch_ignored(boolean, bigint, bigint) from public, anon, authenticated;
revoke all on function public.mon_detect_text_facts() from public, anon, authenticated;
revoke all on function public.mon_selftest_text_facts() from public, anon, authenticated;
revoke all on function public.ops_text_facts_status() from public, anon, authenticated;
grant execute on function public.text_facts_overlay_on(), public.text_facts_not_applied(boolean, boolean),
  public.text_facts_unquoted(boolean, text), public.text_facts_stale_applied(text, text, timestamptz),
  public.text_facts_switch_ignored(boolean, bigint, bigint), public.mon_detect_text_facts(),
  public.mon_selftest_text_facts(), public.ops_text_facts_status() to service_role;

-- The selftest must pass at apply time: a broken predicate fails this migration, not a customer.
select public.mon_selftest_text_facts();

-- Schedules. The nightly reader after the 04:22 crawl (facts-words.yml dispatched with NO inputs = incremental,
-- 1 shard); the watchers after the reader's facts have had two hourly sync passes to land.
select cron.schedule('gh-facts-words-nightly', '5 7 * * *', $$select public.trigger_gh_workflow('facts-words.yml')$$);
select cron.schedule('mon-text-facts', '52 11 * * *',
  $$set statement_timeout to '300s'; select public.mon_selftest_text_facts(); select public.mon_detect_text_facts();$$);
