do $mig$
declare
  fn text; d text; nd text; pre text; p int; q int; s int; e int; depth int; ch text; blk text;
  new_blk constant text := $n$(s.type_ar in (select k.type_ar from known_type_ar k where k.macro = p_category)
           or (s.type_ar in (select k.type_ar from known_type_ar k where k.macro = 'both')
               and (case p_category
                      when 'Residential' then s.source_table like '%\_residential\_listings'
                      when 'Commercial'  then s.source_table like '%\_commercial\_listings'
                      else true
                    end)))$n$;
begin
  foreach fn in array array['top_cities_by_deal_ar', 'district_options_ar'] loop
    d := pg_get_functiondef(('public.' || fn)::regproc);
    if position('select k.type_ar from known_type_ar' in d) > 0 then continue; end if;
    p := position('known_type_ar' in d);
    if p = 0 or position('known_type_ar' in substr(d, p + 13)) <> 0 then
      raise exception '% : expected exactly one known_type_ar block', fn;
    end if;
    pre := substr(d, 1, p);
    q := position(reverse('exists (') in reverse(pre));
    s := length(pre) - q - 6;
    if substr(d, s, 8) <> 'exists (' then raise exception '% : exists ( not found', fn; end if;
    depth := 0; e := s + 7;
    loop
      ch := substr(d, e, 1);
      if ch = '(' then depth := depth + 1; elsif ch = ')' then depth := depth - 1; end if;
      exit when depth = 0 or e > length(d);
      e := e + 1;
    end loop;
    blk := substr(d, s, e - s + 1);
    if depth <> 0 or position('k.macro = p_category' in blk) = 0 or position('select 1 from known_type_ar k' in blk) = 0 then
      raise exception '% : block not recognised', fn;
    end if;
    nd := substr(d, 1, s - 1) || new_blk || substr(d, e + 1);
    execute nd;
  end loop;
end
$mig$;
