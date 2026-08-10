-- A monitor that cannot finish is not a monitor.
--
-- mon_check_private_capture_pii() scanned every capture key of every listing table in ONE statement
-- and hit the statement timeout on aqar's `content` key (80k rows x jsonb extraction x regex). It
-- "covered everything" in theory and completed on nothing in practice.
--
-- Replaced with a STATEFUL BATCHED SWEEPER: each invocation consumes a bounded row budget, advances
-- a per-(table,key) cursor, and records findings. A full pass completes across invocations and every
-- single invocation returns. Deterministic: the cursor is the primary key, so no row is skipped and
-- none is scanned twice within a pass. Driven by pg_cron every 20 minutes.
create table if not exists mon_pii_scan_state (
  table_name text not null, scan_key text not null,
  last_id bigint not null default 0, pass_no int not null default 1,
  rows_seen bigint not null default 0, updated_at timestamptz not null default now(),
  primary key (table_name, scan_key));

create table if not exists mon_pii_findings (
  table_name text not null, scan_key text not null, row_id bigint not null,
  found_at timestamptz not null default now(),
  primary key (table_name, scan_key, row_id));

comment on table mon_pii_findings is
  'PDPL. MUST BE EMPTY. One row per listing whose PRIVATE capture still holds contact PII in a '
  'free-text key. Populated by mon_scan_pii_capture_batch().';

-- Free-text capture keys ONLY. Coordinates, prices, ids, licences and URLs are regulatory/property
-- data: the mobile pattern matches nine digits starting with 5, which a latitude satisfies, so
-- scanning them would produce permanent false positives and train everyone to ignore the monitor.
create or replace function mon_pii_capture_keys() returns text[] language sql immutable as $$
  select array['source_text','description','title','addressText','locationAsPerDeed',
               'content','gd','ob','notes','obligations','additionalInfos']::text[];
$$;

create or replace function mon_scan_pii_capture_batch(p_budget int default 15000)
returns table(table_name text, scan_key text, scanned bigint, new_findings bigint, cursor_at bigint)
language plpgsql as $$
declare
  r record; kk text; budget int := greatest(p_budget, 1000);
  lo bigint; hi bigint; n_scan bigint; n_found bigint;
  pat constant text :=
    '((\+?966|00966|\y0)5[0-9]{8}|\y920[0-9]{5,8}\y|(wa\.me|t\.me)/\s*[0-9A-Za-z]'
    '|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})';
begin
  for r in select c.table_name as tn from information_schema.columns c
           join information_schema.tables t on t.table_name=c.table_name
             and t.table_schema='public' and t.table_type='BASE TABLE'
           where c.table_schema='public' and c.table_name like '%\_listings'
             and c.column_name='source_capture'
           order by c.table_name
  loop
    foreach kk in array mon_pii_capture_keys() loop
      exit when budget <= 0;
      insert into mon_pii_scan_state(table_name, scan_key) values (r.tn, kk) on conflict do nothing;
      select s.last_id into lo from mon_pii_scan_state s
        where s.table_name = r.tn and s.scan_key = kk;
      execute format($f$
        with slice as (
          select id, source_capture->>%L as v from public.%I where id > %s order by id limit %s
        ), hits as (
          insert into mon_pii_findings(table_name, scan_key, row_id)
          select %L, %L, id from slice where v ~ %L on conflict do nothing returning 1
        )
        select coalesce(max(id), %s), count(*), (select count(*) from hits) from slice$f$,
        kk, r.tn, lo, budget, r.tn, kk, pat, lo) into hi, n_scan, n_found;
      if n_scan = 0 then
        update mon_pii_scan_state s set last_id = 0, pass_no = s.pass_no + 1, updated_at = now()
          where s.table_name = r.tn and s.scan_key = kk;
      else
        update mon_pii_scan_state s set last_id = hi, rows_seen = s.rows_seen + n_scan, updated_at = now()
          where s.table_name = r.tn and s.scan_key = kk;
        budget := budget - n_scan::int;
      end if;
      table_name := r.tn; scan_key := kk; scanned := n_scan;
      new_findings := n_found; cursor_at := coalesce(hi, lo);
      return next;
    end loop;
  end loop;
end $$;

comment on function mon_scan_pii_capture_batch(int) is
  'PDPL sweeper. Consumes a bounded row budget per call and ALWAYS returns — replaces a monitor that '
  'timed out on aqar and therefore verified nothing. Cursors in mon_pii_scan_state; leaks in '
  'mon_pii_findings (MUST BE EMPTY). pg_cron ''mon-pii-capture-sweep'' calls it every 20 minutes.';

drop function if exists mon_check_private_capture_pii();
