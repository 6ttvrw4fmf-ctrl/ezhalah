import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { buildAgentSourceCatalog } from './build-agent-source-catalog.mjs';
import assert from 'node:assert/strict';
import { liftSymbols } from './lib/liftSymbols.ts';
import { resolve } from 'node:path';
import { selectSourceTables } from '../src/lib/agentSourceSelection.ts';
import { agentResultRequest, resultQuantityChange } from '../src/lib/agentResultRequest.ts';
import { initialReveal } from '../src/lib/initialReveal.ts';
import { validateLocationPlan } from '../supabase/functions/agent/locationPlan.ts';
import { mergeConversationState } from '../src/lib/conversationState.ts';
const tables=['aqar_residential_listings','wasalt_commercial_listings','gathern_residential_listings'];
function assertSources(select: typeof selectSourceTables) {
assert.deepEqual(select(tables,undefined,['aqar']),tables.slice(1));
assert.deepEqual(select(tables,['aqar','wasalt'],['aqar']),[tables[1]]);
assert.deepEqual(select(tables,['aqar'],['aqar']),[]);
assert.deepEqual(select(tables,[],[]),tables);
}
assertSources(selectSourceTables);
for(const n of [1,10,25,50,100,200,500]) assert.equal(initialReveal({fetched:600,honestTotal:600,stopAt:25,platforms:3,requestedCount:n}),n);
assert.equal(initialReveal({fetched:7,honestTotal:7,stopAt:25,requestedCount:3}),3);
assert.equal(agentResultRequest('ورني ٥٠ زيادة',50,50),100);
assert.equal(agentResultRequest('another 20',100,50),120);
assert.equal(agentResultRequest('الصفحة الثالثة',50,50),150);
assert.equal(agentResultRequest('خلها ١٠٠',20,20,true),100);
assert.equal(agentResultRequest('ابي ٣ غرف',20,20),null);
assert.equal(agentResultRequest('show 50 in Jeddah',20,20),null);
const ready={status:'ready',cities:[],districts:[],region:'المنطقة الشرقية',scope:'REGION'};
const run=(plan:any,text:string,previous:any=null)=>validateLocationPlan(plan,async()=>{throw Error('Unexpected city lookup');},true,'',20000,{text,previous});
const east=await run(ready,'أبي فيلا بالمنطقة الشرقية');
assert.equal(east.status,'ready');
if(east.status==='ready'){assert.equal(east.scope,'REGION');assert.equal(east.regionPin,'المنطقة الشرقية');assert.deepEqual(east.districts,[]);}
assert.equal((await run({...ready,region:'منطقة الرياض'},'أبي فيلا بالمنطقة الشرقية')).status,'blocked');
assert.equal((await run(ready,'three bedrooms')).status,'blocked');
assert.equal((await run(ready,'خلها في كل المنطقة',{regionPin:'المنطقة الشرقية'})).status,'ready');
assert.equal((await run(ready,'three bedrooms',{geographicScope:'REGION',regionPin:'المنطقة الشرقية'})).status,'ready');
assert.equal((await run({...ready,scope:'NATIONWIDE',region:''},'Across Saudi Arabia')).status,'ready');
assert.equal((await run({...ready,scope:'NATIONWIDE',region:''},'Riyadh')).status,'blocked');
assert.equal((await run({...ready,districts:['الملقا']},'أبي فيلا بالمنطقة الشرقية')).status,'blocked');
const state=mergeConversationState({sources:['aqar'],excludedSources:['wasalt']} as any,{sources:[],excludedSources:[]} as any,['sources','excludedSources']);
assert.deepEqual(state.sources,[]);assert.deepEqual(state.excludedSources,[]);
console.log('PASS: explicit scope, source inclusion/exclusion, quantity and continuation controls');

const remote = await liftSymbols(resolve('src/data/remote.ts'), [
  {header:'export async function resolveSearchScope(', endsWith:/^\}$/},
], ['resolveSearchScope'], `
type SearchQuery=any; type SearchScope=any; type ProbeFailed=any;
const PROBE_FAILED={failed:true};
const searchTableScope=()=>({p_tables:['aqar_residential_listings']});
const arCity=(x:any)=>x; const cityFilterFor=(x:any)=>x;
const isCountryWideQuery=(q:any)=>q.geographicScope==='NATIONWIDE';
const rentPeriodParam=()=>null; const impliedCategory=()=>null;
const REGION_TO_ID={'المنطقة الشرقية':5}; const regionIdsFor=()=>null;
`);
const regional:any=await remote.resolveSearchScope({geographicScope:'REGION',regionPin:'المنطقة الشرقية',location:'المنطقة الشرقية'});
assert.equal(regional.p_cities,null);assert.deepEqual(regional.p_region_ids,[5]);
const national:any=await remote.resolveSearchScope({geographicScope:'NATIONWIDE',regionPin:'المنطقة الشرقية',location:'السعودية'});
assert.equal(national.p_cities,null);assert.equal(national.p_region_ids,null);
assert.deepEqual(await remote.resolveSearchScope({geographicScope:'REGION',location:'المنطقة الشرقية'}),{failed:true});
console.log('PASS: actual RPC scope serialization preserves region and nationwide intent');

const sourceCatalog=JSON.parse(readFileSync('supabase/functions/agent/searchSources.json','utf8'));
assert.deepEqual(sourceCatalog,buildAgentSourceCatalog());
assert.deepEqual(sourceCatalog.Aqar,['aqar','aqarmonthly']);
assert.deepEqual(sourceCatalog['عقار'],sourceCatalog.Aqar);
assert.deepEqual(sourceCatalog['Aqar Gate'],sourceCatalog.Aqargate);

assert.equal((await run({...ready,cities:['الرياض']},'في الرياض',{geographicScope:'REGION',regionPin:'المنطقة الشرقية'})).status,'blocked');

assert.equal(agentResultRequest('خلها ١٠٠',20,20),null);

assert.equal(resultQuantityChange('خلها ١٠٠',true),100);
assert.equal(resultQuantityChange('another 50',true),null);

// Execute the real selector with its exclusion removed; the same contract must reject it.
async function mustCatch(name: string, before: string, after: string) {
  const original = readFileSync('src/lib/agentSourceSelection.ts','utf8');
  assert.ok(original.includes(before), 'mutation must apply');
  const directory = mkdtempSync(resolve(tmpdir(),'ezhalah-source-mutation-'));
  const file = resolve(directory,'selector.ts');
  try {
    writeFileSync(file,original.replace(before,after));
    const mutant = await import(pathToFileURL(file).href);
    assert.throws(() => assertSources(mutant.selectSourceTables));
    console.log('PASS: mutation caught — '+name);
  } finally { rmSync(directory,{recursive:true,force:true}); }
}
await mustCatch('excluded websites cannot leak into matches','&& !excluded?.includes(source)','&& true');

assert.equal((await run({...ready,region:'الشرقية'},'أبي ١٠٠ شقة للإيجار السنوي بالمنطقة الشرقية بحد أقصى ٥٠٠٠٠ ريال')).status,'ready');
assert.equal((await run(ready,'أبي شقة في المنطقة الشرقية أو منطقة الرياض')).status,'blocked');
