-- TEXT FACTS → ADVANCED FILTER, part 1 of 2: the overlay store, born OFF (owner 2026-10-25, «We trust the
-- sellers sentence»; law: docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md «The seller's sentence — Rule B»).
--
-- The free word checker (scrapers/facts/word_checker.py, model word-checker-v1) reads each ad's own title +
-- description and returns, per fact, true (the ad names it) / false (the ad explicitly negates it) / nothing
-- (silent, prepared-only, nearby), each with the ad's own words as proof. This migration only builds the
-- place those answers live and the switch that serves them. NOTHING READS THE VIEW YET: the two index
-- writers start merging it in part 2, and the switch is born OFF.
--
-- OVERLAY, NEVER OVERWRITE. Text values are never written into a *_listings table — the scrapers rewrite
-- those on every crawl. They live here, one row per ad READ (an ad with no AF fact still gets a row, so the
-- nightly run knows it already read that text), keyed (source_table, listing_id): a re-read REPLACES the row.
--
-- STALE TEXT STOPS APPLYING. src_hash = md5(title || E'\n' || text) of the exact text the checker read,
-- computed by the database (text_facts_todo hands it to the job). text_facts_mark_stale() — run at the start
-- of every hourly sync pass from part 2 on — stamps stale_at on every row whose source text no longer hashes
-- to it, and the view drops stamped rows, so an ad whose text changed is back to box-only on the same pass.
-- The nightly run re-reads stamped rows and replaces them.
--
-- KILL SWITCH. ops_feature_flags('af_text_facts_overlay'). Off → listing_text_facts_af returns no rows →
-- every writer merges against nothing → the index is box-only again on the next sync pass. One line:
--   update public.ops_feature_flags set enabled = false, reason = '<why>', changed_at = now()
--    where name = 'af_text_facts_overlay';
--
-- Service-role only (public-key lockdown 2026-10-18): RLS on, no policies, anon/authenticated revoked.

create table if not exists public.ops_feature_flags (
  name       text primary key,
  enabled    boolean     not null,
  reason     text        not null check (length(reason) >= 20),
  changed_at timestamptz not null default now()
);
alter table public.ops_feature_flags enable row level security;
revoke all on table public.ops_feature_flags from public, anon, authenticated;
comment on table public.ops_feature_flags is
  'Kill switches read by database code. af_text_facts_overlay = serve the ad-text facts (Rule B) in the search index. Service-role only.';
insert into public.ops_feature_flags (name, enabled, reason)
values ('af_text_facts_overlay', false,
        'Born OFF (2026-10-25): turned on only after the first full fill is verified against the 10-25 report')
on conflict (name) do nothing;

-- The 20 search-index columns an ad's text may answer: exactly the Advanced Filter amenity columns the
-- checker reads (af_eligibility_clause p_amenities + p_furnished). rent_now_pay_later / installments /
-- payment_monthly are NOT here (a platform feature / a rent period, never prose). Facts with no filter
-- column yet (majlis, roof, warranty, …) stay in listing_facts only.
create or replace function public.text_facts_af_columns()
returns text[] language sql immutable parallel safe as $$
  select array['furnished','elevator','parking','kitchen','air_conditioner','maid_room','driver_room',
               'private_entrance','separate_electricity_meter','separate_water_meter','electricity',
               'water_supply','sanitation','balcony','laundry_room','pool','gym','garden','car_entrance',
               'optical_fibers']::text[]
$$;

-- Every stored value carries its quote; only the 20 columns; v is a JSON boolean. A DB constraint, not a
-- promise in the job: «every text value needs its quote» (owner).
create or replace function public.text_facts_all_quoted(p jsonb)
returns boolean language sql immutable parallel safe as $$
  select coalesce(jsonb_typeof(p), '') = 'object' and not exists (
    select 1 from jsonb_each(p) e
     where not (e.key = any (public.text_facts_af_columns()))
        or coalesce(jsonb_typeof(e.value -> 'v'), '') <> 'boolean'
        or coalesce(length(btrim(e.value ->> 'q')), 0) = 0)
$$;

create table if not exists public.listing_text_facts (
  source_table text        not null check (source_table ~ '^[a-z0-9_]+_listings$'),
  listing_id   bigint      not null,
  platform     text        not null,
  listing_key  text        not null,          -- the source table's ad_number
  src_hash     text        not null check (src_hash ~ '^[0-9a-f]{32}$'),
  facts        jsonb       not null default '{}'::jsonb check (public.text_facts_all_quoted(facts)),
  run_id       text        not null,
  read_at      timestamptz not null default now(),
  stale_at     timestamptz,
  primary key (source_table, listing_id)
);
alter table public.listing_text_facts enable row level security;
revoke all on table public.listing_text_facts from public, anon, authenticated;
comment on table public.listing_text_facts is
  'Current ad-text facts per ad READ (one row per ad, a re-read replaces it): {index column: {v: bool, q: the ad''s words}} for the 20 Advanced Filter columns, src_hash of the exact text read, stale_at once the text changed. Merged into search_listings_ar under Rule B by the index writers. Service-role only.';

-- The text column the checker reads (scrapers/facts/extract.py _text_col): wasalt keeps its prose in ar_data.
create or replace function public.text_facts_hash_expr(p_table text, p_alias text)
returns text language sql immutable parallel safe as $$
  select format('md5(coalesce(%1$s.title::text, '''') || chr(10) || coalesce(%2$s, ''''))', p_alias,
                case when p_table like 'wasalt\_%' then format('%s.ar_data -> ''propertyInfo'' ->> ''description''', p_alias)
                     else format('%s.description::text', p_alias) end)
$$;

-- RULE B (owner 2026-10-25). box = the site's own field as the index already serves it; text = the ad's sentence.
--   box NULL / no column, text yes or explicit no → the text
--   box false,            text names it          → true      (the seller's sentence wins)
--   box true,             text silent            → true      (box)
--   box true,             text explicitly negates → NULL      (conflict → unknown; flagged for Quality & Repair)
--   box false,            text silent            → false     (box)
create or replace function public.af_rule_b(p_box boolean, p_text boolean)
returns boolean language sql immutable parallel safe as $$
  select case when p_text is null then p_box
              when p_box  is null then p_text
              when p_box = p_text then p_box
              when p_text         then true
              else null end
$$;

-- One column's text value, ONLY when it carries its quote (belt and braces over the CHECK above).
create or replace function public.text_fact_bool(p jsonb, p_col text)
returns boolean language sql immutable parallel safe as $$
  select case when coalesce(length(btrim(p -> p_col ->> 'q')), 0) > 0
              then (p -> p_col ->> 'v')::boolean end
$$;

-- What the index writers merge. Empty when the switch is off; never a stale row.
create or replace view public.listing_text_facts_af as
select f.source_table, f.listing_id,
       public.text_fact_bool(f.facts, 'furnished')                  as furnished,
       public.text_fact_bool(f.facts, 'elevator')                   as elevator,
       public.text_fact_bool(f.facts, 'parking')                    as parking,
       public.text_fact_bool(f.facts, 'kitchen')                    as kitchen,
       public.text_fact_bool(f.facts, 'air_conditioner')            as air_conditioner,
       public.text_fact_bool(f.facts, 'maid_room')                  as maid_room,
       public.text_fact_bool(f.facts, 'driver_room')                as driver_room,
       public.text_fact_bool(f.facts, 'private_entrance')           as private_entrance,
       public.text_fact_bool(f.facts, 'separate_electricity_meter') as separate_electricity_meter,
       public.text_fact_bool(f.facts, 'separate_water_meter')       as separate_water_meter,
       public.text_fact_bool(f.facts, 'electricity')                as electricity,
       public.text_fact_bool(f.facts, 'water_supply')               as water_supply,
       public.text_fact_bool(f.facts, 'sanitation')                 as sanitation,
       public.text_fact_bool(f.facts, 'balcony')                    as balcony,
       public.text_fact_bool(f.facts, 'laundry_room')               as laundry_room,
       public.text_fact_bool(f.facts, 'pool')                       as pool,
       public.text_fact_bool(f.facts, 'gym')                        as gym,
       public.text_fact_bool(f.facts, 'garden')                     as garden,
       public.text_fact_bool(f.facts, 'car_entrance')               as car_entrance,
       public.text_fact_bool(f.facts, 'optical_fibers')             as optical_fibers
  from public.listing_text_facts f
 where f.stale_at is null
   and f.facts <> '{}'::jsonb
   and exists (select 1 from public.ops_feature_flags k where k.name = 'af_text_facts_overlay' and k.enabled);
revoke all on table public.listing_text_facts_af from public, anon, authenticated;
comment on view public.listing_text_facts_af is
  'Rule B overlay input: the ad-text value per Advanced Filter column, only with its quote, never from changed text, and empty when ops_feature_flags.af_text_facts_overlay is off.';

-- Stamp stale_at on every row whose source text changed since it was read. One UPDATE per table, only
-- the rows that moved are written. Called first thing in every hourly sync pass (part 2).
create or replace function public.text_facts_mark_stale()
returns bigint language plpgsql as $$
declare t text; n bigint := 0; k bigint;
begin
  for t in select distinct f.source_table from public.listing_text_facts f where f.stale_at is null loop
    continue when to_regclass('public.' || t) is null;
    execute format(
      'update public.listing_text_facts f set stale_at = now() from public.%I x
        where f.source_table = %L and f.listing_id = x.id and f.stale_at is null
          and %s is distinct from f.src_hash', t, t, public.text_facts_hash_expr(t, 'x'));
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  insert into public.mon_mv_refresh_log(object_name, refreshed_at, rows_after, note)
  values ('text_facts_mark_stale', now(), n, format('rows newly stale this pass: %s', n))
  on conflict (object_name) do update
    set refreshed_at = excluded.refreshed_at, rows_after = excluded.rows_after, note = excluded.note;
  return n;
end $$;

-- The nightly job's work list: active ads of one table never read, or read from text that has since changed.
-- Returns the text AND the database's own hash of it, so the job never computes a hash that could disagree.
-- has_history = the ad already has word-checker rows in listing_facts (the job then skips the history copy
-- unless the text changed).
create or replace function public.text_facts_todo(p_table text, p_after bigint, p_limit integer,
                                                  p_shard integer default 0, p_shards integer default 1)
returns table (id bigint, ad_number text, title text, body text, src_hash text, has_history boolean, changed boolean)
language plpgsql stable as $$
declare h text; b text;
begin
  if p_table is null or p_table !~ '^[a-z0-9_]+_listings$' or to_regclass('public.' || p_table) is null
     or p_shards < 1 or p_shard < 0 or p_shard >= p_shards or p_limit not between 1 and 2000 then
    return;
  end if;
  h := public.text_facts_hash_expr(p_table, 'x');
  b := case when p_table like 'wasalt\_%' then 'x.ar_data -> ''propertyInfo'' ->> ''description''' else 'x.description::text' end;
  return query execute format(
    'select x.id::bigint, x.ad_number::text, x.title::text, (%1$s)::text, %2$s,
            exists (select 1 from public.listing_facts l
                     where l.platform = %3$L and l.listing_key = x.ad_number::text and l.model = ''word-checker-v1''),
            f.listing_id is not null
       from public.%4$I x
       left join public.listing_text_facts f on f.source_table = %5$L and f.listing_id = x.id
      where x.active and x.ad_number is not null and x.id > $1 and x.id %% $4 = $3
        and (f.listing_id is null or f.stale_at is not null or f.src_hash is distinct from %2$s)
      order by x.id limit $2',
    b, h, regexp_replace(p_table, '_(residential|commercial)_listings$', ''), p_table, p_table)
  using p_after, p_limit, p_shard, p_shards;
end $$;

revoke all on function public.text_facts_af_columns()                          from public, anon, authenticated;
revoke all on function public.text_facts_all_quoted(jsonb)                      from public, anon, authenticated;
revoke all on function public.text_facts_hash_expr(text, text)                  from public, anon, authenticated;
revoke all on function public.af_rule_b(boolean, boolean)                       from public, anon, authenticated;
revoke all on function public.text_fact_bool(jsonb, text)                       from public, anon, authenticated;
revoke all on function public.text_facts_mark_stale()                          from public, anon, authenticated;
revoke all on function public.text_facts_todo(text, bigint, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.text_facts_af_columns(), public.text_facts_all_quoted(jsonb),
                          public.text_facts_hash_expr(text, text), public.af_rule_b(boolean, boolean),
                          public.text_fact_bool(jsonb, text), public.text_facts_mark_stale(),
                          public.text_facts_todo(text, bigint, integer, integer, integer) to service_role;
grant select, insert, update, delete on table public.listing_text_facts to service_role;
grant select on table public.listing_text_facts_af, public.ops_feature_flags to service_role;

-- Rule B truth table, proven at apply time (a wrong CASE fails this migration, not a customer).
do $$
begin
  if not (public.af_rule_b(null, true) is true and public.af_rule_b(null, false) is false
      and public.af_rule_b(false, true) is true and public.af_rule_b(true, null) is true
      and public.af_rule_b(true, false) is null and public.af_rule_b(false, null) is false
      and public.af_rule_b(true, true) is true and public.af_rule_b(false, false) is false
      and public.af_rule_b(null, null) is null) then
    raise exception 'af_rule_b does not implement Rule B';
  end if;
  if public.text_facts_all_quoted('{"elevator": {"v": true, "q": ""}}')
     or public.text_facts_all_quoted('{"elevator": {"v": "true", "q": "مصعد"}}')
     or public.text_facts_all_quoted('{"majlis": {"v": true, "q": "مجلس"}}')
     or not public.text_facts_all_quoted('{"elevator": {"v": true, "q": "يوجد مصعد"}}')
     or not public.text_facts_all_quoted('{}') then
    raise exception 'text_facts_all_quoted lets an unquoted or unknown value through';
  end if;
end $$;
