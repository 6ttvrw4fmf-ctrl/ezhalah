-- TWO CORRECTIONS TO THE SITE-POSTING-DATE WORK OF THE SAME DAY (CodeRabbit review of the same PR, 2026-11-09).
--
-- 1. THE BACKFILL'S PROOF NO LONGER REJECTS A TRUE VALUE. ops_backfill_source_posting_date() (migration
--    20261109210500) writes a stamp that has no zone exactly as the site published it, fractions of a second included,
--    then compared it with the capture CUT TO THE SECOND. A capture like «2026-11-01T10:00:00.123456» therefore failed
--    its own proof: the call raised, rolled back, and every later call picked the same row and raised again — the
--    mop-up would have been stuck on one row. No stored row had that shape (all 79,456 filled, rows_left 0), so
--    nothing was written wrong; this is the function body with the comparison made per shape. Nothing else changed.
--
-- 2. FOUR SITES WERE DECLARED «publishes no posting date» WITHOUT ANYONE READING AN AD PAGE (migration 20261109211500:
--    gathern, aqarmonthly, rakez, sakani — «Declared from the survey; page not re-read»). A missing captured field is
--    not evidence that the source omits it (AGENTS.md, owner 2026-08-13), and a 'no' row is never alarmed, so a wrong
--    'no' hides the very break the detector exists for. They become 'unknown' — an open question — until a page is
--    read, and a 'no' row now cannot exist without the page that proves it (proof_url).
--
-- This migration changes no listing row: the proof below plants one value and rolls it back.

-- 1. The same function, with the proof comparing each shape with what was written for it.
create or replace function public.ops_backfill_source_posting_date(p_budget integer default 20000)
 returns table (tbl text, filled integer, rows_left bigint)
 language plpgsql
 set search_path = public
as $function$
declare
  -- (table, the jsonb column holding the capture, the key inside it)
  spec constant text[][] := array[
    ['dealapp_residential_listings', 'additional_info', 'date_posted'],
    ['dealapp_commercial_listings',  'additional_info', 'date_posted'],
    ['arkaan_residential_listings',  'additional_info', 'date_posted'],
    ['arkaan_commercial_listings',   'additional_info', 'date_posted'],
    ['mustqr_residential_listings',  'additional_info', 'mustqr_created_at'],
    ['mustqr_commercial_listings',   'additional_info', 'mustqr_created_at'],
    ['therc_residential_listings',   'source_capture',  'date_posted'],
    ['therc_commercial_listings',    'source_capture',  'date_posted'],
    ['tawia_residential_listings',   'additional_info', 'date_posted'],
    ['eydah_residential_listings',   'additional_info', 'date_posted'],
    ['eydah_commercial_listings',    'additional_info', 'date_posted']
  ];
  zoned  constant text := '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$';
  budget int := least(greatest(coalesce(p_budget, 0), 0), 20000);   -- the whole call, all tables together
  i int; t text; col text; k text; v int; v_left bigint; v_bad bigint;
begin
  for i in 1 .. array_length(spec, 1) loop
    t := spec[i][1]; col := spec[i][2]; k := spec[i][3];
    if to_regclass('public.' || t) is null then
      raise exception '% does not exist — refusing to guess which table was meant', t;
    end if;

    v := 0;
    if budget > 0 then
      -- One statement: write, then read back what was written and compare it with the capture.
      execute format($q$
        with w as (
          update public.%1$I u
             set date_added = case
                   when btrim(u.%2$I->>%3$L) ~ %4$L
                     then to_char(public.source_posted_at(u.%2$I->>%3$L) at time zone 'Asia/Riyadh',
                                  'YYYY-MM-DD"T"HH24:MI:SS') || '+03:00'
                   else btrim(u.%2$I->>%3$L)
                 end
           where u.id in (
                   select s.id
                     from public.%1$I s
                    where s.date_added is null
                      and public.source_posted_at(s.%2$I->>%3$L) is not null
                      -- the same three things the welcome guard distrusts: never write one
                      and public.source_posted_at(s.%2$I->>%3$L) <= coalesce(s.scraped_at, now()) + interval '1 day'
                      and public.source_posted_at(s.%2$I->>%3$L) <= now()
                    order by s.id
                    limit %5$s
                      for update skip locked)
             and u.date_added is null
          returning u.date_added as written, u.%2$I->>%3$L as captured)
        select count(*),
               -- A stamp WITH a zone is written to the second, so its capture is compared to the second. Anything
               -- else is written as published (trimmed), so it must read back as exactly the captured instant.
               count(*) filter (where public.source_posted_at(written) is null
                                   or public.source_posted_at(written)
                                      is distinct from case
                                        when btrim(captured) ~ %4$L
                                          then date_trunc('second', public.source_posted_at(captured))
                                        else public.source_posted_at(captured)
                                      end)
          from w
      $q$, t, col, k, zoned, budget) into v, v_bad;
      -- PROOF, every call: what was written must be readable and must be the captured instant.
      if v_bad > 0 then
        raise exception 'PROOF: % of the % rows written to % are not the captured site date — rolled back', v_bad, v, t;
      end if;
      budget := budget - v;
    end if;

    execute format($q$
      select count(*) from public.%1$I s
       where s.date_added is null
         and public.source_posted_at(s.%2$I->>%3$L) is not null
         and public.source_posted_at(s.%2$I->>%3$L) <= coalesce(s.scraped_at, now()) + interval '1 day'
         and public.source_posted_at(s.%2$I->>%3$L) <= now()
    $q$, t, col, k) into v_left;

    tbl := t; filled := v; rows_left := v_left;
    return next;
  end loop;
