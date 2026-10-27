// Execute the real reply and history paths with independently chosen UI/message languages.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { spawnSync } from 'node:child_process';
import { liftSymbols } from './lib/liftSymbols.ts';
import { autoTitleForPrompt } from '../src/lib/chatTitle.ts';

const root = resolve(import.meta.dirname, '..');
const lang = await liftSymbols(process.env.EZ_LANGUAGE_I18N_SOURCE ?? join(root, 'src/i18n.tsx'), [
  { header: 'const _arScript =', endsWith: /;$/ },
  { header: 'const _latinScript =', endsWith: /;$/ },
  { header: 'export function detectLocale(' },
  { header: 'export function resolveReplyLocale(' },
], ['detectLocale', 'resolveReplyLocale', '_arScript', '_latinScript']);
const detectLocale = lang.detectLocale as (text: string) => 'ar' | 'en' | null;
const agentPath = process.env.EZ_LANGUAGE_AGENT_SOURCE ?? join(root, 'src/data/agent.ts');
const storePath = process.env.EZ_LANGUAGE_STORE_SOURCE ?? join(root, 'src/store.tsx');
const agent = await liftSymbols(agentPath, [
  ...['INTERVIEW_RE', 'ADVICE_RE', 'DISTRESS_RE', 'ORDER_RE', 'AR_ORDER', 'REALESTATE_RE', 'GREETING_RE', 'THANKS_RE', 'SMALLTALK_RE'].map(name => ({ header: `const ${name} =`, endsWith: /;$/ })),
  { header: 'async function callAgentBackend(', endsWith: /^\}$/ },
  { header: 'export async function respond(', endsWith: /^\}$/ },
], ['respond', 'setUI', 'setOffline', 'requests', 'getLocale'], `
type Locale = 'ar' | 'en'; type AgentTurn = any; type AgentHistoryTurn = any; type SearchQuery = any;
const _arScript = ${lang._arScript}; const _latinScript = ${lang._latinScript};
const detectLocale = ${detectLocale.toString()};
const resolveReplyLocale = ${(lang.resolveReplyLocale as Function).toString()};
let ui: Locale = 'ar'; const getLocale = () => ui; const setUI = (v: Locale) => { ui = v; };
const translate = (locale: Locale, key: string) => locale + ':' + key;
let offline = false; const setOffline = (v: boolean) => { offline = v; }; const requests: any[] = [];
const supabase = { functions: { invoke: async (_name: string, options: any) => {
  requests.push(options.body); return offline ? { data: null, error: new Error('offline') }
    : { data: { kind: 'message', reply: options.body.locale + ':reply' }, error: null };
} } };
const describeKnownState = () => ''; const ensureLandmarks = async () => {}; const landmarkHint = () => undefined;
const setTimeout = () => 0; // no dangling timeout after the resolved injected request
const resetRejectionNotices = () => {}; const spellFix = (text: string) => ({text});
const AR_REALESTATE = /عقار/; const maybeForcePlatformSearch = (turn: any) => turn;
const rejectionNotice = () => ''; const alreadyRestates = () => true;
`);
const respond = agent.respond as (text: string, opts?: any) => Promise<any>;
for (const ui of ['ar', 'en']) {
  (agent.setUI as Function)(ui);
  for (const [text, expected] of [['hello', 'en'], ['هلا', 'ar'], ['hello hi مرحبا', 'en'], ['hello أهلا وسهلا', 'ar']]) {
    for (const offline of [false, true]) {
      (agent.setOffline as Function)(offline);
      const reply = await respond(text, { loggedIn: true });
      assert.ok(reply.reply.startsWith(expected + ':'), `${ui} UI / ${text} / offline=${offline}`);
      assert.equal((agent.getLocale as Function)(), ui, 'reply must not change UI language');
      assert.equal((agent.requests as any[]).at(-1).locale, expected, 'wire request follows message');
    }
  }
}

