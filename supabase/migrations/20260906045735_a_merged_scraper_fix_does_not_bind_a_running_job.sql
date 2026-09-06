-- INCIDENT #78 — a MERGED fix does not bind a job that was already running, and the write boundary
-- was the only place that could have stopped it.
--
-- WHAT #78 SAW. At 00:27 UTC on 2026-09-06 wasalt_residential_listings 2071894 (WST5882159) was
-- repaired to price_annual NULL / rent_period NULL from its own source_capture, and verified. At
-- 00:57:40 it was back to 12 / 'monthly'. The commercial twin 9501191 (WST5892686) was repaired to
-- 50,000 / 'annual' and was back to 12 / 'monthly' by 01:28:29. #78 recorded the mechanism as
-- UNKNOWN, because replaying the MERGED scraper on each row's own stored payload yields
-- AUTHORITATIVE_NULL / 50,000 — the 1x12 branch is genuinely unreachable there.
--
-- THE MECHANISM, MEASURED. It was never the merged code. `scrape_runs` id 41729 is one wasalt run
-- that STARTED 2026-09-05 21:02:54 and FINISHED 2026-09-06 01:28:42, upserting 100,359 rows — the
-- `wasalt-enum-liveness` enum step (`run.py --all --pages 2000`, timeout-minutes: 330), whose
-- header calls it "a daily full data refresh (price/field updates) as a side effect". GitHub
-- dispatched it at 21:01:55 on 1cbec63d. The placeholder rule merged at 21:10:13 (d28549ca, #1892)
-- and its AUTHORITATIVE_NULL follow-up at 23:00:20 (2281d0f9, #1904) — BOTH after that checkout.
-- actions/checkout pins a job's code for its whole life, so for 4h26m a pre-fix scraper kept
-- writing 1x12 = 12 over every wasalt row it re-read, including two that had just been repaired by
-- hand. The two writes #78 attributed to the 00:40 sweep are outside it: that sweep finished at
-- 00:44:30, thirteen minutes before the first one.
--
-- WHY A TRIGGER AND NOT ANOTHER CODE FIX. There is nothing left to fix in scrapers/wasalt/run.py —
-- it is correct, and it was correct while this happened. The gap is that "correct in main" and
-- "correct in every process currently writing" are different statements, and only the write
-- boundary can enforce the second one. Any writer — an in-flight old checkout, a rerun of an old
-- workflow, a hand-run script from a stale worktree — reaches the row through these two tables.
--
-- WHAT IT ENFORCES, AND WHERE THE VALUES COME FROM. Nothing is calculated, inferred, rounded or
-- chosen for plausibility. The verdict is read out of the SAME payload the writer itself is storing
-- in this very statement (`source_capture.rent_freq`, written verbatim by run.py from the list
-- response), under the owner's placeholder rule of 2026-09-05 (ops_incident #63/#65) — byte-for-byte
-- the branch order scrapers/wasalt/run.py applies today, with _PLACEHOLDER_AMOUNTS = (0, 1):
--     one side placeholder, other real  -> keep the REAL figure AND its REAL period
--     both placeholders                 -> the source published no price: assert none
--     both real (or the other side absent) -> UNTOUCHED. That is ops_incident #65, an owner
--                                          decision, and this trigger must never sweep it.
-- A row whose capture carries no rentFreq at all, and every Buy row, are untouched by construction.
--
-- WHAT THIS IS NOT. It is not the only line of defence and does not replace one:
-- mon_detect_placeholder_price_stored (20260906043755, ops_incident #63) still reads every stored
-- row against its own archived ar_data payload twice an hour, so if this trigger is ever dropped
-- the resulting rows are still reported within 30 minutes. This is prevention layered on top of
-- that detection, which is why it corrects rather than raises: a scraper batch of 96 rows must not
-- fail because one listing's form default is unset.
--
-- NOTE FOR ANYONE RE-PROVING #63's DETECTOR. 20260906043755's mutation proof re-introduces the
-- defect with `update ... set price_annual = 12, rent_period = 'monthly'`. With this trigger
-- installed that write is corrected on the way in, so the proof must first
-- `alter table <t> disable trigger trg_wasalt_placeholder_price_never_stored;` inside the same
-- transaction (DDL is transactional in Postgres, so the guard is restored on rollback/commit of
-- that block and there is never an unguarded window).
--
-- ops_incident #78. The generic class this is one instance of — a long-running ingestion job
-- silently writing pre-merge logic for hours, with no record of which revision wrote a row — is
-- routed separately; it is a job/seam problem, not a price problem.

create or replace function public.wasalt_placeholder_price_is_never_stored()
returns trigger
language plpgsql
as $function$
declare
  rf    jsonb;
  m_raw text;
  y_raw text;
  m     bigint;
  y     bigint;
begin
  if NEW.transaction_type is distinct from 'Rent' then
    return NEW;
  end if;

  rf := NEW.source_capture -> 'rent_freq';
  if rf is null or jsonb_typeof(rf) <> 'object' then
    return NEW;
  end if;

  m_raw := rf -> 'monthly' ->> 'amount';
  y_raw := rf -> 'yearly'  ->> 'amount';
  if m_raw is null and y_raw is null then
    return NEW;                                   -- the source sent no amount either side
  end if;

  -- _placeholder_free() in scrapers/wasalt/run.py: int(v), then None when the result is 0 or 1.
  -- A value int() cannot parse raises there and also returns None, which is what the regex guard
  -- reproduces here. m / y are therefore "the REAL published figure, or NULL".
  m := case when m_raw ~ '^-?[0-9]+(\.[0-9]+)?$' and trunc(m_raw::numeric) not in (0, 1)
            then trunc(m_raw::numeric)::bigint end;
  y := case when y_raw ~ '^-?[0-9]+(\.[0-9]+)?$' and trunc(y_raw::numeric) not in (0, 1)
            then trunc(y_raw::numeric)::bigint end;

  if m_raw is not null and m is null and y is not null then
    NEW.price_annual := y;                        -- placeholder monthly, real yearly
    NEW.rent_period  := 'annual';
  elsif y_raw is not null and y is null and m is not null then
    NEW.price_annual := m * 12;                   -- mirror case; price_annual is the annualised column
    NEW.rent_period  := 'monthly';
  elsif m is null and y is null then
    NEW.price_annual := null;                     -- every published amount is a form default
    NEW.rent_period  := null;
  end if;

  return NEW;
end
$function$;

comment on function public.wasalt_placeholder_price_is_never_stored() is
  'BEFORE INSERT/UPDATE guard on both wasalt listing tables: a price derived from wasalt''s unset-'
  'form DEFAULT (rentFreq amount 0 or 1) can never be STORED, whatever revision the writing '
  'process is running. ops_incident #78: a wasalt job dispatched 21:01:55 on a pre-fix checkout '
  'kept writing 1x12 = 12 until 01:28:42, hours after the fix merged, over rows that had just been '
  'repaired. Values come only from the row''s own source_capture.rent_freq in the same statement; '
  'the both-real-but-disagreeing class (ops_incident #65) is untouched by construction.';

drop trigger if exists trg_wasalt_placeholder_price_never_stored on public.wasalt_residential_listings;
create trigger trg_wasalt_placeholder_price_never_stored
  before insert or update on public.wasalt_residential_listings
  for each row execute function public.wasalt_placeholder_price_is_never_stored();

drop trigger if exists trg_wasalt_placeholder_price_never_stored on public.wasalt_commercial_listings;
create trigger trg_wasalt_placeholder_price_never_stored
  before insert or update on public.wasalt_commercial_listings
  for each row execute function public.wasalt_placeholder_price_is_never_stored();

-- ── MUTATION PROOF, executed against the real tables and the real production rows ──────────────
-- A guard nobody has watched refuse anything is a comment that runs. All four directions are
-- proven inside one do-block, so every mutation is undone even if an assertion raises:
--   (A) re-introduce #78's exact write (12 / 'monthly') on the commercial tower whose own payload
--       publishes 50,000/year -> the row must land 50,000 / 'annual';
--   (B) re-introduce it on the residential row whose payload is placeholder on BOTH sides
--       -> the row must land NULL / NULL;
--   (C) a BOTH-REAL row (WST5898096: 300 monthly / 3,600 yearly, self-consistent) -> whatever the
--       writer stores must survive verbatim, or this guard is sweeping ops_incident #65.
-- (C) restores the control row BEFORE it asserts, so a failed assertion cannot leave it mutated
-- even if this block is not running inside a transaction.
do $$
declare
  v_com   bigint := 9501191;      -- WST5892686, monthly=1 placeholder / yearly=50000 real
  v_res   bigint := 2071894;      -- WST5882159, both sides placeholder
  v_ctl   bigint := 9330045;      -- WST5898096, both sides real (300 / 3600)
  v_price bigint;
  v_per   text;
  v_ctl_price bigint;
  v_ctl_per   text;
begin
  if not exists (select 1 from wasalt_commercial_listings
                  where id = v_com and price_annual = 50000 and rent_period = 'annual')
     or not exists (select 1 from wasalt_residential_listings
                     where id = v_res and price_annual is null and rent_period is null)
  then
    raise exception 'REFUSING: fixtures are not in their repaired state - not proving anything';
  end if;
  select price_annual, rent_period into v_ctl_price, v_ctl_per
    from wasalt_residential_listings where id = v_ctl;
  if v_ctl_price is null then
    raise exception 'REFUSING: control fixture % carries no stored price', v_ctl;
  end if;

  -- (A)
  update wasalt_commercial_listings set price_annual = 12, rent_period = 'monthly' where id = v_com;
  select price_annual, rent_period into v_price, v_per
    from wasalt_commercial_listings where id = v_com;
  if v_price is distinct from 50000 or v_per is distinct from 'annual' then
    raise exception 'MUTATION NOT KILLED: the 1x12 write survived as % / % - the guard did not '
                    'replay the row''s own rentFreq (yearly 50000)', v_price, v_per;
  end if;

  -- (B)
  update wasalt_residential_listings set price_annual = 12, rent_period = 'monthly' where id = v_res;
  select price_annual, rent_period into v_price, v_per
    from wasalt_residential_listings where id = v_res;
  if v_price is not null or v_per is not null then
    raise exception 'MUTATION NOT KILLED: a both-placeholder row was left asserting % / %',
                    v_price, v_per;
  end if;

  -- (C) the guard must be silent on the both-real class, or it is judging magnitude, not source.
  update wasalt_residential_listings set price_annual = 12, rent_period = 'monthly' where id = v_ctl;
  select price_annual, rent_period into v_price, v_per
    from wasalt_residential_listings where id = v_ctl;
  update wasalt_residential_listings set price_annual = v_ctl_price, rent_period = v_ctl_per
   where id = v_ctl;
  if v_price is distinct from 12 or v_per is distinct from 'monthly' then
    raise exception 'REFUSING: the guard rewrote a BOTH-REAL row (%) to % / % - it would sweep '
                    'ops_incident #65', v_ctl, v_price, v_per;
  end if;

  -- Fixtures back where they started (A and B are already at their repaired values by construction).
  if not exists (select 1 from wasalt_commercial_listings
                  where id = v_com and price_annual = 50000 and rent_period = 'annual')
     or not exists (select 1 from wasalt_residential_listings
                     where id = v_res and price_annual is null and rent_period is null)
     or (select price_annual from wasalt_residential_listings where id = v_ctl)
        is distinct from v_ctl_price
  then
    raise exception 'REFUSING: mutation proof did not restore its fixtures';
  end if;

  raise notice 'mutation proof: 1x12 refused on both placeholder rows, both-real row untouched';
end $$;
