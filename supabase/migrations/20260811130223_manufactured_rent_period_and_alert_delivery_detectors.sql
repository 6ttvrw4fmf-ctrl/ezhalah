-- TWO BLIND SPOTS FOUND BY AUDITING MY OWN AUDIT (2026-08-11).
--
-- (A) MANUFACTURED RENTAL PERIOD. ~15 scrapers assign
--         "rent_period": "annual" if is_rent else None
--     unconditionally — alhoshan, alkhaas, alnokhba, awal, deal, erapulse, fursaghyr, hajer, jazwtn,
--     jurash, nowaisiry, ramzalqasim, sadin, toor, plus abeea/raghdan via a literal. That is a
--     platform CONVENTION asserted as a source FACT, and it is the same class as a manufactured
--     `false`: the column cannot express "the source did not say".
--
--     The DB symptom, and the only one that is honest: a rent_period column that has NEVER held more
--     than one value across the platform's entire history is not reading anything. Identical logic to
--     detect_manufactured_negatives ("true nowhere, so it can only ever say no").
--
--     WHAT I DELIBERATELY DID NOT USE. My first idea was `source_capture ~ 'شهري'` on annual rows —
--     it reported 15,348 aqar rows and looked damning. It is worthless: aqar pages carry the RNPL
--     financing line «... شهريا», a similar-listings strip, and seller prose, none of which is this
--     listing's billing period. Matching prose instead of the anchored price slot is the exact §19
--     mistake this routine keeps re-learning, so it is not shipped.
--
-- (B) ALERT DELIVERY. 46 alerts were open and 20 of them P1, and `dispatched_at` was NULL on every
--     single one — no alert has ever been delivered. mon_dispatch_alerts() is correct and runs every
--     30 minutes; it finds `mon_config.alert_webhook_url` NULL and `ops_alert_channel` empty, so it
--     deliberately leaves the batch unstamped for the first configured destination. Nothing was
--     broken and nothing was reaching anyone. Choosing the destination is an owner decision (which
--     URL); making the SILENCE detectable is engineering, and that is what ships here.
create table if not exists public.ops_rent_period_single_value_ok (
  table_name text primary key,
  only_value text not null,
  reason     text not null,
  recorded_at timestamptz not null default now()
);
comment on table public.ops_rent_period_single_value_ok is
  'Evidence-bearing allowlist for tables whose rent_period legitimately holds ONE value, because the '
  'platform only sells that product. Same contract as ops_source_published_negative: narrow, per '
  'table, and each row must state the evidence. Never add a row to silence a hardcoding scraper.';

insert into public.ops_rent_period_single_value_ok (table_name, only_value, reason) values
  ('gathern_residential_listings', 'monthly',
   'gathern is a short-stay/booking marketplace — every unit is priced per night/month by construction, '
   'not by a parser default. Its scraper derives the figure from the booking price API, not a literal.'),
  ('aqarmonthly_residential_listings', 'monthly',
   'aqarmonthly IS the monthly-rental vertical of aqar; the platform has no annual product. '
   'scrapers/aqarmonthly/run.py prices a real 30-day window via the booking GraphQL query.')
on conflict (table_name) do nothing;

create or replace function public.mon_detect_manufactured_rent_period()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rec record; v_rows bigint; v_periods text; n int := 0; offenders jsonb := '[]'::jsonb;
begin
  for rec in
    select pr.platform, t.table_name tn
      from public.platform_registry pr
      join information_schema.tables t
        on t.table_schema = 'public' and t.table_name like pr.platform||'\_%\_listings'
     where pr.status = 'active' and pr.kind = 'source'
     order by t.table_name
  loop
    begin
      execute format(
        $f$select count(*), coalesce(string_agg(distinct rent_period, ','), '(none)')
             from public.%I where transaction_type = 'Rent'$f$, rec.tn)
        into v_rows, v_periods;
    exception when others then continue;
    end;

    -- only meaningful volume, only a column that has NEVER expressed a second value, and never a
    -- table whose single value is the platform's actual product.
    if v_rows >= 20 and v_periods <> '(none)' and position(',' in v_periods) = 0
       and not exists (select 1 from public.ops_rent_period_single_value_ok a where a.table_name = rec.tn) then
      offenders := offenders || jsonb_build_object('table', rec.tn, 'rent_rows', v_rows, 'only_value', v_periods);
    end if;
  end loop;

  if jsonb_array_length(offenders) > 0 then
    n := public.mon_raise('P2', 'manufactured_rent_period', 'all', 'manufactured_rent_period',
      jsonb_build_object(
        'tables', offenders,
        'why', 'rent_period on these tables has NEVER held more than one value across the platform''s '
               'whole history, so it is asserting a platform convention rather than reading the source. '
               'Explicit source Annual -> annual; explicit source Monthly -> monthly; source silent or '
               'ambiguous -> NULL. Never manufacture Annual because most listings happen to be annual. '
               'Fix the scraper to prove the period per listing; do NOT add an allowlist row to silence it.'));
  else
    perform public.mon_resolve_key('manufactured_rent_period', 'manufactured_rent_period');
  end if;
  return n;
