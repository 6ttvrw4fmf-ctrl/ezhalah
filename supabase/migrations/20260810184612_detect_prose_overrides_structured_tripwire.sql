-- Tripwire: prose must never overwrite a structured value.
--
-- The aqar P0 was a single inverted coalesce that survived because nothing watched
-- for it. This asserts the shape against the LIVE function body, so a future edit
-- that puts the prose parse back on the left-hand side fails the build.
--
-- Hunted: `NEW.<col> := coalesce(<prose parse>, NEW.<col>)` - prose first means prose
-- wins. Safe form is `coalesce(NEW.<col>, <prose parse>)`, where prose only fills a
-- gap. Also catches a bare unconditional `NEW.<col> := safe_*(p->>...)`.
create or replace function public.detect_prose_overrides_structured()
returns table(fn text, offending text)
language plpgsql stable as $$
declare r record; body text; m text[];
begin
  for r in
    select p.oid as oid, p.proname::text as nm
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'trg\_%\_parse'
  loop
    body := pg_get_functiondef(r.oid);
    for m in select regexp_matches(body,
        '(NEW\.[a-z_]+\s*:=\s*coalesce\(\s*public\.safe_[a-z]+\(p->>[^)]*\)\s*,\s*NEW\.[a-z_]+\s*\);)', 'g') loop
      fn := r.nm; offending := m[1]; return next;
    end loop;
    for m in select regexp_matches(body,
        '(NEW\.(furnished|floor_number|street_width_m|direction|property_age)\s*:=\s*public\.safe_[a-z]+\(p->>[^;]*;)', 'g') loop
      fn := r.nm; offending := m[1]; return next;
    end loop;
  end loop;
end $$;

comment on function public.detect_prose_overrides_structured() is
  'Safety Barrier tripwire. Returns any *_parse trigger where prose overwrites a structured attribute. MUST stay empty - structured source beats prose.';

alter table public.mon_safety_barrier_state
  add column if not exists prose_overrides integer not null default 0;
