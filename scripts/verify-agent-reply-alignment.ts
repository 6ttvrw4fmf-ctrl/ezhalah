// Execute the actual JSX style expressions, including the completed and typing reply row.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { msgRTL } from '../src/lib/textDirection.ts';

const source = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
function verify(text: string) {
  const ast = ts.createSourceFile('agent.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const styles: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'style' && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
      styles.push(node.initializer.expression.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const wrapper = styles.find(s => s.includes('gap: 10') && s.includes("'76%'"))!;
  const row = styles.find(s => s.includes('s.reply,') && s.includes('alignSelf:'))!;
  // The results turn dims on `newSearchLoading` (renamed 2026-10-10: an Advanced Filter round no longer dims).
  const results = styles.find(s => s.includes('newSearchLoading') && s.includes('alignItems:'))!;
  const slogan = styles.find(s => s.includes('s.reply,') && s.includes("alignItems: 'center'"))!;
  assert.ok(wrapper && row && results && slogan, 'all reply paths found');
  function run(expression: string, message: string) {
    const js = ts.transpileModule(`const value = (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return new Function('rtl', 'msgRTL', 'IS_WEB', 's', 'm', 'newSearchLoading', 'latestResult', 'doneTyping', js + '\nreturn value;')(
      msgRTL(message), msgRTL, true, {reply:{}}, {id:'test', slogan:message}, false, null, {},
    );
  }
  for (const message of ['هلا', 'عذراً، ما قدرت أحدد مدينة أو حي لبحثك.', 'لقيت 12 شقة في الرياض', 'Hello', 'I found 12 apartments in Riyadh']) {
    const arabic = /[\u0600-\u06ff]/.test(message);
    const edge = arabic ? 'flex-end' : 'flex-start';
    const flow = arabic ? 'row-reverse' : 'row';
    assert.equal(run(wrapper, message).alignSelf, edge);
    assert.equal(run(row, message)[1].alignSelf, edge);
    assert.equal(run(row, message)[1].flexDirection, flow);
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
console.log('PASS: Arabic replies/results/sparkles align right, English left; original defect mutation rejected.');
