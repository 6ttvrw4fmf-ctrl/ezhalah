-- 🔧 2026-11-09 (repair queue: card_parity_self_healed, 3 open — alhoshan:link, macsaib:link, rawaf:licence).
-- Each was ONE mechanical repair on 11-07 followed by clean nights (link match 2/2 on 11-08 and 11-09), yet the
-- detector summed the whole 7-night window and re-affirmed the P2 every half hour. A self-healed finding now stands
-- only while the repair recurs: on the platform's latest sampled night, or on >= 2 nights. Nothing else changes —
-- card_parity_card_missing / _source_mismatch / _link and the licence re-check of 20261109213000 are as they were.

CREATE OR REPLACE FUNCTION public.mon_detect_card_parity()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
             sum(coalesce((e.value->>'repaired')::int, 0))     as rep,
             -- 2026-11-09: nights with a repair, and whether the platform's LATEST sampled night had one
             count(distinct night) filter (where coalesce((e.value->>'repaired')::int, 0) > 0) as rep_nights,
             bool_or(coalesce((e.value->>'repaired')::int, 0) > 0
                     and night = (select max(r2.night) from recent r2 where r2.platform = recent.platform)) as rep_latest
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
    -- 2026-11-07 (🔧): a «licence» the page shows that is NOT the REGA ad-licence shape (71/72xxxxxxxx) is an office or
    -- FAL number beside the label (#11054); a we_miss built only from such pages is not a missing licence.
    if r.field = 'licence' and r.cm = 0 and r.mm = 0 and r.wm > 0 and r.sample is not null
       and not exists (select 1 from jsonb_array_elements(r.sample) s where coalesce(s->>'page', '') ~ '^7[12][0-9]{8}$') then
      continue;
    end if;
    -- 2026-11-09 (🔧): judge the CURRENT card, not last week's. A licence finding whose every sampled listing now
    -- carries the page's licence on the card key is healed; an unreadable sample (null) is never counted healed.
    if r.field = 'licence' and r.mm = 0 and r.sample is not null
       and exists (select 1 from jsonb_array_elements(r.sample) s where coalesce(s->>'page', '') ~ '^7[12][0-9]{8}$')
       and not exists (select 1 from jsonb_array_elements(r.sample) s
                        where coalesce(s->>'page', '') ~ '^7[12][0-9]{8}$'
                          and public.card_parity_licence_on_card_now(s->>'listing', s->>'page') is not true) then
      continue;
    end if;
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
    -- «Recurring repairs mean the scraper still writes the old shape» (🔧 2026-11-09): a repair stands while it RECURS —
    -- on the platform's latest sampled night, or on two or more nights. One repair followed by clean nights is healed
    -- (alhoshan / macsaib links and the rawaf licence: repaired once on 11-07, matched 11-08 and 11-09, re-affirmed for
    -- a week). If the scraper still writes the old shape, the next sample repairs again and this raises again.
    if r.rep > 0 and (r.rep_latest or r.rep_nights >= 2) then
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
