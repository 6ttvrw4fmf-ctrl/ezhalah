-- RENT PERIOD = SOURCE — retract manufactured سنوي labels (owner directive 2026-08-11).
--
-- A 10-agent per-platform audit (mechanisms with file:line in the companion scraper PR #476)
-- proved 11 platforms wrote rent_period='annual' from a hardcoded default with NO source signal
-- (raghdan run.py:429, alkhaas run.py:408, sadin run.py:514, hajer run.py:225, ramzalqasim
-- run.py:380, jurash run.py:395, mizlaj run.py:467, plus conditional-branch defects in abeea,
-- aldarim, alhoshan, souq24, eastabha). The scraper fixes merged FIRST (PR #476) so crawls cannot
-- rewrite these; this migration retracts the stored labels. Source-backed annual (abeea '/Yearly'
-- rows, aqaratikom subtype=سنوي, alhoshan rentLong 12-month semantics, eastabha rows with explicit
-- سنوي wording, aldarim rent_price_annually rows, wasalt/aqar/dealapp structured fields) is
-- UNTOUCHED. Prices remain: they are source-published figures; only the unproven period claim
-- goes. Missing -> NULL, never a guess.

-- ═══ 1. Wholesale retractions: rows where the source establishes no rental period ═══
do $$
declare
  rec record; v_tbl text; v_n int; v_total int := 0;
begin
  for rec in
    select * from (values
    ('abeea', array[645880,645883]::bigint[]),
    ('aldarim', array[576493,576442,576488]::bigint[]),
    ('alhoshan', array[584389]::bigint[]),
    ('alkhaas', array[645837,645839,645838,638745,638748,645834,645835,638739,645828,645836,638744,638743,638747,645831,645830,645829,645761,645720,645677,645680,645847,645757,645705,645657]::bigint[]),
    ('hajer', array[584500,584589,584495,584581,584590]::bigint[]),
    ('jurash', array[645411]::bigint[]),
    ('mizlaj', array[1034061,1034062,1034063,1034064,1034065,1034066,1962630]::bigint[]),
    ('raghdan', array[597790,597803,597804,597805,597894,597896,597898,597899,597900,597904,597910,597926,597927,597928,597929,597932,597933,597940,597942,597955,597956,597966,597972,597973,597974,597975,597976,597978,597986,597987,597997,598003,598004,598019,598020,598021,598022,598026,598027,598043,598045,598046,598047,598050,598051,598058,598074,598075,598090,598092,598102,598104,598105,598107,598108,598109,598110,598111,598113,598114,598115,598123,598124,598130,598178,598182,598186,598188,598189,598190,598193,598206,598207,598209,598212,598216,598220,625931,717667,951618,1201091,1380551,1566808,1647056,1647057,1720219,1801683,1801684,1961983,1962264,2032198,2202733,2202734,2202735,2290438,2493551,2493552,2867426,2867428,2867431,2867471,3040824,3237605,4166433,4743158,4743159,4743161,4947740,4947741,5129219,5435821,5435822,5435823,5435824,5435825,5718832,6109600,6192970,6192971,6259558,6259559,6493934,6494223,6757881,6757926,7166017,7395712]::bigint[]),
    ('ramzalqasim', array[615823,615827,615836]::bigint[]),
    ('sadin', array[598967,597786,598981,598956,597788,597858,598999,2116991]::bigint[]),
    ('souq24', array[648161]::bigint[])
    ) as t(platform, ids)
  loop
    foreach v_tbl in array array[rec.platform||'_residential_listings', rec.platform||'_commercial_listings'] loop
      if to_regclass('public.'||v_tbl) is not null then
        -- belt+braces: never touch a row whose own captured text carries a period token
        execute format(
          'update %I set rent_period = null
             where id = any($1) and rent_period is not null
               and coalesce(title,'''')||'' ''||coalesce(description,'''') !~ ''سنوي|شهري''', v_tbl)
          using rec.ids;
        get diagnostics v_n = row_count; v_total := v_total + v_n;
      end if;
    end loop;
  end loop;
  raise notice 'wholesale period retractions: % rows', v_total;
  if v_total < 150 then
    raise warning 'expected ~180 wholesale retractions, got % — token guard excluded more than the audit predicted; investigate before trusting counts', v_total;
  end if;
end $$;

-- ═══ 2. souq24 SQ24-1006: source says «نصف سنوي» (semi-annual) — no annual bucket exists ═══
update souq24_residential_listings set rent_period = null, price_annual = null
 where id = 648161;

-- ═══ 3. eastabha per-row repairs (each per live-page evidence in the audit) ═══
-- 595457: source publishes BOTH «سنوي: 20,000» and «شهري: 1,700»; we had stored annual=1,700(!).
update eastabha_residential_listings set rent_period='annual', price_annual=20000 where id=595457;
update eastabha_commercial_listings  set rent_period='annual', price_annual=20000 where id=595457;
-- 595447: period سنوي is source-backed (title) but stored price was the MONTHLY 1,500 figure —
-- wrong-unit price retracted; the fixed scraper re-derives from the page label on next crawl.
update eastabha_residential_listings set price_annual=null where id=595447;
update eastabha_commercial_listings  set price_annual=null where id=595447;
-- 11 rows provably non-annual at source (monthly/2-month lets) stored as annual with the raw
-- monthly figure in price_annual: wrong-unit pair retracted; fixed scraper restores on next crawl.
update eastabha_residential_listings set rent_period=null, price_annual=null
 where id = any(array[595413,595422,595426,595430,595444,595446,595450,595451,595453,595459,595529]::bigint[]);
update eastabha_commercial_listings  set rent_period=null, price_annual=null
 where id = any(array[595413,595422,595426,595430,595444,595446,595450,595451,595453,595459,595529]::bigint[]);
-- Remaining default-branch سنوي rows with no period wording in their captured text: the label was
-- manufactured (mechanism: run.py:546 default), the page label was never read -> honest NULL; the
-- fixed scraper (reads the data-price qualifier) restores true per-listing periods on next crawl.
update eastabha_residential_listings set rent_period=null
 where rent_period='annual'
   and coalesce(title,'')||' '||coalesce(description,'') !~ 'سنوي|السنوي|سنويا';
update eastabha_commercial_listings set rent_period=null
 where rent_period='annual'
   and coalesce(title,'')||' '||coalesce(description,'') !~ 'سنوي|السنوي|سنويا';

-- ═══ 4. dealapp rent>10M period misreads: live badge says «إيجار سنوي», we stored شهري ×365-class
-- (rows predate the 2026-08-05 badge-only parser fix; the parser is already correct) ═══
update dealapp_residential_listings set rent_period='annual', price_annual=110000 where id=1806652;
update dealapp_residential_listings set rent_period='annual', price_annual=60000  where id=3444216;
update dealapp_residential_listings set rent_period='annual', price_annual=35000  where id=5695779;
-- 5642237: structured source price 5,950,000 but period badge unestablishable (page now a shell)
update dealapp_residential_listings set rent_period=null, price_annual=null where id=5642237;
do $$ begin
  if to_regclass('public.dealapp_commercial_listings') is not null then
    update dealapp_commercial_listings set rent_period='annual', price_annual=110000 where id=1806652;
    update dealapp_commercial_listings set rent_period='annual', price_annual=60000  where id=3444216;
    update dealapp_commercial_listings set rent_period='annual', price_annual=35000  where id=5695779;
    update dealapp_commercial_listings set rent_period=null, price_annual=null where id=5642237;
  end if;
end $$;

-- ═══ 5. aqarcity 29362 (listing 593563, commercial): a car-parts business-handover ad whose only
-- source figure is a one-time 2,000,000 handover price; the keyword fallback classified it monthly
-- rent and annualize_rent manufactured 24,000,000. Source signals CONFLICT on the deal itself
-- (stored title «معرض للإيجار» vs live page category للبيع) so the deal is NOT flipped — never
-- guess. Only the provably manufactured price/period pair is retracted.
update aqarcity_commercial_listings set rent_period=null, price_annual=null where id=593563;

-- ═══ 6. Honest-unknown registry: platforms whose source publishes no rental period (or only
-- sometimes) — consumed by mon_detect_rent_period_unreachable so honest NULLs are not alarmed as
-- defects, while genuinely-broken platforms (aqar stub-captures, october) still page. ═══
create table if not exists ops_rent_period_sourceless (
  platform text primary key,
  reason text not null,
  decided_at timestamptz not null default now());
insert into ops_rent_period_sourceless(platform, reason) values
  ('raghdan','audit 2026-08-11: source pages/JSON-LD publish no rental period anywhere'),
  ('alkhaas','audit 2026-08-11: no source period field or wording'),
  ('sadin','audit 2026-08-11: no source period field or wording'),
  ('hajer','audit 2026-08-11: REM fields carry no period'),
  ('ramzalqasim','audit 2026-08-11: Livewire payload has bare price only'),
  ('jurash','audit 2026-08-11: no source period; unlabeled page figure suggests possible monthly display — flagged'),
  ('mizlaj','audit 2026-08-11: no period in payload'),
  ('eastabha','audit 2026-08-11: page label exists but only token-captured rows are period-claimed; NULL rows are honest-unknown until re-crawl'),
  ('abeea','audit 2026-08-11: dual-status rows print no period'),
  ('souq24','audit 2026-08-11: نصف/ربع سنوي rows have no annual bucket'),
  ('aldarim','audit 2026-08-11: rows without rent_price_* fields carry no period'),
  ('alhoshan','audit 2026-08-11: rentShort/zero-price rows carry no period')
on conflict (platform) do nothing;
