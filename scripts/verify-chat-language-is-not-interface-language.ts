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
const lang = await liftSymbols(join(root, 'src/i18n.tsx'), [
  { header: 'const _arScript =', endsWith: /;$/ },
  { header: 'const _latinScript =', endsWith: /;$/ },
  { header: 'export function detectLocale(' },
], ['detectLocale', '_arScript', '_latinScript']);
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
  for (const [text, expected] of [['hello', 'en'], ['هلا', 'ar']]) {
    for (const offline of [false, true]) {
      (agent.setOffline as Function)(offline);
      const reply = await respond(text, { loggedIn: true });
      assert.ok(reply.reply.startsWith(expected + ':'), `${ui} UI / ${text} / offline=${offline}`);
      assert.equal((agent.getLocale as Function)(), ui, 'reply must not change UI language');
      assert.equal((agent.requests as any[]).at(-1).locale, expected, 'wire request follows message');
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
const screen = readFileSync(join(root, 'src/app/agent.tsx'), 'utf8');
assert.ok(!/\bsetLocale\s*\(/.test(screen), 'chat screen must never change interface locale');
console.log('PASS: message/request/fallback languages are independent of UI; latest titles persist and manual names win.');

// Repeat the regression proof on every CI run, using source copies instead of changing the checkout.
function mustCatch(label: string, file: string, before: string, after: string) {
  const source = readFileSync(join(root, file), 'utf8');
  assert.ok(source.includes(before), label + ': mutation target exists');
  const mutant = join(mkdtempSync(join(tmpdir(), 'ez-language-mutant-')), 'source.ts');
  writeFileSync(mutant, source.replace(before, after));
  const key = file.includes('store') ? 'EZ_LANGUAGE_STORE_SOURCE' : 'EZ_LANGUAGE_AGENT_SOURCE';
  const result = spawnSync(process.execPath, ['--experimental-strip-types', import.meta.filename], {
    env: {...process.env, [key]: mutant, EZ_LANGUAGE_MUTATION_CHILD: '1'}, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 1, label + ': mutant must fail normally');
  assert.ok(result.stderr.includes('AssertionError'), label + ': a real invariant must catch it');
  console.log('PASS MUTATION: ' + label);
}
if (!process.env.EZ_LANGUAGE_MUTATION_CHILD) {
  mustCatch('request uses UI language', 'src/data/agent.ts', 'locale: ctx.locale ?? getLocale(),', 'locale: getLocale(),');
  mustCatch('title summarizes in UI language', 'src/store.tsx', 'autoTitleForPrompt(v, detectLocale(v) ?? getLocale())', 'autoTitleForPrompt(v, getLocale())');
  mustCatch('results overwrite latest title', 'src/store.tsx', ': chatId && prior?.title ? prior.title', ': false ? prior!.title');
}
