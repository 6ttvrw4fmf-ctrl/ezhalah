import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mergeConversationState, describeKnownState } from '../src/lib/conversationState.ts';
import { liftSymbols } from './lib/liftSymbols.ts';

const source = resolve('supabase/functions/agent/locationPlan.ts');
const { validateLocationPlan, REGION_NAMES } = await import(pathToFileURL(process.env.EZ_LOCATION_PLAN_SOURCE || source).href);
assert.deepEqual(REGION_NAMES, JSON.parse(readFileSync('src/data/sa-locations.json','utf8')).regions.map((r: any[]) => [r[1],r[2]]));
const city = (city_ar: string, city_id: number, region_ar = 'منطقة الرياض') => ({ city_ar, city_id, region_ar, inv: 0 });
const r = city('الرياض', 3), j = city('جدة', 18, 'منطقة مكة المكرمة');
const catalog: Record<string, any> = {
  'الرياض': { kind: 'region_or_city', cities: [r] },
  'منطقة الرياض': { kind: 'region_or_city', cities: [r] },
  'جدة': { kind: 'city', regions: [j] },
  'المنطقة الشرقية': { kind: 'region', name: 'المنطقة الشرقية' },
  'الملقا': { kind: 'district', cities: [{ ...r, district_ar: 'حي الملقا' }] },
  'الياسمين': { kind: 'twin_district', cities: [{ ...j, district_ar: 'حي الياسمين' }], all_cities: [{ ...j, district_ar: 'حي الياسمين' }, { ...r, district_ar: 'حي الياسمين' }] },
  'حي بجدة': { kind: 'district', cities: [{ ...j, district_ar: 'حي بجدة' }] },
};
const lookup = async (n: string) => catalog[n] ?? catalog[n.replace(/^حي\s+/, '')] ?? { kind: 'none', name: n };
const ready = (cities = ['الرياض'], districts: string[] = [], region = '') => ({ status: 'ready', cities, districts, region });
const run = (p: unknown, f = lookup) => validateLocationPlan(p, f, false, 'أي مدينة تقصد؟');
assert.equal((await run(ready())).status, 'ready'); // zero inventory is still a valid place
assert.equal((await run(ready(['الرياض', 'جدة']))).status, 'blocked');
assert.equal((await run(ready([]))).status, 'blocked');
assert.equal((await run(ready([], ['الملقا']))).location, 'الرياض');
assert.equal((await run(ready([], ['الياسمين']))).status, 'blocked');
assert.equal((await run(ready(['المنطقة الشرقية']))).status, 'blocked');
assert.equal((await run(ready(['منطقة الرياض']))).status, 'blocked');
assert.equal((await run(ready(['دبي']))).status, 'blocked');
assert.equal((await run(ready(['الرياض'], [], 'منطقة مكة المكرمة'))).status, 'blocked');
assert.equal((await run(ready(['الرياض'], ['حي بجدة']))).status, 'blocked');
assert.equal((await run(ready(['الرياض'], ['غير معروف']))).status, 'blocked');
assert.deepEqual((await run(ready(['الرياض'], ['الملقا', 'الياسمين']))).districts, ['حي الملقا', 'حي الياسمين']); // OR-set, including zero-inventory city outside the shortlist
assert.deepEqual((await run(ready(['الرياض'], ['الياسمين']))).districts, ['حي الياسمين']);
assert.deepEqual((await run(ready(['الرياض'], []))).districts, []);
assert.equal((await run({ status: 'clarify' })).status, 'blocked');
assert.equal((await run({ status: 'unsupported' })).status, 'blocked');
assert.equal((await run({ status: 'none' })).status, 'none');
for (const bad of [null, [], {}, { ...ready(), districts: [42] }, { ...ready(), cities: 'الرياض' }, { ...ready(), region: [] }]) assert.equal((await run(bad)).status, 'blocked');
assert.equal((await run(ready(), async () => null)).failed, true);
assert.equal((await run(ready(), async () => { throw Error('network'); })).failed, true);
assert.equal((await validateLocationPlan(ready(), () => new Promise(() => {}), true, '', 5)).failed, true);
const prev: any = { location: 'الرياض', districts: ['حي الملقا', 'حي الياسمين'], regionPin: 'منطقة الرياض', type: 'Apartment', detail: '3', priceInput: '60000' };
const contextual = (p: unknown, text: string, previous: any = prev) => validateLocationPlan(p, lookup, false, '', 20000, {text, previous});
for (const text of ['أبي شقة في الرياض على بعد كيلومتر من برج المملكة', 'أبي شقة في شمال الرياض', 'Apartment north of Riyadh', 'A villa near a school in Riyadh']) {
  assert.equal((await contextual(ready(), text)).status, 'blocked');
}
assert.equal((await contextual(ready(['الرياض'], ['الياسمين']), 'حي الياسمين', {...prev,districts:['حي الملقا']})).status, 'blocked');
assert.equal((await contextual(ready(['الرياض'], ['الياسمين']), 'بدل الملقا خلها في حي الياسمين')).status, 'ready');
const switched = await contextual(ready(['جدة'], ['الملقا']), 'غير المدينة إلى جدة', {...prev,districts:['حي الملقا']});
assert.equal(switched.status, 'ready');
assert.deepEqual(switched.districts, []);
assert.match(switched.notice, /الملقا.*جدة/);
assert.equal((await contextual(ready(['جدة'], ['الملقا']), 'غير المدينة إلى جدة في الملقا', {...prev,districts:['حي الملقا']})).status, 'blocked');
assert.equal((await contextual(ready(), 'Apartment in Riyadh within a budget of one million')).status, 'ready');
assert.equal((await contextual(ready(), 'أبي شقة في الرياض واجهتها شمالية')).status, 'ready');
assert.equal((await contextual(ready(['الرياض'], ['الياسمين']), 'ابدأ بحث جديد في حي الياسمين')).status, 'blocked');
assert.equal((await contextual(ready(['الرياض'], ['الياسمين']), 'ابدأ بحث جديد في الرياض حي الياسمين')).status, 'ready');
assert.equal((await contextual(ready(['الرياض'], ['الملقا']), 'ابدأ بحث جديد')).status, 'blocked');
for (const text of ['أبي شقة في منطقة الرياض كلها', 'منطقة الرياض', 'Apartment in Riyadh region', 'Apartment in the region of Riyadh']) {
  assert.equal((await contextual(ready(), text, null)).status, 'blocked');
}
assert.equal((await contextual(ready(), 'أبي شقة في مدينة الرياض في منطقة الرياض', null)).status, 'ready');
assert.equal((await contextual(ready(['الرياض'], ['الملقا']), 'أبي شقة في حي الملقا بمنطقة الرياض', null)).status, 'ready');
const withHint = (hint: string) => validateLocationPlan(ready(['الرياض'], ['الملقا', 'الياسمين']), lookup, false, '', 20000,
  {text:'أبي شقة في الرياض حي الملقا أو حي الياسمين', landmarkHint:hint});
