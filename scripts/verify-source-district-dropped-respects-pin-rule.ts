// source_district_dropped MUST NOT COUNT THE OWNER'S PIN RULE AS A DROPPED DISTRICT — 2026-11-03.
// Owner «Title/pin wins»: a pin-corrected city (listing_city_correction.city_source = 'pin_governorate') serves only a
// district on THAT city's official list, else NULL (20261103074143). The alarm counted 1,277 such NULLs as dropped
// source districts (1,460 aqar rows → 36 after the fix). This pins, hermetically, against the committed migration,
// that the exclusion needs BOTH halves — the pin-corrected city AND the word being off its list — so a pin-corrected
// row whose source word IS on the list (a real drop) still counts. Each half is mutation-proven.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sql = readFileSync(join(root, 'supabase/migrations/20261103194837_source_district_dropped_respects_pin_rule.sql'), 'utf8');
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? '  ✓' : '  ✗'} ${name}`); if (!ok) failed++; };

console.log('verify-source-district-dropped-respects-pin-rule: the pin rule is not a dropped district; a real drop still is.');

const pinCity = /and x\.city_source = ''pin_governorate'' and x\.city_id = s\.city_id\) as pin_city/;
const offList = /' and not \(pin_city and not exists \(select 1 from public\.loc_catalog_district kd'\s*\n\s*\|\| ' where kd\.city_id = k\.city_id and kd\.retired_at is null and kd\.district_norm = public\.norm_district_tok\(w\)\)\)'/;
check('pin_city means the SERVED city is the pin-corrected one (same city_id, pin_governorate)', pinCity.test(sql));
check('(mutation) a pin_city that ignores the served city_id is caught', !pinCity.test(sql.replace('and x.city_id = s.city_id) as pin_city', ') as pin_city')));
check("the exclusion needs the source word to be OFF the corrected city's live list", offList.test(sql));
check('(mutation) excluding every pin-corrected row (on-list real drops hidden) is caught', !offList.test(sql.replace("and not (pin_city and not exists", 'and not (pin_city or exists')));
check('(mutation) counting retired catalogue districts as on-list is caught', !offList.test(sql.replace('kd.retired_at is null and ', '')));
check('the live-body patch is anchored and fails closed', /raise exception 'source_district_dropped_rows: anchors not found exactly once'/.test(sql));

if (failed) { console.log(`\n❌ verify-source-district-dropped-respects-pin-rule: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-source-district-dropped-respects-pin-rule: only districts nobody decided count as dropped.');
