// Offline unit coverage for PR #11697. Execute the live verifier's actual helpers without
// importing its browser startup or contacting production. AST extraction follows the existing
// verify-agent-reply-alignment.ts convention; a missing helper fails loudly.
// Run: node --experimental-strip-types scripts/verify-af-honest-headline.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('./verify-af-option-card-truth-live.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('live.ts', source, ts.ScriptTarget.Latest, true);
function initializer(name: string): ts.Expression {
  for (const stmt of ast.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (decl.name.getText(ast) === name && decl.initializer) return decl.initializer;
    }
  }
  throw new Error(`Live verifier helper missing: ${name}`);
}
const rules = initializer('R');
assert.ok(ts.isObjectLiteralExpression(rules));
const honest = rules.properties.find(p => p.name?.getText(ast) === 'honestCount');
assert.ok(honest && ts.isPropertyAssignment(honest), 'honestCount must be extracted from production source');
const listener = ast.statements.find(stmt => ts.isExpressionStatement(stmt)
  && ts.isCallExpression(stmt.expression) && stmt.expression.expression.getText(ast) === 'page.on'
  && stmt.expression.arguments[0]?.getText(ast) === "'response'");
assert.ok(listener && ts.isExpressionStatement(listener) && ts.isCallExpression(listener.expression));

// Each fixture has isolated observation state. Only page I/O and the clock are replaced.
function fixture() {
  let now = 0;
  let polls = 0;
  let headlines: (number | null)[] = [];
  let afterWait = () => {};
  const page = {
    evaluate: async () => { polls++; return [headlines.shift() ?? null]; },
    waitForTimeout: async (ms: number) => { now += ms; afterWait(); },
  };
  const fragments = `
    const MAX_HYDRATION_DROPS = ${initializer('MAX_HYDRATION_DROPS').getText(ast)};
    const honestCount = ${honest.initializer.getText(ast)};
    const hydrationAsked = new Map(); const hydrationGot = new Set();
    const searches = []; const counts = []; let seq = 0;
    const response = ${listener.expression.arguments[1].getText(ast)};
    const dropsOf = ${initializer('dropsOf').getText(ast)};
    const waitForHeadline = ${initializer('waitForHeadline').getText(ast)};
    return { honestCount, response, dropsOf, waitForHeadline, searches };
  `;
  const js = ts.transpileModule(fragments, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
  } }).outputText;
  const api = new Function('page', 'Date', 'headlineNum', 'READ_HEADLINES', 'SENTENCE_SRC', js)(
    page, { now: () => now }, (n: number | null) => n, '', '',
  );
  return { ...api, setHeadlines: (...values: (number | null)[]) => { headlines = values; },
    afterWait: (fn: () => void) => { afterWait = fn; }, polls: () => polls, now: () => now };
}
const origin = 'https://example.invalid/rest/v1/';
function response(path: string, body: unknown, method = 'GET', ok = true, unreadable = false) {
  return {
    url: () => origin + path, ok: () => ok,
    request: () => ({ method: () => method, postData: () => '{}' }),
    json: async () => { if (unreadable) throw new Error('unreadable fixture'); return body; },
  };
}
async function search(f: ReturnType<typeof fixture>, rows = ['a_listings:1', 'a_listings:2']) {
  await f.response(response('rpc/location_search_candidates_ar', rows.map(key => {
    const [source_table, listing_id] = key.split(':');
    return { source_table, listing_id, total_count: 100 };
  }), 'POST'));
  return f.searches.at(-1);
}
let passed = 0;
async function test(name: string, run: () => unknown) {
  await run(); passed++;
  console.log(`PASS ${name}`);
}

