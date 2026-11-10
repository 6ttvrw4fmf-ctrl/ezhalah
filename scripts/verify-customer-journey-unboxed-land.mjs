// Offline regression tests for PR #11699. Automatically discovered by npm test.
// Run: node scripts/verify-customer-journey-unboxed-land.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { typeUi } from '../e2e/engineers/journey-lib.mjs';

// The CLI launches a browser at import time. Execute its actual type-selection block with
// injected taps instead; no browser, credentials, network, or copy of the selection logic.
const source = readFileSync(new URL('../e2e/engineers/customer-journey.mjs', import.meta.url), 'utf8');
const start = source.indexOf('    step(`type ${ui.cat}');
const end = source.indexOf('    const fillRange =', start);
assert.ok(start >= 0 && end > start, 'type-selection boundaries moved; update the test harness');
const selectType = runInNewContext(`(async (ui, tap, step, log) => {
${source.slice(start, end)}
})`);

async function select(ui, rejectLabel) {
  const taps = [], steps = [], logs = [];
  const failure = new Error('synthetic missing button');
  let error;
  try {
    await selectType(ui, async (label) => {
      taps.push(label);
      if (label === rejectLabel) throw failure;
    }, (message) => steps.push(message), (message) => logs.push(message));
  } catch (e) { error = e; }
  return { taps, steps, logs, error, failure };
}

// Bare source land is commercial even when stored in a residential table. No type is guessed.
for (const table of [undefined, '', 'haraj_residential_listings', 'aqar_residential_listings',
  'haraj_commercial_listings', 'aqar_commercial_listings']) {
  const ui = typeUi('أرض', table);
  assert.deepEqual(ui, { cat: 'تجاري', group: null, tap: null }, `bare land: ${table}`);
  const result = await select(ui);
  assert.ifError(result.error);
  assert.deepEqual(result.taps, ['تجاري'], `only category should be tapped: ${table}`);
  assert.deepEqual(result.logs, [], 'skipping an absent type is not a failed button lookup');
  assert.equal(result.steps.length, 1);
  assert.match(result.steps[0], /تجاري.*no type.*category alone.*—/);
  assert.doesNotMatch(result.steps[0], /null|undefined/);
}

// Decomposed Arabic alef-with-hamza must resolve just like NFC source text.
assert.deepEqual(typeUi('أرض'.normalize('NFD')), typeUi('أرض'));
for (const unknown of [undefined, null, '', 'نوع غير معروف', 'أرض مجهولة']) {
  assert.equal(typeUi(unknown), null, 'unknown types must not be silently mapped to Other Land');
}

// Specified land usage still requires both group and type selection.
for (const [type, cat, group] of [
  ['أرض سكنية', 'سكني', 'الأراضي السكنية'],
  ['أرض تجارية', 'تجاري', 'الأراضي'],
  ['أرض صناعية', 'تجاري', 'الأراضي'],
  ['أرض زراعية', 'سكني', 'الاستراحات والريف'],
]) {
  const result = await select(typeUi(type));
  assert.ifError(result.error);
  assert.deepEqual(result.taps, [cat, group, type], `${type}: retain the specific usage`);
  assert.deepEqual(result.steps, [`type ${cat} → ${group} → ${type}`]);
  assert.deepEqual(result.logs, []);
}

// Category selection may reject when the tab is already active; selection must continue.
const land = await select(typeUi('أرض'), 'تجاري');
assert.ifError(land.error);
assert.deepEqual(land.taps, ['تجاري']);
const apartment = typeUi('شقة');
const activeCategory = await select(apartment, apartment.cat);
assert.ifError(activeCategory.error);
assert.deepEqual(activeCategory.taps, [apartment.cat, apartment.group, apartment.tap]);

// An unavailable type retains the existing group-level fallback, but a missing group fails.
const missingType = await select(apartment, apartment.tap);
assert.ifError(missingType.error);
assert.deepEqual(missingType.taps, [apartment.cat, apartment.group, apartment.tap]);
assert.deepEqual(missingType.logs, ['    ! no «شقة» box (group-level search)']);
const missingGroup = await select(apartment, apartment.group);
assert.equal(missingGroup.error, missingGroup.failure);
assert.deepEqual(missingGroup.taps, [apartment.cat, apartment.group]);
assert.deepEqual(missingGroup.logs, []);

console.log('✓ customer journey: unboxed land mapping, category-only taps, normalization, boxed land, and failure paths');
