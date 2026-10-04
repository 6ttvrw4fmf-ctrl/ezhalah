// Exercise the real smoke observer. Missing UI alone must NEVER qualify as a backend timeout.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { liftSymbols } from './lib/liftSymbols.ts';

const lifted = await liftSymbols('scripts/verify-web-runtime-smoke.mjs',
  [{ header: 'function observeAfProbeTimeouts(' }], ['observeAfProbeTimeouts'],
  'let clock = 0; const Date = { now: () => clock }; export const tick = (ms) => { clock += ms; };');
const observe = lifted.observeAfProbeTimeouts as (page: EventEmitter) => { undetermined(): boolean; dispose(): void };
const tick = lifted.tick as (ms: number) => void;
const names = ['apartment_guided_counts_ar', 'property_age_option_counts_ar'];
const mustCatch = (label: string, caught: boolean) => assert.ok(caught, `mutation escaped: ${label}`);

function fixture() {
  const page = new EventEmitter();
  const observer = observe(page);
  const request = (name: string, error = 'net::ERR_ABORTED') => {
    const r = { url: () => `https://example.test/rest/v1/rpc/${name}`, failure: () => ({ errorText: error }) };
    page.emit('request', r);
    return r;
  };
  const round = (elapsed = 4000, error?: string) => {
    const pending = names.map((name) => request(name, error));
    tick(elapsed);
    pending.forEach((r) => page.emit('requestfailed', r));
  };
  return { page, observer, request, round };
}

const f = fixture();
assert.equal(f.observer.undetermined(), false, 'no requests is a failure, never an outage waiver');
f.round();
assert.equal(f.observer.undetermined(), false, 'one round does not prove the bounded retry exhausted');
f.round();
assert.equal(f.observer.undetermined(), true, 'both complete timed-out rounds prove UNKNOWN');
// Mutate the observed batch with an additional pending/answered probe: the same predicate
// must withdraw its verdict. Changing every(timedOut) to some(timedOut) makes this fail.
f.request(names[0]);
mustCatch('a pending or answered probe prevents the all-timeout verdict', !f.observer.undetermined());
f.observer.dispose();
assert.equal(f.page.listenerCount('request') + f.page.listenerCount('requestfailed'), 0);

for (const [elapsed, error] of [[200, 'net::ERR_ABORTED'], [4000, 'net::ERR_CONNECTION_REFUSED']] as const) {
  const g = fixture(); g.round(elapsed, error); g.round(elapsed, error);
  assert.equal(g.observer.undetermined(), false, 'early cancellation or another error is not an AF timeout');
  g.observer.dispose();
}
const h = fixture();
for (let i = 0; i < 4; i++) {
  const r = h.request(names[0]); tick(4000); h.page.emit('requestfailed', r);
}
assert.equal(h.observer.undetermined(), false, 'one missing RPC cannot be hidden by failures of the other');
h.observer.dispose();
console.log('PASS smoke AF: complete timeout evidence required; absent, partial, pending and non-timeout failures rejected');
