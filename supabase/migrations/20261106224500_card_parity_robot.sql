-- Card parity: does the card a customer opens say what the SOURCE ad says? (owner 2026-11-06: «eliminate bugs ASAP,
-- fully automate catching them»). On 11-06 ~37,000 live ads stored a REGA licence the card never printed; on 11-05
-- Dwelleo's 4,791 served links had died. Neither was seen by a robot, because no robot put OUR CARD next to THE SOURCE.
--
-- 1. ops_card_parity: one row per website per night from scrapers/common/card_parity.py (card-parity.yml): 1-2 served
--    ads per active website, the card read in the real customer journey, the source ad rendered with the honest UA;
--    `fields` = {field: {verdict: n}} for price, rent_period, area, bedrooms, bathrooms, city, district, licence, photo,
--    link; `samples` = the wrong ones with what we store and what the page says.
-- 2. mon_detect_card_parity (roster, :59): over the last 7 nights per website × field, P1 when at least 2 decided ads
--    are wrong AND they are at least half of the decided ones. Three classes, three lanes:
--      card_parity_card_missing     the source states it, we store it (or should), the card does not show it → 🔧
--      card_parity_source_mismatch  we store something else than the source ad says                         → 🆕
--      card_parity_link             the card does not open this ad (dead / moved / another page)             → ♻️
--    Repairs (a moved link rewritten, a licence copied onto the card key) are a self-resolving P2. No row for 30 h
--    (the check runs every 4 h) is itself a P1.
-- 3. ops_engineer_for_alert learns the two non-default lanes (needle insert into the LIVE definition, never a copy).
-- 4. pg_cron gh-card-parity: 33 1,5,9,13,17,21 → card-parity.yml; each run takes one sixth of the websites.
-- 5. PROOF at apply: a planted wrong licence on two ads is raised P1 for its website and field, a clean night resolves
--    it, both inside a rolled-back sub-transaction.

create table if not exists public.ops_card_parity (
  night        date        not null,
  platform     text        not null,
  sampled      integer     not null default 0,
  card_read    integer     not null default 0,
  source_read  integer     not null default 0,
  fields       jsonb       not null default '{}',
  samples      jsonb       not null default '[]',
  repaired     integer     not null default 0,
  note         text,
  run_url      text,
  created_at   timestamptz not null default now(),
  primary key (night, platform)
);
comment on table public.ops_card_parity is
  'Our card vs the source ad page, field by field, one row per website per night (scrapers/common/card_parity.py). '
  'Read by mon_detect_card_parity.';
alter table public.ops_card_parity enable row level security;
revoke all on public.ops_card_parity from anon, authenticated;
grant select, insert, update on public.ops_card_parity to service_role;

create or replace function public.mon_detect_card_parity()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare
  n int := 0; r record; v_kind text; v_wrong int; v_decided int; v_last timestamptz;
  live_cm text[] := '{}'; live_src text[] := '{}'; live_link text[] := '{}'; healed text[] := '{}';
begin
  for r in
    with recent as (
      select platform, night, fields, samples, run_url from public.ops_card_parity
       where night > current_date - 7
    ), f as (
      select platform, e.key as field,
             sum(coalesce((e.value->>'match')::int, 0))        as m,
             sum(coalesce((e.value->>'mismatch')::int, 0))     as mm,
             sum(coalesce((e.value->>'card_missing')::int, 0)) as cm,
             sum(coalesce((e.value->>'we_miss')::int, 0))      as wm,
             sum(coalesce((e.value->>'repaired')::int, 0))     as rep
        from recent, jsonb_each(fields) e
       group by platform, e.key
    )
    select f.*,
           (select jsonb_agg(s) from (select s from recent x, jsonb_array_elements(x.samples) s
                                       where x.platform = f.platform and s->>'field' = f.field
                                       order by x.night desc limit 5) z) as sample,
           (select max(run_url) from recent x where x.platform = f.platform) as run_url
      from f
  loop
    -- a licence the source shows and we never stored is still a licence the customer does not see
    v_wrong := case when r.field = 'licence' then r.cm + r.wm else r.cm end;
    v_kind := 'card_parity_card_missing';
    if r.mm > v_wrong then
      v_wrong := r.mm;
      v_kind := case when r.field = 'link' then 'card_parity_link' else 'card_parity_source_mismatch' end;
    end if;
    v_decided := r.m + r.mm + r.cm + case when r.field = 'licence' then r.wm else 0 end;
    if v_wrong >= 2 and 2 * v_wrong >= v_decided then
      if v_kind = 'card_parity_card_missing' then live_cm := live_cm || (v_kind || ':' || r.platform || ':' || r.field);
      elsif v_kind = 'card_parity_link' then live_link := live_link || (v_kind || ':' || r.platform || ':' || r.field);
      else live_src := live_src || (v_kind || ':' || r.platform || ':' || r.field);
      end if;
      n := n + public.mon_raise('P1', v_kind, r.platform, v_kind || ':' || r.platform || ':' || r.field,
        jsonb_build_object('field', r.field, 'wrong', v_wrong, 'decided', v_decided, 'match', r.m, 'mismatch', r.mm,
          'card_missing', r.cm, 'we_miss', r.wm, 'repaired', r.rep, 'window', '7 nights', 'samples', r.sample,
          'run_url', r.run_url, 'table', 'ops_card_parity',
          'why', case v_kind
            when 'card_parity_card_missing' then 'The source ad states this field and the card a customer opens does not '
              || 'show it (licence: the 11-06 class, 37,000 cards). Find where the card reads it (src/data/remote.ts '
              || 'finalize / ADDL_FIELDS) and which scraper path leaves it out of the row the card reads.'
            when 'card_parity_link' then 'The card does not open this ad: the stored link is dead, lands on another page, '
              || 'or the click opens a different URL (the 11-05 Dwelleo class). Open samples[].url in a browser.'
            else 'What we store (and the card shows) differs from what the source ad page says. samples[] carry our '
              || 'value; re-read the ad (source-reread.yml) and fix the parser, never the comparator.' end));
    end if;
    if r.rep > 0 then
      healed := healed || ('card_parity_self_healed:' || r.platform || ':' || r.field);
      n := n + public.mon_raise('P2', 'card_parity_self_healed', r.platform,
        'card_parity_self_healed:' || r.platform || ':' || r.field,
        jsonb_build_object('field', r.field, 'repaired', r.rep, 'run_url', r.run_url,
          'why', 'Mechanical repairs made by the card-parity robot (a moved link rewritten to the same ad, a stored '
              || 'licence copied onto the card key). Recurring repairs mean the scraper still writes the old shape.'));
    end if;
  end loop;
  perform public.mon_resolve_stale_keys('card_parity_card_missing', live_cm);
  perform public.mon_resolve_stale_keys('card_parity_source_mismatch', live_src);
  perform public.mon_resolve_stale_keys('card_parity_link', live_link);
  perform public.mon_resolve_stale_keys('card_parity_self_healed', healed);
  select max(created_at) into v_last from public.ops_card_parity;
  if coalesce(v_last, timestamptz '2026-11-07 06:00+00') < now() - interval '30 hours' then
    n := n + public.mon_raise('P1', 'card_parity_silent', 'fleet', 'card_parity_silent',
      jsonb_build_object('last_row', v_last, 'workflow', '.github/workflows/card-parity.yml',
        'why', 'The card-parity robot wrote no row for 30 hours (it runs every 4 hours): cards that disagree with '
            || 'their source would ship unseen.'));
  else
    perform public.mon_resolve_stale_keys('card_parity_silent', '{}');
  end if;
  return n;
