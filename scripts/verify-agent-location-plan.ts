import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mergeConversationState, describeKnownState } from '../src/lib/conversationState.ts';
import { liftSymbols } from './lib/liftSymbols.ts';

const source = resolve('supabase/functions/agent/locationPlan.ts');
const { validateLocationPlan } = await import(pathToFileURL(process.env.EZ_LOCATION_PLAN_SOURCE || source).href);
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
const lookup = async (n: string) => catalog[n] ?? { kind: 'none', name: n };
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
], ['queryFromBackend', 'statedKeys'], `
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
    await import('../supabase/functions/agent/index.ts');
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
  } finally { globalThis.fetch = oldFetch; delete (globalThis as any).Deno; }
}

if (!process.env.EZ_LOCATION_PLAN_SOURCE) {
  function mustCatch(name: string, before: string, after: string) {
    const original = readFileSync(source, 'utf8');
    assert.ok(original.includes(before));
    const dir = mkdtempSync(join(tmpdir(), 'location-plan-mutant-'));
    try {
      const file = join(dir, 'locationPlan.ts'); writeFileSync(file, original.replace(before, after));
      const result = spawnSync(process.execPath, ['--experimental-strip-types', import.meta.filename], { env: { ...process.env, EZ_LOCATION_PLAN_SOURCE: file }, encoding: 'utf8', timeout: 20000 });
      assert.equal(result.status, 1, `${name} must fail`);
      assert.match(result.stderr, /AssertionError/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  mustCatch('multiple cities cannot silently choose first', 'cities.length > 1 || (cities.length === 0 && p.districts.length === 0)', '(cities.length === 0 && p.districts.length === 0)');
  mustCatch('district must belong to chosen city', 'String(c.city_id) === String(chosen.city_id)', 'true');
  mustCatch('full catalog beats inventory shortlist', 'd.all_cities ?? d.cities', 'd.cities');
}
console.log('PASS: location plan validates city/district state, preserves empty clears and unrelated filters, and bounds failures; mutation proofs pass.');
