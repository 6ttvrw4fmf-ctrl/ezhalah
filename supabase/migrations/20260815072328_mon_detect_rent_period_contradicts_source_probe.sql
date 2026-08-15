-- Barrier for the bug class found in run #22: a stored rent_period that CONTRADICTS this row's own
-- recorded live source probe.
--
-- The probe table is the evidence of record for "the source does not publish a period here" (owner
-- permanent rule #2, 2026-08-13: a waiver must be FK-gated to the probe and re-checked by a
-- detector). Until now nothing re-checked it. That matters because the tempting repair — importing
-- aqar's `rent_period_text`, which reads «سنوي» beside 61 period-NULL rentals — would silently flip
-- every one of those rows to annual, and would understate genuinely monthly ads 12x. This detector
-- is what makes that flip loud instead of silent.
--
-- It is deliberately NOT "row has no period" (that is rent_period_unreachable's job, and the residue
-- there is an owner product decision, §22). It fires only on CONTRADICTION: the newest probe for a
-- row observed 'none', yet the row now asserts a period anyway. Self-heals when the contradiction is
-- removed OR when a newer probe records a real observed period from the source.

create or replace function public.mon_rent_period_contradicts_probe()
returns table(source_table text, listing_id bigint, stored_period text,
              probed_at timestamptz, observed_subtype text)
language sql stable as $$
  with newest as (
    select distinct on (p.source_table, p.listing_id)
           p.source_table, p.listing_id, p.probed_at, p.observed_subtype
      from public.ops_rent_period_source_probe p
     where p.http_status = 200            -- a failed fetch is not evidence of anything (rule #2)
     order by p.source_table, p.listing_id, p.probed_at desc
  )
  select n.source_table, n.listing_id, s.rent_period_ar, n.probed_at, n.observed_subtype
    from newest n
    join public.search_listings_ar s
      on s.source_table = n.source_table and s.listing_id = n.listing_id
   where n.observed_subtype = 'none'
     and s.rent_period_ar in ('سنوي','شهري');
$$;

comment on function public.mon_rent_period_contradicts_probe() is
'Rows whose newest HTTP-200 live source probe observed NO published rent period, yet which now carry '
'one in search. Run #22 (2026-08-15) probed all 63 periodless priced aqar rentals live: 61 publish no '
'usable per-listing period. aqar''s rent_period_text field reads «سنوي» on 59 of them AND on ads that '
'are genuinely monthly (6815491 = 600/month, 6817740, 6798704, 6658434) — it is a platform default, '
'not source truth. Importing it is the failure this guards: it would file 61 unknown-period rentals as '
'annual and understate every monthly ad 12x. Honest NULL is correct.';

create or replace function public.mon_detect_rent_period_contradicts_probe()
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; sample text;
begin
  select count(*), coalesce(string_agg(format('%s:%s', source_table, listing_id), ', '
                            order by listing_id) filter (where true), '')
    into n, sample
    from (select * from public.mon_rent_period_contradicts_probe() limit 20) t;

  if n = 0 then
    perform public.mon_resolve_key('rent_period_contradicts_probe');
    return 0;
  end if;

  return public.mon_raise(
    'P1', 'rent_period_contradicts_probe', 'all', 'rent_period_contradicts_probe',
    jsonb_build_object(
      'why', 'A stored rent period contradicts this row''s OWN live source probe, which recorded that '
             'the source publishes no period for it. The usual cause is importing a platform DEFAULT '
             'field as if it were source truth — e.g. aqar''s rent_period_text, which reads «سنوي» even '
             'on genuinely MONTHLY ads (6815491 is 600/month). That mislabels unknown-period rentals '
             'and understates monthly ones 12x.',
      'adjudicate', 'Do NOT resolve by deleting the probe. Either the import is wrong (revert it and '
                    'restore honest NULL), or the source genuinely started publishing a period — in '
                    'which case re-probe the row live and record the NEW observation in '
                    'ops_rent_period_source_probe, which clears this by itself.',
      'rows', n, 'sample', sample));
end $$;

-- Roster wiring in the SAME migration — a barrier nothing calls is decoration (§11a), and
-- mon_detect_orphaned_detectors() fires on any detector nothing reaches.
create or replace function public.mon_run_all_detectors()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; k text; fn text; failed text[] := '{}'; cnt integer;
begin
  r := jsonb_build_object('ran_at', now(), 'failed', to_jsonb('{}'::text[]));
  for fn in
    select p.proname from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname like 'mon\_detect\_%'
       and pg_get_function_identity_arguments(p.oid) = ''
     order by p.proname
  loop
    k := regexp_replace(fn, '^mon_detect_', '');
    begin
      execute format('select %I()', fn) into cnt;
      r := r || jsonb_build_object(k, coalesce(cnt, 0));
    exception when others then
      failed := failed || fn;
      r := r || jsonb_build_object(k, null);
      perform public.mon_raise('P1', 'detector_crash', 'all', 'detector_crash:' || fn,
                jsonb_build_object('detector', fn, 'sqlstate', SQLSTATE, 'message', SQLERRM));
    end;
  end loop;
  r := jsonb_set(r, '{failed}', to_jsonb(failed));
  -- open_alerts is NOT the same claim as "every count 0": mon_raise() returns 0 for an already-open
  -- dedup key, so an all-zero sweep can sit on top of standing alerts (2026-08-10). Read both.
  r := r || jsonb_build_object('open_alerts', (
    select coalesce(jsonb_object_agg(severity, n), '{}'::jsonb)
      from (select severity, count(*) n from public.alert_event
             where resolved_at is null group by severity) s));
  return r;
end $$;