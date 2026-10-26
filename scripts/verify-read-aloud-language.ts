// Execute the shipped speech engine and script: English must never use Arabic speech or card copy.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import * as voiceLogic from '../src/lib/readAloudVoice.ts';
import { liftSymbols } from './lib/liftSymbols.ts';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const compile = (source: string) => stripTypeScriptTypes(source
  .replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, ''));
const voices = [
  {identifier:'arabic',language:'ar-SA'}, {identifier:'english',language:'en-US'},
];
function engine(source: string, web: boolean, offered = voices) {
  const spoken: any[] = [];
  const native = {getAvailableVoicesAsync: async () => offered, stop(){}, speak(text: string, options: any){spoken.push({text,...options});}};
  const window = {speechSynthesis:{getVoices:()=>offered.map(v=>({...v,voiceURI:v.identifier})),cancel(){},speak(u: any){spoken.push(u);}}};
  const api = new Function('Platform','Speech','window','SpeechSynthesisUtterance','logic','setTimeout','setInterval','clearTimeout','clearInterval',
    `const {pickBestArabicVoice,pickBestEnglishVoice,shouldForcePauseFallback,readAloudRefusalVerdict}=logic;\n${compile(source)}\nreturn {speakReadAloud,stopReadAloud,readAloudRefusal};`)
    ({OS:web?'web':'ios'},native,window,class {text:string;constructor(text:string){this.text=text;}},voiceLogic,()=>0,()=>0,()=>{},()=>{});
  return {api,spoken};
}
async function speechContract(source: string) {
  for (const web of [false,true]) {
    const {api,spoken} = engine(source,web);
    for(let n=0;n<20;n++) await Promise.resolve();
    assert.equal(api.speakReadAloud('en',[{text:'Start a new search below.'}],'en'),true);
    assert.equal(spoken[0].text,'Start a new search below.');
    assert.equal(web?spoken[0].lang:spoken[0].language,'en-US');
    assert.equal(web?spoken[0].voice.voiceURI:spoken[0].voice,'english');
    api.stopReadAloud();
    assert.equal(api.speakReadAloud('ar',[{text:'اكتمل البحث'}],'ar'),true);
    assert.equal(web?spoken[1].lang:spoken[1].language,'ar-SA');
    assert.equal(web?spoken[1].voice.voiceURI:spoken[1].voice,'arabic');
    api.stopReadAloud();
    const missing = engine(source,web,[voices[0]]);
    for(let n=0;n<20;n++) await Promise.resolve();
    assert.equal(missing.api.speakReadAloud('en',[{text:'English'}],'en'),false);
    assert.equal(missing.spoken.length,0);
  }
}
const mustCatch = async (label: string, broken: () => Promise<unknown>) => {
  await assert.rejects(broken, undefined, label);
};
const speech = read('src/lib/readAloud.ts');
await speechContract(speech);
for (const [from,to] of [
  ["locale === 'en' ? bestEnglishVoice : bestArabicVoice",'bestArabicVoice'],
  ["locale === 'en' ? 'en-US' : AR_LANG",'AR_LANG'],
]) {
  assert(speech.includes(from));
  await mustCatch(`wrong speech language or voice: ${from}`,()=>speechContract(speech.replace(from,to)));
}
assert.equal(voiceLogic.pickBestEnglishVoice([voices[0]]),null);
assert.equal(voiceLogic.pickBestEnglishVoice(voices)?.identifier,'english');
const i18n = await liftSymbols('src/i18n.tsx',[
  {header:'const AR:'},{header:'const EN:'},{header:'function fill('},
  {header:'export function translate('},{header:'export function englishCatalogText('},
  {header:'export function tPrice('},
],['translate','englishCatalogText','tPrice'],"type Locale = 'ar'|'en'; const _locale = 'ar';");
const transp = new Function('sa',compile(read('src/lib/translitPlace.ts'))+';return {translitPlace};')(JSON.parse(read('src/data/sa-locations.json')));
const helpers = new Function('i18n','transp',`const {translate,englishCatalogText,tPrice}=i18n; const {translitPlace}=transp; ${compile(read('src/lib/listingDisplay.ts'))}; return {listingTypeEn,listingLocationEn,listingPlatformEn,listingPrice};`)(i18n,transp);
const scriptSource = read('src/lib/readAloudScript.ts');
function script(source: string) {
  return new Function('i18n','helpers',`const {translate}=i18n;const {listingTypeEn,listingLocationEn,listingPlatformEn,listingPrice}=helpers; ${compile(source)};return buildResultsReadAloudSegments;`)(i18n,helpers);
}
const listing = {type:'فيلا',city:'بريدة',district:'الروضة',source:'wasalt',price:'SAR 640,000',beds:8,bathrooms:6,area:300};
function scriptContract(source: string) {
  const segments = script(source)('Search Summary', [listing], 'Start a new search below.', 'en');
  assert.equal(segments[0].text,'Ezhalah');
  assert.equal(segments[1].text,'Search Summary');
  assert.equal(segments.at(-1).text,'Start a new search below.');
  assert(!/[ء-ي]/.test(segments.map((s:any)=>s.text).join(' ')));
  assert.match(segments[2].text,/8 Beds/);
  assert.match(segments[2].text,/Hosted on Wasalt/);
  assert.match(segments[2].text,/640,000/);
  for (const source of ['gathern','Aqar Monthly']) {
    const stay=script(scriptSource)('',[{...listing,source}],undefined,'en');
    assert(!/Tap to see prices by length of stay/.test(stay[1].text)); // owner 2026-10-26: no price line, no note
    assert(!stay[1].text.includes('640,000'));
  }
}
scriptContract(scriptSource);
await mustCatch('Arabic card facts returning in English speech',async ()=>scriptContract(scriptSource.replace('cardSpeech(listing, locale)','cardSpeech(listing)')));
console.log('PASS English/native/web speech language, explicit voice, exact text, translated visible card facts, no stay-length price line, and wrong-language mutations.');