// Execute the same word-majority and tie/number rules on both sides of the wire.
const serverLanguage = await liftSymbols(join(root, 'supabase/functions/agent/index.ts'), [
  { header: 'function detectLang(' }, { header: 'function resolveReplyLanguage(' },
], ['detectLang', 'resolveReplyLanguage']);
const cases: Array<[string, 'ar' | 'en' | null]> = [
  ['I want a home in حي المهدية', 'en'], ['ابحث عن فيلا في Riyadh', 'ar'],
  ['hello مرحبا', null], ['hello المهديةالمهديةالمهدية', null],
  ['hello hi مرحبا', 'en'], ['hello أهلا وسهلا', 'ar'],
  ["I'd like homes في شمال حي الرياض", 'ar'],
  ['٤٠٠٠ 5000 ۵۰۰۰ 🏡', null], ['', null], ['café home الرياض', 'en'],
];
for (const [text, expected] of cases) {
  assert.equal(detectLocale(text), expected, 'client words: ' + text);
  assert.equal((serverLanguage.detectLang as Function)(text), expected, 'server words: ' + text);
}
for (const ui of ['ar', 'en']) {
  for (const history of [[], [{text:'hello'}], [{text:'مرحبا'}], [{text:'hello'},{text:'مرحبا'}]]) {
    for (const text of ['hello مرحبا','4000','٤٠٠٠','hello hi مرحبا','hello أهلا وسهلا']) {
      const expected = (lang.resolveReplyLocale as Function)(text,history,ui);
      assert.equal((serverLanguage.resolveReplyLanguage as Function)(text,history,ui),expected);
      (agent.setUI as Function)(ui); (agent.setOffline as Function)(false);
      const result = await respond(text,{loggedIn:true,history});
      assert(result.reply.startsWith(expected + ':'));
      assert.equal((agent.getLocale as Function)(),ui);
    }
  }
}

// Execute the actual summary and nested location/budget functions with a contrasting UI locale.
const summaries = await liftSymbols(join(root, 'src/data/search.ts'), [
  {header: 'function summaryLanguage('}, {header: 'function budgetLines('},
  {header: 'function locationLines('}, {header: 'export function searchSummary('},
], ['searchSummary'], `
type Locale = 'ar' | 'en'; type SearchQuery = any;
const getLocale = () => 'ar'; const translate = (loc: string, key: string) => loc + ':' + key;
const tWord = translateWord; const tPlace = translateWord; const tPriceTab = translateWord; const tDetailOption = translateWord;
function translateWord(key: string, loc = getLocale()) { return loc + ':' + key; }
const arabicOrPlaceholder = (key: string) => key;
const LOCATION_UNRESOLVED_AR = ''; const TYPE_UNRESOLVED_AR = '';
const effectiveTypes = (q: any) => q.types ?? []; const effectiveGroups = () => []; const effectiveBeds = () => [];
const numOrNull = (n: any) => n == null || n === '' ? null : Number(n); const grouped = String;
`);
for (const locale of ['ar', 'en']) {
  const summary = (summaries.searchSummary as Function)({ location: 'Riyadh', types: ['Apartment'], deal: 'Buy', priceMin: 100000 }, locale);
  assert.ok(summary.includes(locale + ':Search Summary'));
  assert.ok(summary.includes(locale + ':City') && summary.includes(locale + ':Budget'));
  assert.ok(!summary.includes((locale === 'en' ? 'ar' : 'en') + ':'), 'nested summary language must not read UI locale');
}

