-- 🔧 2026-11-03 — THE INDEX-DIVERGENCE ORACLE LEARNS THE SILENT-RENT-PERIOD JUDGMENT (alert 12416, P1 since 10-31).
--
-- mon_detect_search_index_diverges_from_sync_source() predicts the rent period the next sync writes as
-- rent_pool_ar(platform, source period). Since 20261031205445 / 20261031215442 (owner: a SILENT rent period is judged
-- from its price) the sync's write passes through trg_rent_period_judgment, which turns a NULL period whose figure the
-- owner's rule can label into «سنوي» (rent_period_judged = true). The oracle never learned that: measured 14:45 UTC
-- 11-03, 11,139 "divergent" rows, 11,131 of them judged rows the trigger will write «سنوي» again, 8 rows the running
-- sync is about to re-judge. The P1 sat open for three days on correct rows, and with its dedup key open the detector
-- could not raise a real divergence (mon_raise returns 0 on an open key). Needle-edit: the oracle mirrors the judgment
-- — coalesce(pool, «سنوي» when judge_silent_rent_period_ar(the RAW figure the sync sends, type_ar) is not null)
-- — and the self-mirror also watches that enforce_rent_period_judgment() still judges through that function.
do $mig$
declare
  d text; old_ text; new_ text; k int;
begin
  d := pg_get_functiondef('public.mon_detect_search_index_diverges_from_sync_source'::regproc);

  old_ := '(public.rent_pool_ar(s.platform, a.rent_period))';
  -- The trigger judges the RAW figure the sync sends (rent_price_annual_ar(...) of the source row, then price_total), not
  -- the stored one: a judged per-month 700 is stored as 8,400 (×12), which the rule calls borderline — judging the stored
  -- figure read 109 correct rows as divergence on the first attempt. A touch with an unchanged figure keeps the judgment.
  new_ := 'coalesce(public.rent_pool_ar(s.platform, a.rent_period), '
       || 'case when public.judge_silent_rent_period_ar(coalesce(public.rent_price_annual_ar(s.platform, a.rent_period, a.price_annual, a.property_type), a.price_total), s.type_ar) is not null then ''سنوي'' '
       || 'when s.rent_period_judged and public.rent_price_annual_ar(s.platform, a.rent_period, a.price_annual, a.property_type) is not distinct from s.price_annual then s.rent_period_ar end)';
  k := (length(d) - length(replace(d, old_, ''))) / length(old_);
  if k <> 2 then raise exception 'expected the oracle expression exactly twice, found %', k; end if;
  d := replace(d, old_, new_);

  old_ := 'this oracle mirrors.''));';
  if position(old_ in d) = 0 then raise exception 'why-text anchor not found'; end if;
  d := replace(d, old_,
       'this oracle mirrors. NOTE (2026-11-03): a NULL source period whose figure the owner''''s 10-31 rule can label '
    || '(judge_silent_rent_period_ar) is written «سنوي» by trg_rent_period_judgment with rent_period_judged = true — '
    || 'the oracle mirrors that judgment, so those rows are NOT divergence.''));');

  old_ := 'and p.proname = ''sync_search_listings_ar''), '''')) = 0 then';
  if position(old_ in d) = 0 then raise exception 'self-mirror anchor not found'; end if;
  d := replace(d, old_,
       'and p.proname = ''sync_search_listings_ar''), '''')) = 0' || E'\n'
    || '     or position(''judge_silent_rent_period_ar('' in coalesce((select pg_get_functiondef(p.oid) from pg_proc p' || E'\n'
    || '                      where p.pronamespace = ''public''::regnamespace' || E'\n'
    || '                        and p.proname = ''enforce_rent_period_judgment''), '''')) = 0 then');

  execute d;

  -- landed
  d := pg_get_functiondef('public.mon_detect_search_index_diverges_from_sync_source'::regproc);
  if position(new_ in d) = 0 then raise exception 'the new oracle did not land'; end if;
  if position('enforce_rent_period_judgment' in d) = 0 then raise exception 'the self-mirror extension did not land'; end if;

  -- PROOF A: every judged «سنوي» row is predicted «سنوي» by the new oracle (the old one predicted NULL for all of them).
  select count(*) into k
    from public.search_listings_ar s
    join public.active_listing_ids_v2 a on a.source_table = s.source_table and a.listing_id = s.listing_id
   where s.deal_ar = 'إيجار' and s.rent_period_judged and s.rent_period_ar = 'سنوي'
     and s.rent_period_ar is distinct from coalesce(public.rent_pool_ar(s.platform, a.rent_period),
           case when public.judge_silent_rent_period_ar(coalesce(public.rent_price_annual_ar(s.platform, a.rent_period, a.price_annual, a.property_type), a.price_total), s.type_ar) is not null then 'سنوي'
                when s.rent_period_judged and public.rent_price_annual_ar(s.platform, a.rent_period, a.price_annual, a.property_type) is not distinct from s.price_annual then s.rent_period_ar end);
  if k <> 0 then raise exception 'PROOF A: % judged rows still read as divergence', k; end if;

  -- PROOF B (the mutant): a judged row stays divergence under the OLD oracle — the edit is what changed the verdict.
  select count(*) into k
    from public.search_listings_ar s
    join public.active_listing_ids_v2 a on a.source_table = s.source_table and a.listing_id = s.listing_id
   where s.deal_ar = 'إيجار' and s.rent_period_judged and s.rent_period_ar = 'سنوي'
     and s.rent_period_ar is distinct from public.rent_pool_ar(s.platform, a.rent_period);
  if k = 0 then raise exception 'PROOF B: the old oracle no longer flags judged rows — nothing to mirror?'; end if;

  -- PROOF C: a stated period still wins over the judgment (PERIOD = SOURCE): the judgment is only reached through coalesce.
  -- gathern + a stated period pools «شهري»; the judgment alone would say «سنوي» for 200,000 — the stated period must win.
  if public.rent_pool_ar('gathern', 'annual') is distinct from 'شهري'
     or public.judge_silent_rent_period_ar(200000, 'شقة') is null
     or coalesce(public.rent_pool_ar('gathern', 'annual'), case when public.judge_silent_rent_period_ar(200000, 'شقة') is not null then 'سنوي' end)
        is distinct from 'شهري' then
    raise exception 'PROOF C: a stated period must not be overridden by the judgment';
  end if;
end $mig$;

-- Re-judge now: the key resolves when nothing but the judgment separated the index from the sync.
select public.mon_detect_search_index_diverges_from_sync_source();