assert.equal((await withHint('الملقا = Al Malqa Center (Government), Al Malqa | حي الياسمين = Hayy Al Yasmin (Residential), Riyadh')).status, 'ready');
assert.equal((await withHint('برج المملكة = Kingdom Tower (Landmark), Riyadh')).status, 'blocked');
const englishHint = {text:'Apartment in Riyadh Al Malqa', landmarkHint:'malqa = Hayy Al Malqa (Residential), Riyadh', landmarkAliases: async () => ['حي الملقا']};
assert.equal((await validateLocationPlan(ready(['الرياض'], ['الملقا']), lookup, true, '', 20000, englishHint)).status, 'ready');
assert.equal((await validateLocationPlan(ready(['جدة']), lookup, true, '', 20000, englishHint)).status, 'blocked');
assert.equal((await validateLocationPlan(ready(), lookup, true, '', 20000, {...englishHint,landmarkAliases:async()=>null})).failed, true);
const { readLandmarkAliases } = await import('../supabase/functions/agent/landmarkAliases.ts');
assert.deepEqual(await readLandmarkAliases('https://fixture.invalid','fixture','Hayy Al Malqa', async () => Response.json([{aliases:['Al Malqa','حي الملقا']}]) as any), ['حي الملقا']);
assert.equal(await readLandmarkAliases('https://fixture.invalid','fixture','missing', async () => new Response('',{status:500}) as any), null);
const districtHints = 'حي الملقا = Hayy Al Malqa (Residential), Riyadh | حي الياسمين = Hayy Al Yasmin (Residential), Riyadh';
for (const text of ['احذف حي الملقا وخلي حي الياسمين فقط', 'بدل حي الملقا خلها حي الياسمين']) {
  const result = await validateLocationPlan(ready(['الرياض'], ['الياسمين']), lookup, false, '', 20000,
    {text,previous:prev,landmarkHint:districtHints});
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.districts, ['حي الياسمين']);
}
assert.equal((await validateLocationPlan(ready(['الرياض'], ['الياسمين']), lookup, false, '', 20000,
  {text:'احذف حي الملقا وخلي حي الياسمين',previous:{...prev,districts:[]},landmarkHint:districtHints})).status, 'blocked');