// Lift the actual store closures by AST; no copy of their title/update logic.
const store = readFileSync(storePath, 'utf8');
const ast = ts.createSourceFile('store.tsx', store, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let record = '', turn = '', rename = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'recordHistory') record = node.initializer!.getText(ast);
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'recordChatTurn') turn = node.initializer.getText(ast);
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'renameHistory') rename = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast); assert.ok(record && turn);
assert.ok(rename);
const dir = mkdtempSync(join(tmpdir(), 'ez-language-history-'));
const out = join(dir, 'history.mjs');
writeFileSync(out, ts.transpileModule(`
import { autoTitleForPrompt, autoTitleForQuery, canAutoRetitle } from ${JSON.stringify(pathToFileURL(join(root, 'src/lib/chatTitle.ts')).href)};
const _arScript = ${lang._arScript}; const _latinScript = ${lang._latinScript};
const detectLocale = ${detectLocale.toString()};
const resolveReplyLocale = ${(lang.resolveReplyLocale as Function).toString()};
const getLocale = () => 'ar'; const user = {sub:'test'}; let activeChatId = null; let history = [];
const setHistory = (f) => { history = f(history); }; const setActiveChatId = (id) => { activeChatId = id; };
const historyKey = () => 'test'; const serializeHistoryForDisk = (v) => JSON.stringify(v);
const emptyQuery = () => ({}); const queryLabel = () => 'Arabic UI query label';
const sameQuery = () => false; const SNAPSHOT_CAP = 20; const SNAPSHOT_ENTRIES = 15;
const recordHistory = ${record}; const recordChatTurn = ${turn};
const rows = () => history; const truncateGlyphs = (text: string) => text; const rename = ${rename};
const transcript = (text: string) => { history[0].transcript = {msgs: [{role:'user',text}]}; };
export {recordHistory, recordChatTurn, rows, rename, transcript};
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
const h = await import(pathToFileURL(out).href);
const query = {category:'Residential', deal:'Buy', location:'Riyadh', type:'Apartment', types:[], typeGroups:[], priceInput:'', detail:''};
const id = h.recordChatTurn('أبي شقة بالرياض');
assert.match(h.rows()[0].title, /[\u0600-\u06ff]/);
h.recordChatTurn('show me apartments in Riyadh');
const english = h.rows()[0].title;
assert.equal(english, autoTitleForPrompt('show me apartments in Riyadh', 'en'), 'title summarizes in the message language');
assert.ok(/[A-Za-z]/.test(english) && !/[\u0600-\u06ff]/.test(english));
h.recordHistory(query, undefined, id);
assert.equal(h.rows()[0].title, english, 'search arrival must retain latest-message title');
h.rename(id, 'My own title'); h.recordChatTurn('أبي فيلا بجدة'); h.recordHistory(query, undefined, id);
assert.equal(h.rows()[0].title, 'My own title', 'manual rename must survive both paths');
h.transcript('show me apartments in Riyadh'); h.rename(id, '');
assert.equal(h.rows()[0].title, english, 'clearing a manual name restores the latest message language');
const screen = readFileSync(process.env.EZ_LANGUAGE_SCREEN_SOURCE ?? join(root, 'src/app/agent.tsx'), 'utf8');
assert.ok(!/\bsetLocale\s*\(/.test(screen), 'chat screen must never change interface locale');
// Execute the real result-closing expressions under a changing interface locale.
const screenAst = ts.createSourceFile('agent.tsx',screen,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const resultExpressions: Record<string,string> = {};
function findResultExpressions(n: ts.Node) {
  if (ts.isVariableDeclaration(n) && ['rfLang','replyT','moreNoteText'].includes(n.name.getText(screenAst))) resultExpressions[n.name.getText(screenAst)]=n.initializer!.getText(screenAst);
  ts.forEachChild(n,findResultExpressions);
}
findResultExpressions(screenAst);
const realDirection = await liftSymbols(join(root,'src/lib/textDirection.ts'),[{header:'export const msgRTL =',endsWith:/^};$/}],['msgRTL']);
const closing = new Function('msgRTL','m','ui',ts.transpileModule(`
const translate=(locale:string,key:string)=>locale+':'+key;
const t=(key:string)=>translate(ui,key);
const rc={endKind:'more',endShown:12,endTotal:32,lastTapOffer:false,cappedAtCap:false};
const quoteTotal=true,offersMore=true,offersNarrow=false,completed=false,clientNarrowed=false;
const closingNoteKey=()=> 'I showed you the first {shown} listings. Want me to show more?';
const revealTarget=()=>32;
const rfLang=${resultExpressions.rfLang}; const replyT=${resultExpressions.replyT};
const moreNoteText=${resultExpressions.moreNoteText}; return moreNoteText;
`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText);
for(const summary of ['Search Summary: Riyadh','ملخص البحث: الرياض']) {
  const first=closing(realDirection.msgRTL,{summary,text:summary},'en');
  assert.equal(closing(realDirection.msgRTL,{summary,text:summary},'ar'),first,'UI toggle must not translate existing closing note');
  assert(first.startsWith(summary.startsWith('Search')?'en:':'ar:'));
}

// Execute device persistence and the actual delayed-restore effect, including rapid toggles.
const i18nSource = readFileSync(process.env.EZ_LANGUAGE_I18N_SOURCE ?? join(root,'src/i18n.tsx'),'utf8');
const i18nAst = ts.createSourceFile('i18n.tsx',i18nSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const functions = new Map<string,string>(); let setLocaleCallback = '';
function findI18n(n: ts.Node) {
  if (ts.isFunctionDeclaration(n) && n.name) functions.set(n.name.text,n.getText(i18nAst).replace(/^export /,''));
  if (ts.isVariableDeclaration(n) && n.name.getText(i18nAst)==='setLocale' && n.initializer && ts.isCallExpression(n.initializer)) setLocaleCallback=n.initializer.arguments[0].getText(i18nAst);
  ts.forEachChild(n,findI18n);
}
findI18n(i18nAst);
let restoreEffect = '';
function findRestore(n: ts.Node) {
  if (ts.isCallExpression(n) && n.expression.getText(ast)==='useEffect' && n.arguments[0]?.getText(ast).includes('localeInitRef.current !== user.sub')) restoreEffect=n.arguments[0].getText(ast);
  ts.forEachChild(n,findRestore);
}
findRestore(ast); assert(restoreEffect && setLocaleCallback);
const persistenceCode = `
let _persistEnabled=false, _locale='ar', _localeRevision=0;
const LOCALE_KEY='locale'; const getLocale=()=>_locale; const getLocaleRevision=()=>_localeRevision;
${['readSavedLocale','setLocalePersistence','persistLocale','languageOnAuth'].map(n=>functions.get(n)).join('\n')}
const setLocaleState=()=>{}; const setLocale=${setLocaleCallback};
// No sign-in stored in this sandbox: a signed-out user is a genuine guest (the slow-sign-in wait is covered by
// scripts/verify-signed-in-language-is-kept.ts). Account writes are a no-op here.
const hasStoredAuthSession=()=>false; const persistUiLocale=()=>{}; const localeRestoredRef={current:false};
const authChecked=true; let user:any={sub:'test'}; const localeInitRef={current:null};
const restore=${restoreEffect};
return {setLocale,setLocalePersistence,readSavedLocale,restore,getLocale,logout:()=>{user=null;}};
`;
function persistenceRuntime() {
  const saved=new Map<string,string>(); let resolveRead: (v:string)=>void = ()=>{};
  const read=new Promise<string>(resolve=>{resolveRead=resolve;});
  const runtime=new Function('window','Platform','AsyncStorage',ts.transpileModule(persistenceCode,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText)(
    {localStorage:{getItem:(k:string)=>saved.get(k),setItem:(k:string,v:string)=>saved.set(k,v),removeItem:(k:string)=>saved.delete(k)}},
    {OS:'web'}, {getItem:()=>read,removeItem:async()=>{saved.delete('locale');}});
  return {runtime,saved,resolveRead};
}
{
  const {runtime,saved}=persistenceRuntime();
  runtime.setLocalePersistence(true); runtime.setLocale('en');
  assert.equal(saved.get('locale'),'en'); assert.equal(runtime.readSavedLocale(),'en');
  runtime.setLocale('ar'); assert.equal(runtime.readSavedLocale(),'ar');
  runtime.setLocalePersistence(false); runtime.setLocale('en'); assert(!saved.has('locale'));
  assert.equal(runtime.readSavedLocale(),'ar','guest fresh load is Arabic');
}
{
  const {runtime,resolveRead}=persistenceRuntime();
  runtime.restore(); runtime.setLocale('en'); runtime.setLocale('ar'); resolveRead('en');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(runtime.getLocale(),'ar','a delayed saved value must not undo a newer choice, even after switching back');
}
{
  const {runtime,resolveRead}=persistenceRuntime(); const cleanup=runtime.restore(); cleanup(); runtime.logout(); runtime.restore(); resolveRead('en');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(runtime.getLocale(),'ar','a signed-out account must not restore its language later');
}
assert.match(screen,/const replyT = \(key: string, vars\?: Record<string, string \| number>\) => translate\(rfLang, key, vars\)/,'existing result closing notes stay in the reply language');
assert(!screen.includes('translate_display'),'language switch never adds paid translation');
// The buttons under a results turn speak the REPLY's language (owner 2026-10-18: an English reply had
// «عرض المزيد» / «خلّنا نحدد الطلب أكثر» under it — «doesn't make sense»).
assert(screen.includes("{replyT('Load more')}") && screen.includes("{replyT('Let’s narrow it down')}") && !screen.includes("{t('Load more')}") && !screen.includes("{t('Let’s narrow it down')}"),'results-turn buttons follow the reply language');
console.log('PASS: message/request/fallback languages are independent of UI; latest titles persist and manual names win.');

// Repeat the regression proof on every CI run, using source copies instead of changing the checkout.
function mustCatch(label: string, file: string, before: string, after: string) {
  const source = readFileSync(join(root, file), 'utf8');
  assert.ok(source.includes(before), label + ': mutation target exists');
  const mutant = join(mkdtempSync(join(tmpdir(), 'ez-language-mutant-')), 'source.ts');
  writeFileSync(mutant, source.replace(before, after));
  const key = file.includes('app/agent') ? 'EZ_LANGUAGE_SCREEN_SOURCE' : file.includes('i18n') ? 'EZ_LANGUAGE_I18N_SOURCE' : file.includes('store') ? 'EZ_LANGUAGE_STORE_SOURCE' : 'EZ_LANGUAGE_AGENT_SOURCE';
  const result = spawnSync(process.execPath, ['--experimental-strip-types', import.meta.filename], {
    env: {...process.env, [key]: mutant, EZ_LANGUAGE_MUTATION_CHILD: '1'}, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 1, label + ': mutant must fail normally');
  assert.ok(result.stderr.includes('AssertionError'), label + ': a real invariant must catch it');
  console.log('PASS MUTATION: ' + label);
}
if (!process.env.EZ_LANGUAGE_MUTATION_CHILD) {
  mustCatch('any Arabic word overrides English majority', 'src/i18n.tsx', "  const words = text.match(", "  if (/[\\u0600-\\u06ff]/.test(text)) return 'ar';\n  const words = text.match(");
  mustCatch('request uses UI language', 'src/data/agent.ts', 'locale: ctx.locale ?? getLocale(),', 'locale: getLocale(),');
  mustCatch('UI toggle rewrites existing result note', 'src/app/agent.tsx', 'const moreNoteText = replyT(', 'const moreNoteText = t(');
  mustCatch('stale restore overwrites current language', 'src/store.tsx', 'getLocaleRevision() === revisionBeforeRead', 'true');
  mustCatch('title summarizes in UI language', 'src/store.tsx', 'autoTitleForPrompt(v, detectLocale(v) ?? getLocale())', 'autoTitleForPrompt(v, getLocale())');
  mustCatch('results-turn buttons in the UI language', 'src/app/agent.tsx', "{replyT('Let’s narrow it down')}", "{t('Let’s narrow it down')}");
  mustCatch('results overwrite latest title', 'src/store.tsx', ': chatId && prior?.title ? prior.title', ': false ? prior!.title');
}
