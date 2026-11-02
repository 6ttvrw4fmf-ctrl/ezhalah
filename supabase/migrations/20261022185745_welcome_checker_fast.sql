-- The checker recounted a whole town for two yes/no questions on every fact: "is this town in one region?" and
-- "is it big enough yet?". Riyadh holds ~80,000 ads and ~1,500 facts, so the first nightly run spent 8 minutes
-- there and was stopped. The answers are now computed once per town (a_city) and looked up per fact.
set local statement_timeout = '2min';
do $m$
declare src text; out_def text; a text;
  anchors text[] := array[
    $p$  create index on a_b (city_id, dist);
  analyze a_b;$p$,
    $p$    elsif r.city_id is not null and exists (select 1 from a_b b where b.city_id = r.city_id and b.region_ar <> r.region_ar) then why := 'town_in_two_regions';$p$,
    $p$    elsif gate and r.city_id is not null and (select count(*) from a_b b where b.city_id = r.city_id) < 300 then why := 'small_town_not_yet';$p$,
    $p$  drop table if exists a_b, a_shared, a_steady;$p$];
begin
  src := pg_get_functiondef('public.audit_welcome_insights()'::regprocedure);
  if position('a_city' in src) > 0 then return; end if;
  foreach a in array anchors loop
    if (length(src) - length(replace(src, a, ''))) / length(a) <> 1 then
      raise exception 'checker anchor not found exactly once — refusing to guess: %', left(a, 60);
    end if;
  end loop;
  out_def := replace(src, anchors[1], anchors[1] || $p$
  -- per town, once: how many ads, and in how many regions
  create temp table a_city on commit drop as
    select city_id, count(*) n, count(distinct region_ar) regions, min(region_ar) region_ar from a_b where city_id is not null group by city_id;
  create unique index on a_city (city_id);$p$);
  out_def := replace(out_def, anchors[2], $p$    elsif r.city_id is not null and exists (select 1 from a_city c where c.city_id = r.city_id and (c.regions > 1 or c.region_ar <> r.region_ar)) then why := 'town_in_two_regions';$p$);
  out_def := replace(out_def, anchors[3], $p$    elsif gate and r.city_id is not null and coalesce((select c.n from a_city c where c.city_id = r.city_id), 0) < 300 then why := 'small_town_not_yet';$p$);
  out_def := replace(out_def, anchors[4], $p$  drop table if exists a_b, a_shared, a_steady, a_city;$p$);
  execute out_def;
end $m$;

do $proof$
declare src text := pg_get_functiondef('public.audit_welcome_insights()'::regprocedure);
begin
  if position('from a_city c where c.city_id = r.city_id and (c.regions' in src) = 0 or position('select count(*) from a_b b where b.city_id = r.city_id) < 300' in src) > 0 then
    raise exception 'PROOF: the checker still recounts whole towns per fact';
  end if;
end $proof$;
