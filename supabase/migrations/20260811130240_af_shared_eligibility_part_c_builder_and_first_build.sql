-- Part C: the builder — the ONLY sanctioned writer of the four filter surfaces — and the first build.
create or replace function public.rebuild_af_filter_rpcs()
returns table(o_fn_name text, o_def_md5 text)
language plpgsql
as $fn$
declare t record; r record; new_md5 text; n int;
begin
  for t in select * from public.af_rpc_templates order by af_rpc_templates.fn_name loop
    -- drop EVERY overload first: CREATE OR REPLACE with a changed signature silently creates a
    -- second overload — the exact PGRST203 outage shape.
    for r in select p.oid from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
              where n2.nspname = 'public' and p.proname = t.fn_name and p.prokind = 'f'
    loop
      execute format('drop function %s', r.oid::regprocedure);
    end loop;

    execute replace(t.template, '__AF_ELIGIBILITY_WHERE__', public.af_eligibility_clause());
    execute format('grant execute on function public.%I to anon, authenticated, service_role', t.fn_name);

    select count(*) into n from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
     where n2.nspname = 'public' and p.proname = t.fn_name and p.prokind = 'f';
    if n <> 1 then raise exception '% has % overloads after rebuild (must be exactly 1)', t.fn_name, n; end if;

    select md5(pg_get_functiondef(p.oid)) into strict new_md5
      from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
     where n2.nspname = 'public' and p.proname = t.fn_name and p.prokind = 'f';

    insert into public.af_rpc_build_state as bs (fn_name, def_md5, built_at)
    values (t.fn_name, new_md5, now())
    on conflict (fn_name) do update set def_md5 = excluded.def_md5, built_at = now();

    o_fn_name := t.fn_name; o_def_md5 := new_md5; return next;
  end loop;
  notify pgrst, 'reload schema';
end
$fn$;

select * from public.rebuild_af_filter_rpcs();