end $function$;
revoke all on function public.mon_detect_card_parity() from public, anon, authenticated;
grant execute on function public.mon_detect_card_parity() to service_role;

-- Roster: needle-inserted into the LIVE definition (a full copy would clobber a peer's entry).
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_card_parity' in src) > 0 then
    raise notice 'mon_detect_card_parity already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_licence_not_on_card'',',
    E'    ''mon_detect_licence_not_on_card'',\n    ''mon_detect_card_parity'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- Lanes: the source mismatch is the 🆕 New Listings engineer's (field truth vs the original ad), a card that does not
-- open its ad is ♻️ Lifecycle's; card_missing / silent / self-healed stay on the default 🔧 repair lane.
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.ops_engineer_for_alert(text,text)'::regprocedure);
  if position('card_parity_source_mismatch' in src) > 0 then
    raise notice 'ops_engineer_for_alert already routes card parity';
    return;
  end if;
  out_def := replace(replace(src,
    $n$when p_kind ~ '^(zero_new_stall|$n$, $n$when p_kind ~ '^(card_parity_source_mismatch|zero_new_stall|$n$),
    $n$when p_kind ~ '^(wasalt_dead_but_active|$n$, $n$when p_kind ~ '^(card_parity_link|wasalt_dead_but_active|$n$);
  if out_def = src or position('card_parity_link' in out_def) = 0 or position('card_parity_source_mismatch' in out_def) = 0 then
    raise exception 'ops_engineer_for_alert anchors not found — refusing to guess';
  end if;
  execute out_def;
end $$;

select cron.schedule('gh-card-parity', '33 1,5,9,13,17,21 * * *', $c$select public.trigger_gh_workflow('card-parity.yml')$c$);

-- PROOF: a planted wrong licence (2 of 2 ads) is raised for its website + field and routed; a clean night resolves it.
do $$
declare v_hit int;
begin
  begin
    delete from public.ops_card_parity where platform = '__parity_selftest__';
    insert into public.ops_card_parity (night, platform, sampled, card_read, source_read, fields, samples)
    values (current_date, '__parity_selftest__', 2, 2, 2,
            '{"licence": {"match": 0, "card_missing": 2}, "price": {"match": 2}}',
            '[{"listing": "t:1", "field": "licence", "verdict": "card_missing", "stored": "7200767759"}]');
    perform public.mon_detect_card_parity();
    select count(*) into v_hit from public.alert_event
     where dedup_key = 'card_parity_card_missing:__parity_selftest__:licence' and resolved_at is null;
    if v_hit = 0 then raise exception 'PROOF: a planted licence-not-on-card was not raised'; end if;
    if exists (select 1 from public.alert_event where dedup_key like 'card_parity_%:__parity_selftest__:price'
                and resolved_at is null) then
      raise exception 'PROOF: a matching field was raised';
    end if;
    update public.ops_card_parity set fields = '{"licence": {"match": 2}}' where platform = '__parity_selftest__';
    perform public.mon_detect_card_parity();
    if exists (select 1 from public.alert_event where dedup_key = 'card_parity_card_missing:__parity_selftest__:licence'
                and resolved_at is null) then
      raise exception 'PROOF: a clean night did not resolve the alert';
    end if;
    if public.ops_engineer_for_alert('card_parity_source_mismatch', null) <> 'new_listings_engineer'
       or public.ops_engineer_for_alert('card_parity_link', null) <> 'lifecycle' then
      raise exception 'PROOF: card parity alerts are not routed to their lanes';
    end if;
    raise exception '__parity_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__parity_selftest_rollback__' then raise; end if;
  end;
  if position('mon_detect_card_parity' in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'PROOF: the detector is not on the roster';
  end if;
end $$;
