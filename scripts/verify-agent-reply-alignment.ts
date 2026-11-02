// Execute the actual JSX style expressions, including the completed and typing reply row.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { msgRTL } from '../src/lib/textDirection.ts';
import { buildAfSummaryItems } from '../src/lib/afSummary.ts';

assert.deepEqual(buildAfSummaryItems([{ id: 'property_age', keys: ['2'], labels: ['Up to 2 years'] }], 'en'), ['🏗️ Age Up to 2 years']);
assert.deepEqual(buildAfSummaryItems([{ id: 'property_age', keys: ['2'], labels: ['سنتين'] }]), ['🏗️ عمر سنتين']);

const source = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
// Location names do not change the paragraph language. Leading numbers and emoji are neutral.
assert.equal(msgRTL('Find homes in حي المهدية وحي الرمال شمال مدينة الرياض'), false);
assert.equal(msgRTL('🔍 12 homes in حي المهدية وحي الرمال شمال مدينة الرياض'), false);
assert.equal(msgRTL('ابحث في Riyadh Al Mahdiyah Al Rimal'), true);
assert.equal(msgRTL('١٢ Search results in الرياض'), false);
assert.equal(msgRTL('123'), false);
function verify(text: string) {
  const resultsCode = text.slice(text.indexOf('// results — STRICT ORDER'));
  const expression = resultsCode.match(/const rtl = ([^;]+);/)![1];
  const direction = new Function('m', 'msgRTL', `return ${expression};`);
  assert.equal(direction({ text: 'لقينا نتائج', summary: 'Search Summary: Villa' }, msgRTL), false);
  assert.equal(direction({ text: 'Found results', summary: 'ملخص البحث' }, msgRTL), true);
  const ast = ts.createSourceFile('agent.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const styles: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'style' && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
      styles.push(node.initializer.expression.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const wrapper = styles.find(s => s.includes('gap: 10') && s.includes('alignSelf: rtl'))!;
  const user = styles.find(s => s.includes('s.userBubble'))!;
  const row = styles.find(s => s.includes('s.reply,') && s.includes('alignSelf:'))!;
  const results = styles.find(s => s.includes('gap: 6, alignItems: rtl') && s.includes("width: '100%'"))!;
  const slogan = styles.find(s => s.includes('s.reply,') && s.includes("alignItems: 'center'"))!;
  assert.ok(user && wrapper && row && results && slogan, 'all message paths found');
  function run(expression: string, message: string) {
    const js = ts.transpileModule(`const value = (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return new Function('rtl', 'msgRTL', 'IS_WEB', 's', 'm', 'searchingVisibleRef', 'latestResult', 'doneTyping', js + '\nreturn value;')(
      msgRTL(message), msgRTL, true, {reply:{}}, {id:'test', slogan:message}, {current:false}, null, {},
    );
  }
  for (const message of ['هلا', 'عذراً، ما قدرت أحدد مدينة أو حي لبحثك.', 'لقيت 12 شقة في الرياض', 'Hello', 'I found 12 apartments in Riyadh']) {
    const arabic = /[\u0600-\u06ff]/.test(message);
    const edge = arabic ? 'flex-end' : 'flex-start';
    const flow = arabic ? 'row-reverse' : 'row';
    assert.equal(run(user, message)[1].alignSelf, 'flex-end'); // the user's bubble is on the right in BOTH languages (owner 2026-10-23)
    assert.equal(run(wrapper, message).alignSelf, edge);
    assert.equal(run(wrapper, message).width, '100%', 'assistant replies use the full chat column');
    assert.equal(run(wrapper, message).maxWidth, undefined, 'assistant prose has no bubble-width cap');
    assert.equal(run(row, message)[1].alignSelf, edge);
    assert.equal(run(row, message)[1].flexDirection, flow);
    assert.equal(run(row, message)[1].width, '100%', 'text beside the sparkle fills the reply row');
    assert.equal(run(results, message).alignItems, edge);
    assert.equal(run(slogan, message)[1].flexDirection, flow);
  }
}
verify(source);
// Watch the barrier reject the original left-pinned row, without modifying the checkout.
const mutant = source.replace("alignSelf: rtl ? 'flex-end' : 'flex-start', flexDirection: rtl ? 'row-reverse' : 'row'", "alignSelf: 'flex-start', flexDirection: 'row'");
assert.notEqual(mutant, source, 'mutation target exists');
function mustCatch(brokenSource: string) {
  assert.throws(() => verify(brokenSource), assert.AssertionError);
}
mustCatch(mutant);
const userMutant = source.replace("[s.userBubble, { alignSelf: 'flex-end' }]", "[s.userBubble, { alignSelf: rtl ? 'flex-end' : 'flex-start' }]"); // the pre-2026-10-23 rule: English on the left
assert.notEqual(userMutant, source, 'user bubble mutation target exists');
mustCatch(userMutant);
const narrowReply = source.replace("gap: 10, alignSelf: rtl ? 'flex-end' : 'flex-start', width: '100%'", "gap: 10, alignSelf: rtl ? 'flex-end' : 'flex-start', maxWidth: IS_WEB ? '76%' : '88%'");
assert.notEqual(narrowReply, source, 'reply-width mutation target exists');
mustCatch(narrowReply);
console.log('PASS: user bubble right in both languages; Arabic replies/results/sparkles align right, English left; assistant prose fills the chat column; mutations rejected.');