end $function$;
comment on function public.ops_backfill_source_posting_date(integer) is
  'Copies the listing site''s own posting date, already captured in the row, into date_added where date_added is NULL. At most 20,000 rows per call, all tables together; answers one row per table (filled, rows_left). Raises if a written value is not the captured instant. Never writes our own first_seen_at / scraped_at. Watched by mon_detect_source_posting_date_fill_regressed().';
revoke all on function public.ops_backfill_source_posting_date(integer) from public, anon, authenticated;
grant execute on function public.ops_backfill_source_posting_date(integer) to service_role;

-- 2. Not read is 'unknown', never 'no'.
update public.ops_source_posting_date_policy
   set publishes = 'unknown',
       evidence  = 'NOT PROBED. The scraper captures no posting date, and no ad page of this site has been read to '
                || 'see whether it publishes one. Read a live ad page; if it shows none, set publishes = ''no'' with '
                || 'that page in proof_url; if it shows one, set ''yes'' with the field in read_from and fix the scraper.'
 where platform in ('gathern', 'aqarmonthly', 'rakez', 'sakani')
   and publishes = 'no' and proof_url is null;

alter table public.ops_source_posting_date_policy
  drop constraint if exists posting_date_policy_no_has_proof;
alter table public.ops_source_posting_date_policy
  add constraint posting_date_policy_no_has_proof check (publishes <> 'no' or proof_url is not null);

-- PROOF at apply.
--  a. A capture with no zone and fractions of a second is filled and passes the function's own proof (planted on one
--     stored row, then rolled back). The earlier body raised «PROOF: … are not the captured site date» on this input.
--  b. A 'no' row without proof_url is refused.
do $$
declare v_id bigint; v_cap text; v_written text; v_filled int; v_refused boolean := false;
begin
  select id into v_id from public.eydah_residential_listings
   where additional_info is not null and scraped_at is not null order by id limit 1;
  if v_id is null then
    raise notice 'PROOF a skipped: eydah_residential_listings holds no row to plant on';
  else
    begin
      update public.eydah_residential_listings e
         set date_added = null,
             additional_info = jsonb_set(e.additional_info, '{date_posted}',
               to_jsonb(to_char((e.scraped_at at time zone 'Asia/Riyadh') - interval '2 days',
                                'YYYY-MM-DD"T"HH24:MI:SS') || '.123456'))
       where e.id = v_id
      returning e.additional_info->>'date_posted' into v_cap;
      select b.filled into v_filled from public.ops_backfill_source_posting_date() b
       where b.tbl = 'eydah_residential_listings';
      select date_added into v_written from public.eydah_residential_listings where id = v_id;
      if coalesce(v_filled, 0) < 1 or v_written is distinct from v_cap then
        raise exception 'PROOF: the planted capture % was not written as published (filled %, date_added %)',
          v_cap, v_filled, v_written;
      end if;
      raise exception '__posting_date_fraction_rollback__';
    exception when raise_exception then
      if sqlerrm <> '__posting_date_fraction_rollback__' then raise; end if;
    end;
    if exists (select 1 from public.eydah_residential_listings
                where id = v_id and additional_info->>'date_posted' like '%.123456') then
      raise exception 'PROOF: the planted capture was not rolled back';
    end if;
  end if;

  begin
    insert into public.ops_source_posting_date_policy (platform, publishes, measured_on, evidence, proof_url)
    values ('__selftest__', 'no', current_date, 'selftest', null);
  exception when check_violation then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'PROOF: a ''no'' row with no proof_url was accepted';
  end if;
  if exists (select 1 from public.ops_source_posting_date_policy where publishes = 'no' and proof_url is null) then
    raise exception 'PROOF: a ''no'' row without proof is still stored';
  end if;
  raise notice 'PROOF: a fractional capture with no zone is filled as published and rolled back; an unproven ''no'' is refused.';
end $$;