await test('headline equality and zero results retain the existing exact-count path', () => {
  const { honestCount: count } = fixture();
  for (const drops of [null, 0, 1, 25, 26]) assert.equal(count(100, 100, 100, drops), true);
  assert.equal(count(0, 0, 0, 0), true);
});
await test('every allowed measured drop is accepted only at its exact adjusted headline', () => {
  const { honestCount: count } = fixture();
  for (let drops = 1; drops <= 25; drops++) {
    assert.equal(count(100 - drops, 100, 100, drops), true, `drops=${drops}`);
    assert.equal(count(99 - drops, 100, 100, drops), false, `one extra drop: ${drops}`);
    if (drops > 1) assert.equal(count(101 - drops, 100, 100, drops), false);
  }
  assert.equal(count(0, 25, 25, 25), true, 'inclusive cap and zero adjusted total');
});
await test('missing counts, unobserved drops, excessive drift and oracle disagreements fail', () => {
  const { honestCount: count } = fixture();
  for (const args of [
    [null, 100, 100, 1], [99, null, 100, 1], [99, 100, null, 1],
    [99, 100, 100, null], [99, 100, 100, 0], [101, 100, 100, 1],
    [74, 100, 100, 26], [99, 100, 101, 1], [100, 100, 101, 0],
    [101, 100, 100, -1], [99, 100, 100, NaN],
  ]) assert.equal(count(...args), false, JSON.stringify(args));
});
await test('no search is unobserved, while an empty search page has no drops', async () => {
  const f = fixture();
  assert.deepEqual(f.dropsOf(null), { n: null, keys: [] });
  assert.deepEqual(f.dropsOf(await search(f, [])), { n: 0, keys: [] });
});
await test('encoded ID lists, whitespace, numeric IDs and missing ID rows are handled', async () => {
  const f = fixture(); const s = await search(f);
  await f.response(response('a_listings?select=*&id=in.%281%2C%202%2C%20%29', [{ id: 1 }, {}, null]));
  assert.deepEqual(f.dropsOf(s), { n: 1, keys: ['a_listings:2'] });
  assert.equal(f.honestCount(99, s.total, 100, f.dropsOf(s).n), true);
});
await test('all chunks must be observed and returned rows remove their own drops', async () => {
  const f = fixture(); const s = await search(f);
  await f.response(response('a_listings?id=in.(1)', []));
  assert.deepEqual(f.dropsOf(s), { n: null, keys: [] }, 'partial observation cannot excuse any drop');
  await f.response(response('a_listings?id=in.(2)', []));
  assert.deepEqual(f.dropsOf(s), { n: 2, keys: ['a_listings:1', 'a_listings:2'] });
  await f.response(response('a_listings?id=in.(1,2)', [{ id: '2' }, { id: '1' }]));
  assert.deepEqual(f.dropsOf(s), { n: 0, keys: [] });
});
await test('IDs are scoped by table and unrelated rows do not affect this page', async () => {
  const f = fixture(); const s = await search(f, ['a_listings:1', 'b_listings:1']);
  await f.response(response('a_listings?id=in.(1,99)', [{ id: 1 }, { id: 99 }]));
  assert.equal(f.dropsOf(s).n, null, 'same ID in another table is still unobserved');
  await f.response(response('b_listings?id=in.(1)', []));
  assert.deepEqual(f.dropsOf(s), { n: 1, keys: ['b_listings:1'] });
});
await test('hydration observed before a new search cannot authorize its adjustment', async () => {
  const f = fixture();
  await f.response(response('a_listings?id=in.(1,2)', []));
  const s = await search(f);
  assert.deepEqual(f.dropsOf(s), { n: null, keys: [] });
  await f.response(response('a_listings?id=in.(1,2)', []));
  assert.equal(f.dropsOf(s).n, 2);
});
await test('failed, malformed, unreadable and unrelated responses grant no allowance', async () => {
  for (const r of [
    response('a_listings?id=in.(1,2)', [], 'GET', false),
    response('a_listings?id=in.(1,2)', { error: 'bad shape' }),
    response('a_listings?id=in.(1,2)', [], 'GET', true, true),
    response('a_listings?id=in.(1,2)', [], 'POST'),
    response('a_listings?active=eq.true', []),
    response('other_table?id=in.(1,2)', []),
  ]) {
    const f = fixture(); const s = await search(f);
    await f.response(r);
    assert.deepEqual(f.dropsOf(s), { n: null, keys: [] });
  }
});
await test('headline polling accepts the RPC total immediately without an allowance callback', async () => {
  const f = fixture(); f.setHeadlines(100);
  assert.equal(await f.waitForHeadline(100, 1000), 100);
  assert.equal(f.polls(), 1); assert.equal(f.now(), 0);
});
await test('polling reevaluates hydration evidence as it arrives', async () => {
  const f = fixture(); f.setHeadlines(99, 99);
  let adjusted: number | null = null;
  f.afterWait(() => { adjusted = 99; });
  assert.equal(await f.waitForHeadline(100, 1500, () => adjusted), 99);
  assert.equal(f.polls(), 2); assert.equal(f.now(), 500);
});
await test('unmatched or absent headlines time out and return only the last observation', async () => {
  const f = fixture(); f.setHeadlines(98, 97);
  assert.equal(await f.waitForHeadline(100, 1000, () => 99), 97);
  assert.equal(f.now(), 1000);
  const missing = fixture(); missing.setHeadlines(null, null);
  assert.equal(await missing.waitForHeadline(100, 1000, () => null), null);
  assert.equal(missing.polls(), 2);
});
console.log(`\n${passed} offline headline/hydration tests passed`);
