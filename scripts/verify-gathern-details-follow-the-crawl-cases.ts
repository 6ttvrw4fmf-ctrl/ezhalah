// Unit cases for the PR #11809 workflow guard. No GitHub API or database calls.
// node --experimental-strip-types scripts/verify-gathern-details-follow-the-crawl-cases.ts
import assert from 'node:assert/strict';
import { problems } from './verify-gathern-details-follow-the-crawl.ts';

const sync = 'name: Gathern sync\non:\n  workflow_dispatch:\n';
const workflow = (names = '"Gathern sync"', condition = '') => `name: Detail backfill
on:
  schedule:
    - cron: "0 2 * * *"
  workflow_run:
    workflows: [${names}]
    types: [completed]
  workflow_dispatch:
jobs:
  backfill:
${condition ? `    if: ${condition}\n` : ''}    runs-on: ubuntu-latest
`;

for (const name of ['Gathern sync', '"Gathern sync"', "'Gathern sync'"]) {
  assert.deepEqual(problems(workflow(), sync.replace('name: Gathern sync', `name: ${name}`)), []);
}
for (const names of ['Gathern sync', "'Gathern sync'", '"Other sync", "Gathern sync"']) {
  assert.deepEqual(problems(workflow(names), sync), []);
}
for (const condition of [
  "github.event_name == 'workflow_run'",
  "${{ github.event_name == 'workflow_run' || github.event_name == 'schedule' }}",
  "${{ always() }}",
]) {
  assert.deepEqual(problems(workflow('"Gathern sync"', condition), sync), []);
}

assert.deepEqual(problems(workflow(), 'on:\n  workflow_dispatch:\n'), [
  'gathern-sync.yml has no workflow name to follow',
]);
for (const names of ['', '"Other sync"', '"Gathern sync extra"']) {
  const errors = problems(workflow(names), sync);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /does not name the crawl/);
}
const broken = workflow('"Other sync"').replace('types: [completed]', 'types: [requested]');
const errors = problems(broken, sync);
assert.equal(errors.length, 2, 'report both the wrong workflow and wrong event phase');
assert.ok(errors.some((error) => error.includes('does not name the crawl')));
assert.ok(errors.some((error) => error.includes('COMPLETED')));

// Comments outside the event block cannot stand in for an actual trigger.
const withoutTrigger = workflow().replace(/  workflow_run:\n    workflows: .*\n    types: .*\n/, '');
assert.ok(problems(`${withoutTrigger}\n# workflow_run: types: [completed]\n`, sync)
  .some((error) => error.includes('no workflow_run trigger')));
for (const condition of ["github.event_name == 'schedule'", "${{ github.event_name != 'workflow_run' }}"]) {
  const errors = problems(workflow('"Gathern sync"', condition), sync);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /can skip the after-crawl run/);
}
console.log('PASS Gathern workflow guard unit cases');