end $function$;

create or replace function public.mon_detect_alert_delivery()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_hook text; v_channels int; v_open int; v_undelivered int; n int := 0;
begin
  select value into v_hook from public.mon_config where key = 'alert_webhook_url';
  select count(*) into v_channels from public.ops_alert_channel where enabled;
  select count(*) filter (where resolved_at is null),
         count(*) filter (where resolved_at is null and dispatched_at is null)
    into v_open, v_undelivered
    from public.alert_event;

  if v_open > 0 and coalesce(v_hook,'') = '' and v_channels = 0 then
    n := public.mon_raise('P1', 'alert_delivery', 'monitoring', 'alert_delivery_unconfigured',
      jsonb_build_object(
        'open_alerts', v_open, 'never_delivered', v_undelivered,
        'configured_channels', v_channels, 'webhook_configured', false,
        'why', 'Alerts are being raised and NOTHING is receiving them. mon_dispatch_alerts() runs every '
               '30 minutes and is working correctly: it finds mon_config.alert_webhook_url NULL and '
               'ops_alert_channel empty, so it leaves the batch unstamped for the first configured '
               'destination. A P1 nobody receives is not a P1. Configuring the destination is an OWNER '
               'input (which URL); until then this makes the silence itself visible in the daily sweep.'));
  else
    perform public.mon_resolve_key('alert_delivery', 'alert_delivery_unconfigured');
  end if;
  return n;
end $function$;

-- ── roster wiring, SANCTIONED NEEDLE-EDIT (never a pasted body — see 20260811124301) ─────────────
do $$
declare
  v_def text;
  anchor constant text := '''mon_detect_orphaned_detectors''';
  want constant text[] := array['mon_detect_manufactured_rent_period','mon_detect_alert_delivery'];
  fn text; missing text[] := '{}';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing — refusing to guess at the array shape';
  end if;

  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then
      v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n    ' || anchor);
    end if;
  end loop;
  execute v_def;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then missing := missing || fn; end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'roster wiring incomplete: %', array_to_string(missing, ', ');
  end if;
  if position('open_alerts' in v_def) = 0 then
    raise exception 'roster return can no longer report standing alerts';
  end if;
end $$;

-- ── MUTATION TESTS ───────────────────────────────────────────────────────────────────────────────
do $mut$
declare v_n int; v_tables jsonb; v_had_gathern boolean;
begin
  -- (A) must FIRE on the hardcoded-annual cohort
  v_n := public.mon_detect_manufactured_rent_period();
  select detail->'tables' into v_tables from public.alert_event
   where dedup_key = 'manufactured_rent_period' and resolved_at is null;
  if v_tables is null or jsonb_array_length(v_tables) = 0 then
    raise exception 'manufactured_rent_period did not fire on a fleet that hardcodes annual in ~15 scrapers';
  end if;

  -- MUTATION: gathern is allowlisted with evidence, so it must NOT appear. Remove the row and it
  -- must appear — that proves the allowlist is what suppresses it, not an accident of the predicate.
  select exists (select 1 from jsonb_array_elements(v_tables) e
                  where e->>'table' = 'gathern_residential_listings') into v_had_gathern;
  if v_had_gathern then
    raise exception 'allowlist not honoured: gathern appeared despite an evidence row';
  end if;

  delete from public.ops_rent_period_single_value_ok where table_name = 'gathern_residential_listings';
  perform public.mon_detect_manufactured_rent_period();
  select detail->'tables' into v_tables from public.alert_event
   where dedup_key = 'manufactured_rent_period' and resolved_at is null;
  select exists (select 1 from jsonb_array_elements(v_tables) e
                  where e->>'table' = 'gathern_residential_listings') into v_had_gathern;
  if not v_had_gathern then
    raise exception 'mutation failed: removing the allowlist row did not surface gathern — the predicate is not doing the work';
  end if;
  insert into public.ops_rent_period_single_value_ok (table_name, only_value, reason) values
    ('gathern_residential_listings', 'monthly',
     'gathern is a short-stay/booking marketplace — every unit is priced per night/month by construction, '
     'not by a parser default. Its scraper derives the figure from the booking price API, not a literal.');
  perform public.mon_detect_manufactured_rent_period();

  -- (B) alert delivery must fire while nothing is configured
  v_n := public.mon_detect_alert_delivery();
  if not exists (select 1 from public.alert_event
                  where dedup_key = 'alert_delivery_unconfigured' and resolved_at is null) then
    raise exception 'alert_delivery did not fire with 0 channels and open alerts';
  end if;

  raise notice 'both detectors fire, allowlist mutation-proven';
end $mut$;
