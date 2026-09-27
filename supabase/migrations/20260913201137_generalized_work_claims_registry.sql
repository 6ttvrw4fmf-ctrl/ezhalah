create table if not exists public.ops_work_claims (
  area        text primary key,
  holder      text not null,
  claimed_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  note        text
);

create or replace function public.claim_work_area(p_area text, p_holder text, p_ttl_seconds integer default 1800, p_note text default null)
 returns table(area text, holder text, claimed_at timestamptz, expires_at timestamptz)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
declare v_area text := lower(btrim(p_area));
begin
  return query
    insert into ops_work_claims as c (area, holder, claimed_at, expires_at, note)
    values (v_area, p_holder, now(), now() + make_interval(secs => p_ttl_seconds), p_note)
    on conflict (area) do update
      set holder = excluded.holder, claimed_at = excluded.claimed_at,
          expires_at = excluded.expires_at, note = excluded.note
      where c.expires_at < now() or c.holder = excluded.holder
    returning c.area, c.holder, c.claimed_at, c.expires_at;
end
$function$;

create or replace function public.release_work_area(p_area text, p_holder text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_n int;
begin
  delete from ops_work_claims where area = lower(btrim(p_area)) and holder = p_holder;
  get diagnostics v_n = row_count;
  return v_n > 0;
end
$function$;

create or replace view public.ops_active_claims as
  select area, holder, claimed_at, expires_at, note
  from public.ops_work_claims
  where expires_at > now()
  order by claimed_at;

do $verify$
declare
  r1 record; r2 record; r3 record;
  v_released boolean;
  v_active_count int;
begin
  select * into r1 from claim_work_area('__verify_area__', 'holder_a', 60, 'test');
  if r1.holder is distinct from 'holder_a' then
    raise exception 'claim did not grant to the first holder';
  end if;

  select count(*) into v_active_count from ops_active_claims where area = '__verify_area__';
  if v_active_count <> 1 then
    raise exception 'claimed area does not appear in ops_active_claims';
  end if;

  select * into r2 from claim_work_area('__verify_area__', 'holder_b', 60, 'test');
  if r2.holder is not null then
    raise exception 'a second holder was granted a still-valid claim — collision prevention is broken';
  end if;

  select * into r3 from claim_work_area('__verify_area__', 'holder_a', 90, 'extend');
  if r3.holder is distinct from 'holder_a' or r3.expires_at <= r1.expires_at then
    raise exception 'the original holder could not re-claim/extend its own area';
  end if;

  select release_work_area('__verify_area__', 'holder_b') into v_released;
  if v_released then
    raise exception 'release succeeded for a non-holder — should have been refused';
  end if;

  select release_work_area('__verify_area__', 'holder_a') into v_released;
  if not v_released then
    raise exception 'the real holder could not release its own claim';
  end if;

  select count(*) into v_active_count from ops_active_claims where area = '__verify_area__';
  if v_active_count <> 0 then
    raise exception 'released area still shows as active';
  end if;
end $verify$;
