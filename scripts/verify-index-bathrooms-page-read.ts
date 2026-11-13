// Execute the PR #12171 page lookup with a fake PostgREST client. No network or temp files.
// Run: node --experimental-strip-types scripts/verify-index-bathrooms-page-read.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { bathroomsForCard } from '../src/lib/indexBathrooms.ts';

// remote.ts imports the application runtime. Lift its real declarations in memory, as the
// other remote.ts barriers do with liftSymbols, so these tests cannot drift into a copied rule.
const source = readFileSync(new URL('../src/data/remote.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('remote.ts', source, ts.ScriptTarget.Latest, true);
const declarations = ['ID_CHUNK', 'bounded', 'indexBathsForPage'].map((name) => {
  const node = ast.statements.find((statement) =>
    (ts.isFunctionDeclaration(statement) && statement.name?.text === name)
    || (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(
      (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name)));
  assert.ok(node, `remote.ts must declare ${name}`);
  return node.getText(ast).replace(/^export\s+/, '');
}).join('\n');
const javascript = ts.transpileModule(declarations, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
type Row = { listing_id: number | string; bathrooms: unknown };
type Reply = { data: Row[] | null; error: unknown };
type Request = {
  relation: string; columns?: string; table?: string; ids?: number[];
  excluded?: unknown[]; limit?: number; signal?: AbortSignal;
};
type Lookup = (entries: [string, number[]][], signal?: AbortSignal) => Promise<Map<string, unknown>>;
const ok = (data: Row[] = []): Reply => ({ data, error: null });
function harness(respond: (request: Request, index: number) => Reply | Promise<Reply> = () => ok(), available = true) {
  const requests: Request[] = [];
  const reports: { message: string; context: { table: string; error: string } }[] = [];
  const client = { from(relation: string) {
    const request: Request = { relation };
    const builder = {
      select(columns: string) { request.columns = columns; return builder; },
      eq(column: string, value: string) { assert.equal(column, 'source_table'); request.table = value; return builder; },
      in(column: string, ids: number[]) { assert.equal(column, 'listing_id'); request.ids = [...ids]; return builder; },
      not(...args: unknown[]) { request.excluded = args; return builder; },
      limit(value: number) { request.limit = value; return builder; },
      abortSignal(signal: AbortSignal) {
        request.signal = signal;
        requests.push(request);
        return respond(request, requests.length - 1);
      },
    };
    return builder;
  } };
  const lookup = new Function('supabase', 'reportMessage', 'RPC_TIMEOUT_MS',
    `${javascript}\nreturn indexBathsForPage;`)(available ? client : null,
    (message: string, context: { table: string; error: string }) => reports.push({ message, context }), 25) as Lookup;
  return { lookup, requests, reports };
}
const table = 'aqarcity_residential_listings';
const ids = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

await test('unconfigured client and empty pages return empty maps without requests or reports', async () => {
  for (const [available, entries] of [[false, [[table, [1]]]], [true, []], [true, [[table, []]]]] as [boolean, [string, number[]][]][]) {
    const h = harness(undefined, available);
    assert.equal((await h.lookup(entries)).size, 0);
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.reports, []);
  }
});

for (const [count, sizes] of [[1, [1]], [199, [199]], [200, [200]], [201, [200, 1]], [400, [200, 200]], [401, [200, 200, 1]]] as [number, number[]][]) {
  await test(`page of ${count} IDs is read exactly once in bounded 200-ID chunks`, async () => {
    const h = harness((request) => ok(request.ids!.map((listing_id) => ({ listing_id, bathrooms: 3 }))));
    const entries: [string, number[]][] = [[table, ids(count)]];
    const before = structuredClone(entries);
    const result = await h.lookup(entries);
    assert.deepEqual(h.requests.map((request) => request.ids!.length), sizes);
    assert.deepEqual(h.requests.flatMap((request) => request.ids!), ids(count));
    for (const request of h.requests) {
      assert.equal(request.relation, 'search_listings_ar');
      assert.equal(request.columns, 'listing_id,bathrooms');
      assert.equal(request.table, table);
      assert.deepEqual(request.excluded, ['bathrooms', 'is', null]);
      assert.equal(request.limit, request.ids!.length);
      assert.ok(request.signal instanceof AbortSignal);
    }
    assert.equal(result.size, count);
    assert.equal(result.get(`${table}:${count}`), 3);
    assert.deepEqual(entries, before, 'caller-owned ID arrays must not change');
    assert.deepEqual(h.reports, []);
  });
}

await test('IDs shared by two sources remain distinct; string IDs normalize to card keys', async () => {
  const other = 'squares_residential_listings';
  const h = harness((request) => ok([{ listing_id: '5720470', bathrooms: request.table === table ? 3 : '5' }]));
  const result = await h.lookup([[table, [5720470]], [other, [5720470]]]);
  assert.deepEqual([...result], [[`${table}:5720470`, 3], [`${other}:5720470`, '5']]);
  assert.equal(bathroomsForCard(0, result.get(`${table}:5720470`)), 3);
  assert.equal(bathroomsForCard(null, result.get(`${other}:5720470`)), 5);
  assert.equal(bathroomsForCard(2, result.get(`${other}:5720470`)), 2, 'published box wins');
});

await test('all chunks start before any resolves, and out-of-order responses keep their source keys', async () => {
  const pending: ((reply: Reply) => void)[] = [];
  const h = harness(() => new Promise((resolve) => pending.push(resolve)));
  const resultPromise = h.lookup([[table, ids(201)], ['squares_residential_listings', [1]]]);
  assert.equal(pending.length, 3, 'sequential reads would stall after the first chunk');
  pending[2](ok([{ listing_id: 1, bathrooms: 5 }]));
  pending[1](ok([{ listing_id: 201, bathrooms: 4 }]));
  pending[0](ok([{ listing_id: 1, bathrooms: 3 }]));
  assert.deepEqual([...(await resultPromise)], [[`${table}:1`, 3], [`${table}:201`, 4], ['squares_residential_listings:1', 5]]);
});

await test('missing rows and a successful null payload leave bathroom counts unknown', async () => {
  for (const reply of [ok(), { data: null, error: null }]) {
    const h = harness(() => reply);
    const result = await h.lookup([[table, [1]]]);
    assert.equal(result.has(`${table}:1`), false);
    assert.equal(bathroomsForCard(null, result.get(`${table}:1`)), null);
    assert.equal(bathroomsForCard(2, result.get(`${table}:1`)), 2);
    assert.deepEqual(h.reports, []);
  }
});

for (const rejected of [false, true]) {
  await test(`${rejected ? 'rejected request' : 'PostgREST error'} is reported while other chunks survive`, async () => {
    const h = harness((_request, index) => {
      if (index !== 1) return ok([{ listing_id: index === 0 ? 1 : 401, bathrooms: 4 }]);
      if (rejected) return Promise.reject(new Error('synthetic network failure'));
      return { data: [{ listing_id: 201, bathrooms: 99 }], error: { message: 'synthetic backend failure' } };
    });
    const result = await h.lookup([[table, ids(401)]]);
    assert.deepEqual([...result], [[`${table}:1`, 4], [`${table}:401`, 4]]);
    assert.equal(result.has(`${table}:201`), false, 'failed response data must not be used');
    assert.deepEqual(h.reports, [{ message: 'indexBathsForPage: search_listings_ar read failed', context: {
      table, error: rejected ? 'synthetic network failure' : 'synthetic backend failure',
    } }]);
  });
}

function untilAborted(request: Request): Promise<Reply> {
  return new Promise((_resolve, reject) => {
    const abort = () => reject(new Error('synthetic aborted request'));
    if (request.signal!.aborted) abort();
    else request.signal!.addEventListener('abort', abort, { once: true });
  });
}
for (const alreadyAborted of [false, true]) {
  await test(`${alreadyAborted ? 'pre-aborted' : 'in-flight cancellation'} returns no invented counts and no failure report`, async () => {
    const h = harness(untilAborted);
    const controller = new AbortController();
    if (alreadyAborted) controller.abort();
    const pending = h.lookup([[table, [1]]], controller.signal);
    controller.abort();
    assert.equal((await pending).size, 0);
    assert.ok(h.requests.every((request) => request.signal!.aborted));
    assert.deepEqual(h.reports, []);
  });
}

await test('timeout aborts a stalled lookup and reports it as a failure', async () => {
  const h = harness(untilAborted);
  assert.equal((await h.lookup([[table, [1]]])).size, 0);
  assert.equal(h.requests[0].signal!.aborted, true);
  assert.equal(h.reports.length, 1);
  assert.equal(h.reports[0].context.table, table);
  assert.match(h.reports[0].context.error, /synthetic aborted request/);
});
