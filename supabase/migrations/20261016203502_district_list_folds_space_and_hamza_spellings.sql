-- 🦅 Falcon, 2026-10-16. ONE DISTRICT, ONE OPTION: the district list folds spellings that differ only by a
-- space, a hamza form, ى/ي or ة/ه (power-plan class «a district split by spelling»).
--
-- THE DEFECT. district_options_ar() groups the catalog into options by `fold`, and the app sends every
-- spelling in a group (match_values) to the search, so a group IS one district to the customer. The fold
-- only dropped a trailing hamza, so ten real districts were offered twice, each half counting and
-- returning only its own spelling. Measured today: الرياض «حي الملك عبدالعزيز» 158 + «حي الملك عبد
-- العزيز» 14 (a customer picking the first missed 14 ads), الخبر «حي الخبر الشمالية» 221 + «الخبرالشمالية»
-- 90, المدينة «حي ابو كبير» 75 + «أبوكبير» 64, and seven more pairs.
--
-- THE FIX. The fold also removes spaces and maps أإآٱ→ا, ى→ي, ة→ه. Read-side only: no listing, district
-- or catalog row changes; district_norm (what every search matches on) is untouched.
--
-- PROVEN BEFORE APPLY (rolled-back dry run on production, cities 3 6 14 18 31 62 3677 + control 13):
-- options 1,217 → 1,207, exactly the ten pairs merge with summed counts, every other option identical.
-- The merged option's match_values return the union: الرياض both spellings 172 = 158 + 14.
-- A catalog-wide scan found exactly these ten merges and no other (no false merge).
--
-- district_options_ar is rendered from af_rpc_templates by rebuild_af_filter_rpcs(); the same needle is
-- applied to the template and to the live body so the two stay identical, without running the rebuild.
do $mig$
declare
  old_fold constant text := $n$regexp_replace(c.district_norm, 'ء$', '') AS fold$n$;
  new_fold constant text := $n$regexp_replace(regexp_replace(translate(c.district_norm, 'أإآٱىة', 'اااايه'), '\s+', '', 'g'), 'ء$', '') AS fold$n$;
  def text; tpl text; occ int;
begin
  def := pg_get_functiondef('public.district_options_ar'::regproc);
  occ := (length(def) - length(replace(def, old_fold, ''))) / length(old_fold);
  if occ <> 1 then raise exception 'district_options_ar: fold needle found % times in the live body, expected 1', occ; end if;
  select template into tpl from public.af_rpc_templates where fn_name = 'district_options_ar';
  occ := (length(tpl) - length(replace(tpl, old_fold, ''))) / length(old_fold);
  if occ <> 1 then raise exception 'district_options_ar: fold needle found % times in the template, expected 1', occ; end if;
  execute replace(def, old_fold, new_fold);
  update public.af_rpc_templates set template = replace(tpl, old_fold, new_fold) where fn_name = 'district_options_ar';
end
$mig$;
