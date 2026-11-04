-- «أرض خام» — the everyday wording of «no services» counts too (owner 2026-11-03: «if it says ما فيه خدمات … it goes to
-- raw land — both the type and add it in raw land»). The owner's rule of 2026-10-10 lists «بدون خدمات» / «خالية من
-- الخدمات» / «غير مخدوم»; the spoken forms «ما فيه خدمات», «مافيه خدمات», «ما فيها خدمات», «ما عليها خدمات» (with an
-- optional «اي») say the same and now count. Everything else is unchanged: the land keeps its own source type (the
-- card still shows the site's word) and gains the «أرض خام» tag; any service the source states as TRUE still blocks
-- the tag (the coalesce(...) = false guards stay). Measured 2026-11-03: no active land carries these words today (one
-- haraj yard with electricity does, and stays untagged), so this changes no row now; it covers new listings.
set local lock_timeout = '5s';
do $mig$
declare
  src text; out_def text;
  old_alt constant text := 'بدون خدمات|';
  new_alt constant text := 'بدون خدمات|ما ?(فيه|فيها|في|عليه|عليها) ?(اي |أي )?خدمات|';
begin
  src := pg_get_functiondef('public.sync_raw_land_subtype()'::regprocedure);
  if md5(src) <> 'adea47e2028b14dafb92ab4d1906b641' then
    raise exception 'sync_raw_land_subtype changed since this migration was written — re-read it first';
  end if;
  if (length(src) - length(replace(src, old_alt, ''))) / length(old_alt) <> 1 then
    raise exception 'expected exactly one «بدون خدمات|» alternative in sync_raw_land_subtype';
  end if;
  out_def := replace(src, old_alt, new_alt);
  execute out_def;
end $mig$;

-- PROOF at apply: the new words match, the trap words do not, and a stated service still blocks the tag.
do $$
declare re text;
begin
  re := substring(pg_get_functiondef('public.sync_raw_land_subtype()'::regprocedure) from '~ ''([^'']*بدون خدمات[^'']*)''');
  if re is null then raise exception 'PROOF: the words pattern was not found'; end if;
  if not ('ارض ما فيها خدمات للبيع' ~ re and 'مافيه خدمات' ~ re and 'ما عليها اي خدمات' ~ re and 'بدون خدمات' ~ re) then
    raise exception 'PROOF: an everyday «no services» wording does not match';
  end if;
  if 'جميع الخدمات متوفرة' ~ re or 'قريبة من الخدمات' ~ re then
    raise exception 'PROOF: a «has services» wording matches';
  end if;
  if position('coalesce(r.electricity, false) = false' in pg_get_functiondef('public.sync_raw_land_subtype()'::regprocedure)) = 0 then
    raise exception 'PROOF: the stated-service guard is gone';
  end if;
end $$;
