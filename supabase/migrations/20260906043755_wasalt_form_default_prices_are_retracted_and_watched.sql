-- INCIDENT #63 — the two rows its own adjudication could not have seen, and the half a code fix
-- never reaches.
--
-- WHAT #63 CONCLUDED, AND WHY THAT CONCLUSION IS NOW PARTLY RETRACTED. #63 measured eight monthly
-- cards under 500 SAR/month and adjudicated all eight SOURCE-BACKED, citing §25's wasalt price
-- fidelity sweep: "A 1 SAR/month wasalt row is what wasalt published." That was the correct verdict
-- on the evidence available at 18:27 on 2026-09-05. Six hours later PR #1892 went to the source
-- payload itself and proved the opposite for the wasalt limb: wasalt's listing form DEFAULTS an
-- unset rent to 1 and publishes it in rentFreq with default_freq:true, which states which tab the
-- site shows, not which number is real. The old scraper took that default and x12'd it. So the 1
-- was never wasalt's published price — it was Ezhalah's own arithmetic on wasalt's form default,
-- which is a named mechanism and therefore repairable under §8.
--
-- The inline prose in 20260905071148 says the same stale thing ("wasalt's cheapest monthly row
-- implies 1 SAR/month ... source-backed and must be preserved exactly"). That sentence is RETRACTED
-- by this migration for the placeholder rows specifically. Its detector is deliberately left
-- untouched: the threshold, the cohort-level design and the 500 floor are all still correct, and
-- rewriting a live function body to edit a comment is a revert hazard for no behavioural gain.
-- The rest of that comment stands — dealapp's 100 SAR/month rows are still adjudicated source-backed
-- and are NOT touched here.
--
-- WHAT THE CODE FIX COULD NOT DO. PR #1892 fixed scrapers/wasalt/run.py and said, correctly, "Rows
-- are NOT repaired by arithmetic here — the scrapers rewrite them from source on the next run."
-- WST5892686 was last mapped on 2026-08-28 and has not been re-mapped since, so eight days later
-- and a day after the fix shipped it is still served at «1 SAR/month» for a 3,519 m2 Riyadh tower
-- whose own payload carries 50,000/year. That is the §21 retraction trap in its plainest form: a
-- fixed scraper and a green code barrier are not a fixed database.
--
-- WHY THIS IS A REPAIR AND NOT AN INVENTED NUMBER. Nothing here is calculated, inferred, rounded or
-- chosen for plausibility. Every value written is read out of the listing's OWN archived source
-- payload (ar_data.propertyInfo.rentFreq), and the rule applied is byte-for-byte the rule the fixed
-- scraper applies today (scrapers/wasalt/run.py, _PLACEHOLDER_AMOUNTS = (0, 1)):
--     one side placeholder, other real  -> keep the REAL figure AND its REAL period
--     both placeholders                 -> the source published no price: assert none
--     both real but disagreeing         -> UNTOUCHED (ops_incident #65, an owner decision)
-- For WST5892686 the payload also agrees with itself three ways: rentFreq.yearly.amount = 50000,
-- expectedRent = 50000, conversionPrice = 50000, expectedRentType = «/سنة». ops_placeholder_price_
-- repair preserves price_before and period_before per row, so the write is exactly reversible.
--
-- SCOPE, MEASURED. Across the whole live wasalt fleet (68,323 rows carrying rentFreq) exactly THREE
-- rows have a placeholder amount on either side: WST5882159 (both placeholders — already correctly
-- carrying no price, and untouched by this migration), WST5892686 (active, 12/monthly, must be
-- 50,000/annual) and WST5861158 (inactive, 12/monthly, must be 3,700/annual). The inactive one is
-- repaired too: inactive is not deleted, and a resurrection would otherwise republish 1 SAR/month.
--
-- NOT TOUCHED, DELIBERATELY: the 388 both-real-but-disagreeing rows (#65), the dealapp rows at
-- 100/200/350 SAR/month, the sanadak row at 495, and wasalt WST5898096 whose payload publishes a
-- self-consistent 300/month + 3,600/year. None of those has a named Ezhalah mechanism behind it, so
-- under PRICE = SOURCE none of them is repairable here.

create table if not exists ops_placeholder_price_repair (
  id             bigserial   primary key,
  source_table   text        not null,
  listing_id     bigint      not null,
  ad_number      text,
  price_before   bigint,
  period_before  text,
  price_after    bigint,
  period_after   text,
  evidence       text        not null,
  repaired_at    timestamptz not null default now(),
  unique (source_table, listing_id)
);

comment on table ops_placeholder_price_repair is
  'Per-row provenance for prices retracted after a scraper published a source FORM DEFAULT as a '
  'quote (ops_incident #63, wasalt rentFreq amount 0/1 with default_freq true). price_before and '
  'period_before preserve exactly what was stored, so every write is reversible and nothing about '
  'the source is lost. Written only for rows whose own archived payload carries a placeholder.';

-- ── THE REPAIR ────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_ledger  int;
  v_updated int := 0;
  v_bad     int;
  v_notph   int;
begin
  -- LEDGER FIRST, so what was stored is preserved before anything changes. The class is derived
  -- entirely from each row's own archived payload; no id and no figure is written by hand.
  with cand as (
    select 'wasalt_commercial_listings'::text as src, id, ad_number, price_annual, rent_period,
           ar_data->'propertyInfo'->'rentFreq' as rf
      from wasalt_commercial_listings where price_annual between 0 and 12
    union all
    select 'wasalt_residential_listings', id, ad_number, price_annual, rent_period,
           ar_data->'propertyInfo'->'rentFreq'
      from wasalt_residential_listings where price_annual between 0 and 12
  ), num as (
    select c.*,
           case when c.rf->'monthly'->>'amount' ~ '^[0-9]+(\.[0-9]+)?$'
                then (c.rf->'monthly'->>'amount')::numeric end as m,
           case when c.rf->'yearly'->>'amount'  ~ '^[0-9]+(\.[0-9]+)?$'
                then (c.rf->'yearly'->>'amount')::numeric  end as y
      from cand c
  ), v as (
    select n.*,
           (n.m is not null and n.m in (0,1))     as m_ph,
           (n.y is not null and n.y in (0,1))     as y_ph,
           (n.m is not null and n.m not in (0,1)) as m_real,
           (n.y is not null and n.y not in (0,1)) as y_real
      from num n
  ), klass as (
    select v.src, v.id, v.ad_number, v.price_annual as price_before, v.rent_period as period_before,
           v.m, v.y,
           case when v.m_ph and v.y_real then v.y::bigint
                when v.y_ph and v.m_real then (v.m * 12)::bigint end as price_after,
           case when v.m_ph and v.y_real then 'annual'
                when v.y_ph and v.m_real then 'monthly' end          as period_after
      from v
     where (v.m_ph and v.y_real) or (v.y_ph and v.m_real)
        or ((v.m_ph or v.y_ph) and not v.m_real and not v.y_real)
  )
  insert into ops_placeholder_price_repair
        (source_table, listing_id, ad_number, price_before, period_before, price_after, period_after,
         evidence)
  select k.src, k.id, k.ad_number, k.price_before, k.period_before, k.price_after, k.period_after,
         'wasalt rentFreq carries a form-default placeholder amount (monthly '
         || coalesce(k.m::text, 'absent') || ', yearly ' || coalesce(k.y::text, 'absent')
         || '). The value written is the REAL side, read verbatim out of this row''s own archived '
         || 'ar_data.propertyInfo.rentFreq, under the rule scrapers/wasalt/run.py applies today '
         || '(_PLACEHOLDER_AMOUNTS = (0, 1), PR #1892). No arithmetic on a published figure.'
    from klass k
   where k.price_before is distinct from k.price_after
      or k.period_before is distinct from k.period_after
  on conflict (source_table, listing_id) do nothing;

  get diagnostics v_ledger = row_count;

  -- THE WRITE. Idempotent: a row moves only while it still holds the ledgered price_before.
  with upd as (
    update wasalt_commercial_listings l
       set price_annual = r.price_after, rent_period = r.period_after
      from ops_placeholder_price_repair r
     where r.source_table = 'wasalt_commercial_listings' and r.listing_id = l.id
       and l.price_annual is not distinct from r.price_before
       and l.rent_period  is not distinct from r.period_before
    returning 1)
  select count(*) into v_updated from upd;

  with upd as (
    update wasalt_residential_listings l
       set price_annual = r.price_after, rent_period = r.period_after
      from ops_placeholder_price_repair r
     where r.source_table = 'wasalt_residential_listings' and r.listing_id = l.id
       and l.price_annual is not distinct from r.price_before
       and l.rent_period  is not distinct from r.period_before
    returning 1)
  select v_updated + count(*) into v_updated from upd;

  -- POST-STATE: every ledgered row now holds exactly its ledgered answer.
  select (select count(*) from wasalt_commercial_listings l
            join ops_placeholder_price_repair r
              on r.source_table = 'wasalt_commercial_listings' and r.listing_id = l.id
           where l.price_annual is distinct from r.price_after
              or l.rent_period  is distinct from r.period_after)
       + (select count(*) from wasalt_residential_listings l
            join ops_placeholder_price_repair r
              on r.source_table = 'wasalt_residential_listings' and r.listing_id = l.id
           where l.price_annual is distinct from r.price_after
              or l.rent_period  is distinct from r.period_after)
    into v_bad;
  if v_bad <> 0 then
    raise exception 'REFUSING: % ledgered row(s) do not match the ledger after the write', v_bad;
  end if;

  -- CONTROL (§21), checked on the LEDGER itself rather than on a global count: every row this
  -- repair touched must carry a placeholder on one side in its own payload. A both-real row in
  -- here would mean the repair had started sweeping ops_incident #65.
  select count(*) into v_notph from ops_placeholder_price_repair r
   where not exists (
     select 1 from (
       select id, ar_data->'propertyInfo'->'rentFreq' as rf, 'wasalt_commercial_listings'::text as src
         from wasalt_commercial_listings
       union all
       select id, ar_data->'propertyInfo'->'rentFreq', 'wasalt_residential_listings'
         from wasalt_residential_listings) s
      where s.src = r.source_table and s.id = r.listing_id
        and (s.rf->'monthly'->>'amount' in ('0','1') or s.rf->'yearly'->>'amount' in ('0','1')));
  if v_notph <> 0 then
    raise exception 'REFUSING: % ledgered row(s) carry no placeholder - this repair must never '
                    'touch the both-real class (ops_incident #65)', v_notph;
  end if;

  raise notice 'placeholder price repair: ledgered=% updated=% non_placeholder_in_ledger=%',
    v_ledger, v_updated, v_notph;
end $$;

-- ── THE BARRIER ───────────────────────────────────────────────────────────────────────────────
-- WHY A NEW DETECTOR WHEN TWO BARRIERS ALREADY EXIST. verify-wasalt-placeholder-is-not-a-published-
-- price.ts is a CODE barrier: it executes the real map_property and proves the RULE is right. It
-- was green for a full day while both defective rows were still being served, because a code
-- barrier cannot see stored rows. mon_detect_unannualised_rent_cohort is a COHORT barrier and
-- deliberately cannot see an individual listing. This one reads the stored row against that row's
-- OWN archived source payload, which is the only thing that can tell a placeholder-derived price
-- from a cheap real one.
--
-- THE CANDIDATE FILTER IS NOT A MAGNITUDE GATE. `price_annual between 0 and 12` narrows the scan
-- from 68,323 jsonb reads (5.6 s) to an index-only scan of 2 rows (0.15 ms); it decides NOTHING.
-- The verdict is taken entirely from the payload, and a candidate whose payload holds no
-- placeholder is cleared, not flagged — the migration that ships this proves exactly that by
-- forcing a both-real row into the candidate window and asserting silence. The range is EXACT for
-- the scraper's placeholder set: the only prices that set can fabricate are 0, 1 and 1x12 = 12.
-- That coupling is the one way this detector could go dark, so it is checked from the other side by
-- scripts/verify-placeholder-price-detector-sees-the-whole-sentinel-set.ts, which executes the real
-- Python and fails if _PLACEHOLDER_AMOUNTS grows past what 12 covers.
create or replace function public.mon_detect_placeholder_price_stored()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rec record; n int := 0; live_keys text[] := '{}';
begin
  for rec in
    with cand as (
      select 'wasalt_commercial_listings'::text as src, id, ad_number, active, price_annual,
             rent_period, ar_data->'propertyInfo'->'rentFreq' as rf
        from wasalt_commercial_listings where price_annual between 0 and 12
      union all
      select 'wasalt_residential_listings', id, ad_number, active, price_annual,
             rent_period, ar_data->'propertyInfo'->'rentFreq'
        from wasalt_residential_listings where price_annual between 0 and 12
    ), num as (
      select c.*,
             case when c.rf->'monthly'->>'amount' ~ '^[0-9]+(\.[0-9]+)?$'
                  then (c.rf->'monthly'->>'amount')::numeric end as m,
             case when c.rf->'yearly'->>'amount'  ~ '^[0-9]+(\.[0-9]+)?$'
                  then (c.rf->'yearly'->>'amount')::numeric  end as y
        from cand c
    ), v as (
      select nn.*,
             (nn.m is not null and nn.m in (0,1))     as m_ph,
             (nn.y is not null and nn.y in (0,1))     as y_ph,
             (nn.m is not null and nn.m not in (0,1)) as m_real,
             (nn.y is not null and nn.y not in (0,1)) as y_real
        from num nn
    ), klass as (
      select v.src, v.id, v.ad_number, v.active, v.price_annual, v.rent_period, v.m, v.y,
             case when v.m_ph and v.y_real then v.y::bigint
                  when v.y_ph and v.m_real then (v.m * 12)::bigint end as want_price,
             case when v.m_ph and v.y_real then 'annual'
                  when v.y_ph and v.m_real then 'monthly' end          as want_period
        from v
       where (v.m_ph and v.y_real) or (v.y_ph and v.m_real)
          or ((v.m_ph or v.y_ph) and not v.m_real and not v.y_real)
    )
    select k.* from klass k
     where k.price_annual is distinct from k.want_price
        or k.rent_period  is distinct from k.want_period
     order by k.src, k.id
  loop
    live_keys := live_keys || ('placeholder_price_stored:' || rec.src || ':' || rec.id::text);
    n := n + public.mon_raise('P1', 'placeholder_price_stored', 'wasalt',
      'placeholder_price_stored:' || rec.src || ':' || rec.id::text,
      jsonb_build_object(
        'why', 'This row stores ' || coalesce(rec.price_annual::text, 'no price') || ' / '
             || coalesce(rec.rent_period, 'no period') || ', but its own archived '
             || 'ar_data.propertyInfo.rentFreq carries a wasalt FORM DEFAULT (monthly '
             || coalesce(rec.m::text, 'absent') || ', yearly ' || coalesce(rec.y::text, 'absent')
             || '). A default_freq amount of 0 or 1 states which tab the site shows, not what the '
             || 'seller is asking. The stored figure is Ezhalah arithmetic on that default, not a '
             || 'published price.',
        'expected', coalesce(rec.want_price::text, 'no price at all')
             || ' / ' || coalesce(rec.want_period, 'no period'),
        'adjudicate', 'Do NOT reprice from plausibility and do NOT hide the card. Read this row''s '
             || 'rentFreq: keep the REAL side with its REAL period; if BOTH sides are placeholders '
             || 'the source published no price and none may be asserted. If BOTH sides are real and '
             || 'they disagree, this detector does not fire and must not be made to — that is the '
             || '388-row architectural class, ops_incident #65, and an owner decision.',
        'source_table', rec.src, 'listing_id', rec.id, 'ad_number', rec.ad_number,
        'active', rec.active,
        'stored_price_annual', rec.price_annual, 'stored_rent_period', rec.rent_period,
        'rentfreq_monthly', rec.m, 'rentfreq_yearly', rec.y,
        'want_price_annual', rec.want_price, 'want_rent_period', rec.want_period));
  end loop;

  -- Evaluated path only (§23a/§25a): raise and resolve share ONE predicate — the live keys are the
  -- keys this very loop produced, never a separately worded "is it still broken?" clause.
  perform public.mon_resolve_stale_keys('placeholder_price_stored', live_keys);
  return n;
end $function$;

comment on function public.mon_detect_placeholder_price_stored() is
  'P1. A stored wasalt price that came from the source''s own unset-form DEFAULT (rentFreq amount '
  '0 or 1 with default_freq true) rather than from a quote — the defect PR #1892 fixed in the '
  'scraper and could not retract from the rows the old code had already written (ops_incident #63; '
  'WST5892686 advertised a 3,519 m2 Riyadh tower at 1 SAR/month for 8 days while 50,000/year sat '
  'in the same payload). Per-listing by necessity and safe to be so, because the verdict comes '
  'from the row''s OWN archived payload, never from magnitude. Silent on the both-real-but-'
  'disagreeing class (#65) by construction. Measured cost 0.15 ms. A standing 0 is healthy.';

-- ROSTER WIRING, in the SAME migration (§11a). Needle-edited off the LIVE body so a concurrent
-- session's additions are not clobbered, with a hard assertion that the edit took.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if v_def is null then
    raise exception 'REFUSING: mon_run_all_detectors() not found - cannot wire the barrier';
  end if;

  if position('mon_detect_placeholder_price_stored' in v_def) > 0 then
    raise notice 'already wired into the roster; nothing to do';
    return;
  end if;

  if position('''mon_detect_unannualised_rent_cohort''' in v_def) = 0 then
    raise exception 'REFUSING: roster anchor not found - refusing to guess where to append';
  end if;

  v_def := replace(v_def,
    '''mon_detect_unannualised_rent_cohort''',
    '''mon_detect_unannualised_rent_cohort'',' || chr(10) ||
    '    ''mon_detect_placeholder_price_stored''');

  execute v_def;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_placeholder_price_stored' in v_def) = 0 then
    raise exception 'REFUSING: roster rewrite did not take';
  end if;
end $$;

-- ── MUTATION PROOF, executed against the real objects ─────────────────────────────────────────
-- A standing 0 is indistinguishable from a detector that cannot fire (§24c). Both directions are
-- proven here, inside one atomic do-block, so the temporary mutations are never visible outside
-- this transaction and are undone even if an assertion raises:
--   (A) put the repaired row back to 12/monthly  -> the detector must raise EXACTLY its key;
--   (B) restore it                               -> the detector must clear that key;
--   (C) force a BOTH-REAL row (WST5898096: 300 monthly / 3,600 yearly, self-consistent) into the
--       candidate window by setting price_annual = 12 -> the detector must stay SILENT, because the
--       verdict comes from the payload and not from the size of the number. Without (C) the whole
--       detector could be a magnitude gate and still look green.
do $$
declare
  v_tbl  text   := 'wasalt_commercial_listings';
  v_id   bigint := 9501191;
  v_ctl  bigint := 9330045;                    -- WST5898096, residential, both sides real
  v_key  text;
  v_n    int;
  v_open int;
  v_ctl_price bigint;
begin
  v_key := 'placeholder_price_stored:' || v_tbl || ':' || v_id::text;

  if not exists (select 1 from wasalt_commercial_listings
                  where id = v_id and price_annual = 50000 and rent_period = 'annual') then
    raise notice 'SKIPPED mutation proof: fixture % is not in its post-repair state', v_id;
    return;
  end if;
  select price_annual into v_ctl_price from wasalt_residential_listings where id = v_ctl;
  if v_ctl_price is distinct from 3600 then
    raise notice 'SKIPPED mutation proof: control fixture % is not at 3600', v_ctl;
    return;
  end if;

  -- BASELINE: nothing found, and nothing of this kind left open by an earlier run.
  v_n := public.mon_detect_placeholder_price_stored();
  select count(*) into v_open from alert_event
   where kind = 'placeholder_price_stored' and resolved_at is null;
  if v_n <> 0 or v_open <> 0 then
    raise exception 'REFUSING: detector not clean before the mutation (raised %, % open)', v_n, v_open;
  end if;

  -- (A) re-introduce the exact defect.
  update wasalt_commercial_listings set price_annual = 12, rent_period = 'monthly' where id = v_id;
  v_n := public.mon_detect_placeholder_price_stored();
  select count(*) into v_open from alert_event
   where kind = 'placeholder_price_stored' and dedup_key = v_key and resolved_at is null;
  if v_n <> 1 or v_open <> 1 then
    raise exception 'MUTATION NOT KILLED: the reintroduced 1-SAR tower raised % alert(s) and left % '
                    'open key(s) - the detector cannot see the condition it exists for', v_n, v_open;
  end if;

  -- (B) restore, and the same predicate must retract its own alert.
  update wasalt_commercial_listings set price_annual = 50000, rent_period = 'annual' where id = v_id;
  v_n := public.mon_detect_placeholder_price_stored();
  select count(*) into v_open from alert_event
   where kind = 'placeholder_price_stored' and dedup_key = v_key and resolved_at is null;
  if v_n <> 0 or v_open <> 0 then
    raise exception 'REFUSING: detector did not clear after the repair (raised %, % still open)',
                    v_n, v_open;
  end if;

  -- (C) NOT A MAGNITUDE GATE: a both-real row inside the candidate window must stay silent.
  update wasalt_residential_listings set price_annual = 12 where id = v_ctl;
  v_n := public.mon_detect_placeholder_price_stored();
  update wasalt_residential_listings set price_annual = v_ctl_price where id = v_ctl;
  if v_n <> 0 then
    raise exception 'REFUSING: the detector fired on a both-real row (%) whose payload holds no '
                    'placeholder - it is judging magnitude, not source, and would sweep #65', v_ctl;
  end if;

  -- Fixtures are back where they started.
  if not exists (select 1 from wasalt_commercial_listings
                  where id = v_id and price_annual = 50000 and rent_period = 'annual')
     or (select price_annual from wasalt_residential_listings where id = v_ctl)
        is distinct from v_ctl_price
  then
    raise exception 'REFUSING: mutation proof did not restore its fixtures';
  end if;

  raise notice 'mutation proof: fires on the reintroduced defect, clears on repair, silent on both-real';
end $$;