assert.equal((await validateLocationPlan(ready(['الرياض'], ['الياسمين']), lookup, false, '', 20000,
  {text:'حي الملقا وحي الياسمين',landmarkHint:districtHints})).status, 'blocked');
assert.equal((await validateLocationPlan(ready(['الرياض'], ['الياسمين']), lookup, true, '', 20000,
  {text:'Yasmin and Malqa',previous:prev,landmarkHint:districtHints})).status, 'blocked');
assert.equal((await validateLocationPlan(ready(['جدة']), lookup, false, '', 20000,
  {text:'غير الرياض إلى جدة',previous:prev,landmarkHint:'الرياض = Riyadh (City), Riyadh'})).status, 'ready');
for (const status of ['ready','none','clarify','unsupported']) {
  const result = await validateLocationPlan({...ready(['جدة']),status}, lookup, false, 'أبحث لك في منطقة الرياض كلها 🏙️', 20000,
    {text:'أبي شقة في منطقة الرياض كلها',previous:{...prev,location:'جدة',districts:[]}});
  assert.equal(result.status,'blocked');
  assert.match(result.reply,/(?:أي منطقة|النطاق كامل).*؟/);
}
assert.match((await validateLocationPlan({status:'clarify'},lookup,false,'أبحث لك في المنطقة')).reply, /؟/);
assert.equal((await contextual(ready(['جدة'],[],'منطقة مكة المكرمة'),'أبي شقة في جدة بمنطقة مكة',null)).status,'ready');
assert.equal((await contextual(ready(), 'أبي شقة في منطقة هادئة بالرياض', null)).status,'ready');
const next: any = { location: 'الرياض', districts: [], regionPin: 'منطقة الرياض', districtPin: undefined };
const merged = mergeConversationState(prev, next, ['location', 'districts', 'districtPin', 'regionPin']);
assert.deepEqual(merged.districts, []);
assert.equal(merged.priceInput, '60000');
assert.equal(merged.detail, '3');
assert.deepEqual(mergeConversationState(prev, { location: 'الرياض' } as any).districts, prev.districts);
assert.ok(describeKnownState(prev).includes('حي الملقا/حي الياسمين'));

// Execute the actual client adapter with unrelated parsing dependencies stubbed. Local extraction
// deliberately proposes an unwanted district: only the edge's validated full state may survive.
const client = await liftSymbols(resolve('src/data/agent.ts'), [
  { header: 'export function queryFromBackend' }, { header: 'export function statedKeys' },
  { header: 'async function callAgentBackend', endsWith: /^\}$/ },
], ['queryFromBackend', 'statedKeys', 'callAgentBackend', 'setResponse'], `
import { mergeConversationState, describeKnownState } from ${JSON.stringify(pathToFileURL(resolve('src/lib/conversationState.ts')).href)};
let fixtureResponse;
function setResponse(value) { fixtureResponse = value; }
const supabase = { functions: { invoke: async () => ({data: fixtureResponse, error: null}) } };
const ensureLandmarks = async () => {}, landmarkHint = () => '', getLocale = () => 'ar';
const certifyAfOnMergedState = q => q;
const setTimeout = (fn, ms) => globalThis.setTimeout(fn, ms).unref();
const emptyQuery = () => ({});
const typeFromAgent = () => null;
const RAW_LAND_PHRASE = /a^/, BARE_LAND_WORD = /a^/, LAND_QUALIFIER = /a^/, ROAD_PREFIX_RE = /a^/;
const parseAreaConstraint = () => ({}), bigWanted = () => false, parsePriceBounds = () => ({});
const resolveDistrictsFromText = () => ['unvalidated local district'];
const applySourceFilter = () => {}, parseProximity = () => [], extractNearbyKeywords = () => [], proximityKeywords = () => [];
const vagueOrdering = () => null;
let lastRejectedFilters = [], lastVagueIntents = [];
`);
for (const districts of [[], ['حي الياسمين'], ['حي الملقا', 'حي الياسمين']]) {
  const b = { locationStateValidated: true, location: 'الرياض', regionPin: 'منطقة الرياض', districts };
  const parsed = (client.queryFromBackend as Function)(b, 'حي الملقا');
  const combined = mergeConversationState(prev, parsed, (client.statedKeys as Function)(b));
  assert.deepEqual(combined.districts, districts);
  assert.equal(combined.regionPin, 'منطقة الرياض');
  assert.equal(combined.priceInput, '60000');
}
(client.setResponse as Function)({kind:'listings',reply:'',notice:'Removed an incompatible district',query:{locationStateValidated:true,location:'جدة',regionPin:'منطقة مكة المكرمة',districts:[]}});
const noticeTurn = await (client.callAgentBackend as Function)('غير المدينة إلى جدة',{loggedIn:false,order:false,prevQuery:prev});
assert.equal(noticeTurn.notice, 'Removed an incompatible district');
assert.deepEqual(noticeTurn.query.districts, []);

