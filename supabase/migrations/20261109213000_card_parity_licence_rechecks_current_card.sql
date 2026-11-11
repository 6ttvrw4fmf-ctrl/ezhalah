-- 🔧 2026-11-09 (repair queue: card_parity_card_missing, 13 open — 10 of them «licence»).
-- mon_detect_card_parity() judged the last 7 nights of ops_card_parity and never looked at the listings it had
-- sampled, so a licence that already reached the card kept re-raising for a week: aqargate 10984251, fursaghyr
-- 4367079, october 13175940 and jurash 23104834 carried the page's licence on the card key while their alerts
-- were re-affirmed every half hour. A detector judges the CURRENT row: before a «licence» finding raises, every
-- sampled listing is re-read, and the finding stands only while at least one sample's card key still lacks the
-- licence its page printed. Nothing else moves: the thresholds, the window and every other field are unchanged.

create or replace function public.card_parity_licence_on_card_now(p_listing text, p_licence text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
-- true when the listing's card key (additional_info.rega_ad_license_number, or the label/value rows shape the
-- card also reads — src/data/remote.ts buildAdditionalInfo) now carries p_licence; null when it cannot be read
-- (unknown is never «healed»).
declare
  v_table text := split_part(p_listing, ':', 1);
  v_id    text := split_part(p_listing, ':', 2);
  v_info  jsonb;
begin
  if p_licence is null or v_id !~ '^[0-9]+$' or to_regclass('public.' || quote_ident(v_table)) is null
     or v_table !~ '^[a-z0-9_]+_listings$' then
    return null;
  end if;
  execute format('select additional_info from public.%I where id = $1', v_table) into v_info using v_id::bigint;
  if v_info is null then
    return false;
  end if;
  return case jsonb_typeof(v_info)
    when 'object' then v_info->>'rega_ad_license_number' = p_licence
    when 'array'  then exists (select 1 from jsonb_array_elements(v_info) e
                                where (e->>'key' = 'rega_ad_license_number' or e->>'label' = 'Ad license number')
                                  and e->>'value' = p_licence)
    else false end;
exception when others then
  return null;
end $function$;

revoke all on function public.card_parity_licence_on_card_now(text, text) from public, anon, authenticated;

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

-- Backfill (same rule as scrapers/common/db.py _licence_on_card, 🔧 2026-11-09): a live card whose OWN stored
-- description states exactly one REGA ad licence (71/72 + 8 digits) behind an ad-licence label, and whose card key
-- is empty, gets that licence on the card key, verbatim. Measured before apply: abeea 112, haraj 4, daryusuf 3,
-- eilmalriyada 1, ksaaqar 1, tamyaz 1. aqar is excluded: it states its licence in a structured payload field and
-- its prose disagrees on 181 of 7,064 rows where both exist. PRICE = SOURCE untouched; only the licence key moves.
do $backfill$
declare
  t text; k int; total int := 0;
  re constant text := $re$(?:(?:ترخيص\s*(?:(?:ال)?[إا]علان(?:ي|ى|ها)?(?:\s*(?:ال)?عقاري)?)?|رخص[ةه]\s*(?:ال)?[إا]علان(?:ي|ى)?(?:\s*(?:ال)?عقاري)?)(?:\s*\(?\s*(?:الهيئة العامة للعقار|معتمد)\s*\)?)?[\s:：/#*()\[\]{}|\\\-–ـ«»"'‎‏]{0,8}(?:رقم[\s:：/#*()\[\]{}|\\\-–ـ«»"'‎‏]{0,8})?([0-9٠-٩]{10})(?![0-9٠-٩])|\m(?:advertis(?:e|ing|ement)|ad)\s+licen[cs]e[\s:：/#*()\[\]{}|\\\-–ـ«»"'‎‏]{0,8}(?:(?:no\.?|number)[\s:：/#*()\[\]{}|\\\-–ـ«»"'‎‏]{0,8})?([0-9٠-٩]{10})(?![0-9٠-٩]))$re$;
begin
  for t in
    select c.table_name from information_schema.columns c
      join information_schema.tables x on x.table_schema = 'public' and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.table_name like '%\_listings' and c.table_name not like 'aqar\_%'
       and c.column_name = 'description'
       and exists (select 1 from information_schema.columns d where d.table_schema = 'public' and d.table_name = c.table_name
                      and d.column_name = 'additional_info' and d.data_type = 'jsonb')
       and exists (select 1 from information_schema.columns d where d.table_schema = 'public' and d.table_name = c.table_name
                      and d.column_name = 'active')
  loop
    execute format($u$
      with c as (
        select x.id, (select array_agg(distinct translate(coalesce(m[1], m[2]), '٠١٢٣٤٥٦٧٨٩', '0123456789'))
                        from regexp_matches(x.description, %L, 'gi') m) as lics
          from public.%I x
         where x.active and jsonb_typeof(x.additional_info) = 'object'
           and coalesce(x.additional_info->>'rega_ad_license_number', '') = '' and x.description ~ '[0-9٠-٩]{10}')
      update public.%I x set additional_info = x.additional_info || jsonb_build_object('rega_ad_license_number', c.lics[1])
        from c where c.id = x.id and cardinality(c.lics) = 1 and c.lics[1] ~ '^7[12][0-9]{8}$'$u$, re, t, t);
    get diagnostics k = row_count;
    if k > 0 then raise notice '% %', t, k; total := total + k; end if;
  end loop;
  raise notice 'licence backfill total %', total;
end $backfill$;
