create or replace function public.mon_detect_duplicate_google_identity()
returns integer language plpgsql security definer set search_path = 'public' as $$
declare v_rows bigint; n int := 0; sample jsonb;
begin
  select count(*) into v_rows from (
    select identity_data->>'sub' as google_sub
      from auth.identities
     where provider = 'google' and identity_data->>'sub' is not null
     group by 1
    having count(distinct user_id) > 1
  ) dupes;

  if v_rows > 0 then
    select jsonb_agg(jsonb_build_object('google_sub', google_sub, 'user_ids', user_ids, 'emails', emails))
      into sample
      from (
        select identity_data->>'sub' as google_sub,
               array_agg(distinct user_id) as user_ids,
               array_agg(distinct email) as emails
          from auth.identities
         where provider = 'google' and identity_data->>'sub' is not null
         group by 1
        having count(distinct user_id) > 1
         limit 5
      ) s;
    n := public.mon_raise('P1', 'duplicate_google_identity', 'auth', 'duplicate_google_identity',
      jsonb_build_object('rows', v_rows, 'sample', sample,
        'why', 'The same Google account (by its stable sub claim) is attached to more than one '
            || 'Ezhalah user. This means a visitor''s chats/favorites/state can silently split '
            || 'across two accounts depending on which one they land in. Likely cause: the Google '
            || 'One Tap web client ID (GoogleOneTap.tsx) fell out of sync with the OAuth-redirect '
            || 'client ID configured on the Supabase Google provider, or the provider''s accepted-'
            || 'audience list changed. Fix the CONFIG, never merge the two accounts by hand without '
            || 'owner sign-off on which one is canonical.'));
  else
    perform public.mon_resolve_key('duplicate_google_identity', 'duplicate_google_identity');
  end if;
  return n;
end $$;

comment on function public.mon_detect_duplicate_google_identity() is
  'Owner request 2026-08-28 (Google One Tap instant sign-in): a Google sub claim must map to exactly '
  'one Supabase user. Verified clean at creation - 5 identities, 5 distinct users, 0 duplicates.';

do $$
declare src text; newsrc text;
begin
  select prosrc into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if src is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('mon_detect_duplicate_google_identity' in src) > 0 then
    raise notice 'already on the roster - no-op'; return;
  end if;
  if position('''mon_detect_rent_period_source_mismatch''' in src) = 0 then
    raise exception 'anchor mon_detect_rent_period_source_mismatch missing from roster';
  end if;
  newsrc := replace(src,
    '''mon_detect_rent_period_source_mismatch''',
    '''mon_detect_rent_period_source_mismatch'',' || chr(10) ||
    '    ''mon_detect_duplicate_google_identity''');
  execute format(
    'create or replace function public.mon_run_all_detectors() returns jsonb '
    'language plpgsql security definer set search_path = ''public'' as %L', newsrc);
end $$;