if (!process.env.EZ_LOCATION_PLAN_SOURCE) {
  // Boot the real edge entrypoint, with every network boundary replaced. No paid model or DB call.
  let handler: (r: Request) => Promise<Response>;
  let model: any;
  const oldFetch = globalThis.fetch;
  (globalThis as any).Deno = { env: { get: (key: string) => ({ SUPABASE_URL: 'https://fixture.invalid', SUPABASE_ANON_KEY: 'fixture', SUPABASE_SERVICE_ROLE_KEY: 'fixture', DEEPSEEK_API_KEY: 'fixture' } as Record<string, string>)[key] }, serve: (f: any) => { handler = f; } };
  globalThis.fetch = async (url: any, options: any) => {
    const u = String(url), body = options?.body ? JSON.parse(options.body) : {};
    if (u.includes('/agent_notes?')) return Response.json([{ title: 'Chapter 1', content: 'EZHALAH LOCATION INTERPRETATION — CHAPTER 1' }]);
    if (u.endsWith('/ai_spend_gate')) return Response.json({ allow: true });
    if (u.endsWith('/loc_classify')) return Response.json(await lookup(body.p_token));
    if (u.endsWith('/agent_health_event') || u.endsWith('/ai_usage')) return Response.json({});
    if (u === 'https://api.deepseek.com/chat/completions') {
      assert.match(body.messages[0].content, /CHAPTER 1 OUTPUT EXTENSION/);
      return Response.json({ choices: [{ message: { content: JSON.stringify(model) }, finish_reason: 'stop' }] });
    }
    throw Error(`Unexpected network request: ${u}`);
  };
  try {
    await import(pathToFileURL(process.env.EZ_LOCATION_AGENT_SOURCE || resolve('supabase/functions/agent/index.ts')).href);
    for (const askCount of [0, 1, 5]) {
      model = { kind: 'listings', reply: 'بدور لك على شقق في الرياض 🏡', location: 'الرياض', type: 'Apartment', location_plan: ready(['الرياض', 'جدة']) };
      const res = await handler!(new Request('https://fixture.invalid/agent', { method: 'POST', headers: { apikey: 'fixture' }, body: JSON.stringify({ text: 'أبي شقة في الرياض وجدة', askCount, prevQuery: prev }) }));
      const result = await res.json();
      assert.equal(result.kind, 'message', JSON.stringify(result));
      assert.deepEqual(result.query.districts, prev.districts);
    }
    model = { kind: 'listings', reply: 'بدور لك في الرياض كلها 🏡', location: 'الرياض', type: 'Apartment', location_plan: ready() };
    const res = await handler!(new Request('https://fixture.invalid/agent', { method: 'POST', headers: { apikey: 'fixture' }, body: JSON.stringify({ text: 'احذف كل الأحياء وخلي الرياض كلها', prevQuery: prev }) }));
    const result = await res.json();
    assert.equal(result.kind, 'listings', JSON.stringify(result));
    assert.equal(result.query.locationStateValidated, true);
    assert.deepEqual(result.query.districts, []);
    for (const [text, location_plan] of [
      ['أبي شقة في الرياض على بعد كيلومتر من برج المملكة',ready()],
      ['أبي شقة في شمال الرياض',ready()],
      ['أبي شقة في منطقة الرياض كلها',ready()],
      ['أبي شقة في منطقة الرياض كلها',ready(['جدة'])],
      ['حي الياسمين',ready(['الرياض'],['الياسمين'])],
    ]) {
      model={kind:'listings',reply:'أبحث لك 🏡',location:'الرياض',type:'Apartment',location_plan};
      const r=await handler!(new Request('https://fixture.invalid/agent',{method:'POST',headers:{apikey:'fixture'},body:JSON.stringify({text,prevQuery:{...prev,districts:['حي الملقا']}})}));
      assert.equal((await r.json()).kind,'message');
    }
    model={kind:'listings',reply:'أبحث لك في جدة 🏡',location:'جدة',type:'Apartment',location_plan:ready(['جدة'],['الملقا'])};
    const cityResponse=await handler!(new Request('https://fixture.invalid/agent',{method:'POST',headers:{apikey:'fixture'},body:JSON.stringify({text:'غير المدينة إلى جدة',prevQuery:{...prev,districts:['حي الملقا']}})}));
    const cityResult=await cityResponse.json();
    assert.equal(cityResult.kind,'listings');
    assert.deepEqual(cityResult.query.districts,[]);
    assert.match(cityResult.notice,/الملقا.*جدة/);
    model={kind:'listings',reply:'أبحث لك 🏡',location:'الرياض',type:'Apartment',location_plan:ready(['الرياض'],['الياسمين'])};
    const removeResponse=await handler!(new Request('https://fixture.invalid/agent',{method:'POST',headers:{apikey:'fixture'},body:JSON.stringify({text:'احذف حي الملقا وخلي حي الياسمين فقط',prevQuery:prev,landmarkHint:districtHints})}));
    const removeResult=await removeResponse.json();
    assert.equal(removeResult.kind,'listings');
    assert.deepEqual(removeResult.query.districts,['حي الياسمين']);
    for (const askCount of [1,5]) {
      model={kind:'listings',reply:'أبحث لك 🏡',location:'الرياض',type:'Apartment',location_plan:ready()};
      const specificResponse=await handler!(new Request('https://fixture.invalid/agent',{method:'POST',headers:{apikey:'fixture'},body:JSON.stringify({text:'أبي شقة قريبة من برج المملكة في الرياض',prevQuery:prev,askCount})}));
      const specific=await specificResponse.json();
      assert.equal(specific.kind,'message');
      assert.match(specific.reply,/غير متاح/);
    }
    model={kind:'message',reply:'أي مدينة؟ 📍',location_plan:{status:'none'}};
    const resetResponse=await handler!(new Request('https://fixture.invalid/agent',{method:'POST',headers:{apikey:'fixture'},body:JSON.stringify({text:'ابدأ بحث جديد',prevQuery:prev})}));
    const resetResult=await resetResponse.json();
    assert.equal(resetResult.kind,'message');
    assert.equal(resetResult.query.location,'');
    assert.deepEqual(resetResult.query.districts,[]);
    for (const [text, scope, region, amount, budget] of [
      ['أبي ٢٠٠ فيلا للبيع في كل السعودية','NATIONWIDE','',200,''],
      ['Show 100 villas for sale across Saudi Arabia','NATIONWIDE','',100,''],
      ['أبي ٥٠ شقة للبيع في المنطقة الشرقية من عقار فقط','REGION','المنطقة الشرقية',50,''],
      ['أبي ١٠٠ شقة للإيجار السنوي بالمنطقة الشرقية بحد أقصى ٥٠٠٠٠ ريال بالسنة','REGION','المنطقة الشرقية',100,'50000'],
    ] as const) {
      model={kind:'listings',reply:'أبحث لك 🏡',location:region || 'السعودية',type:'Apartment',platforms:text.includes('عقار')?['Aqar']:[],count:String(amount),price:String(amount),deal:'Buy',pricing_basis:'none',location_plan:{status:'clarify',cities:[],districts:[],region:region === 'المنطقة الشرقية' ? 'الشرقية' : region,scope}};
      const response=await handler!(new Request('https://fixture.invalid/agent',{method:'POST',headers:{apikey:'fixture'},body:JSON.stringify({text,prevQuery:prev})}));
      const actual=await response.json();
      assert.equal(actual.kind,'listings',JSON.stringify(actual));
      assert.equal(actual.query.geographicScope,scope);
      assert.equal(actual.query.price,budget);
      assert.equal(actual.query.count,amount);
    }
    for (const sourceSelectionChanged of [false,true]) {
      model={kind:'listings',reply:"I'll search apartments in Riyadh across the platforms we have 🏡",location:'الرياض',type:'Apartment',platforms:[],excludedPlatforms:[],sourceSelectionChanged,location_plan:ready()};
      const unsupportedResponse=await handler!(new Request('https://fixture.invalid/agent',{method:'POST',headers:{apikey:'fixture'},body:JSON.stringify({text:'Show apartments for sale in Riyadh from Zillow only',prevQuery:prev})}));
      const unsupportedResult=await unsupportedResponse.json();
      assert.equal(unsupportedResult.kind,'message');
      assert.equal(unsupportedResult.keepState,true);
    }
    model={kind:'listings',reply:'Searching all supported websites 🏡',location:'الرياض',type:'Apartment',platforms:[],excludedPlatforms:[],sourceSelectionChanged:true,location_plan:ready()};
    const allSourceResponse=await handler!(new Request('https://fixture.invalid/agent',{method:'POST',headers:{apikey:'fixture'},body:JSON.stringify({text:'Show apartments for sale in Riyadh from all supported websites',prevQuery:prev})}));
    assert.equal((await allSourceResponse.json()).kind,'listings');
  } finally { globalThis.fetch = oldFetch; delete (globalThis as any).Deno; }
}

if (!process.env.EZ_LOCATION_PLAN_SOURCE && !process.env.EZ_LOCATION_AGENT_SOURCE) {
  function mustCatch(name: string, before: string, after: string) {
    const original = readFileSync(source, 'utf8');
    assert.ok(original.includes(before));
    const dir = mkdtempSync(join(tmpdir(), 'location-plan-mutant-'));
    try {
      cpSync(resolve('supabase/functions/agent'), dir, { recursive: true });
      const file = join(dir, 'locationPlan.ts'); writeFileSync(file, original.replace(before, after));
      const result = spawnSync(process.execPath, ['--experimental-strip-types', import.meta.filename], { env: { ...process.env, EZ_LOCATION_PLAN_SOURCE: file }, encoding: 'utf8', timeout: 20000 });
      assert.equal(result.status, 1, `${name} must fail`);
      assert.match(result.stderr, /AssertionError/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  for (const [before, after] of [['chapterLocationReply = plan.reply;', 'chapterLocationReply = null;'], ['droppedWebsiteRestriction || unsupportedSourceReply', 'false || unsupportedSourceReply']]) {
  const edgeDir = mkdtempSync(join(tmpdir(),'location-reply-mutant-'));
  try {
    cpSync(resolve('supabase/functions/agent'),edgeDir,{recursive:true});
    const file=join(edgeDir,'index.ts');
    writeFileSync(file,readFileSync(file,'utf8').replace(before, after));
    const result=spawnSync(process.execPath,['--experimental-strip-types',import.meta.filename],{env:{...process.env,EZ_LOCATION_AGENT_SOURCE:file},encoding:'utf8',timeout:20000});
    assert.equal(result.status,1,`edge mutation must fail: ${before}`);
    assert.match(result.stderr,/AssertionError/);
  } finally { rmSync(edgeDir,{recursive:true,force:true}); }
  }
  mustCatch('multiple cities cannot silently choose first', 'cities.length > 1 || (cities.length === 0 && p.districts.length === 0)', '(cities.length === 0 && p.districts.length === 0)');
  mustCatch('district must belong to chosen city', 'String(c.city_id) === String(chosen.city_id)', 'true');
  mustCatch('full catalog beats inventory shortlist', 'd.all_cities ?? d.cities', 'd.cities');
  mustCatch('unsupported geographic requests cannot become citywide searches', 'return proximity || namedRoad || directional;', 'return false;');
  mustCatch('region cannot silently become its namesake city', 'return !namedCity && !namedDistrict;', 'return false;');
  mustCatch('unmapped landmark cannot silently disappear', 'if (!authorized)', 'if (false)');
  mustCatch('removed districts remain valid historical references', 'isChosenCity || isChosenDistrict || isRemovedDistrict', 'isChosenCity || isChosenDistrict');
  mustCatch('bare district cannot silently replace a selection', 'previousDistricts.length && addsUnstatedDistrict', 'false && addsUnstatedDistrict');
  mustCatch('explicit city switch revalidates and removes incompatible old districts', '!matches.length && explicitCityChange && previousDistricts.some', '!matches.length && false && previousDistricts.some');
}
console.log('PASS: location plan validates city/district state, preserves empty clears and unrelated filters, and bounds failures; mutation proofs pass.');
