// The ad-viewer speed robot's «does production still ship the instant-show tab?» must read the WHOLE split build.
// It read only the first <script> — after the 2026-10-27 split that is the 3.8 KB metro runtime — and failed on every
// run (41567582462) while production shipped the tab in the agent route chunk. EXECUTED against a fake site.
// Run: node --experimental-strip-types scripts/verify-shipped-bundle-reader.ts
import { shippedInstantShowTab } from '../e2e/lib/shippedBundle.mjs';

let failed = 0;
const check = (m: string, c: boolean) => { if (c) console.log(`  ok  ${m}`); else { console.error(`  FAIL  ${m}`); failed++; } };
const H = (n: string) => `${n}-${'a'.repeat(32)}.js`;
const site = (files: Record<string, string>) => async (u: string) => {
  const path = u.replace('https://x', '').replace(/\?cb=\d+$/, '');
  return files[path] ?? '';
};
const html = `<script src="/_expo/static/js/web/${H('__expo-metro-runtime')}"></script><script src="/_expo/static/js/web/${H('entry')}"></script>`;

// the measured shape: runtime first, tab in a route chunk referenced by the entry
let r = await shippedInstantShowTab('https://x', site({
  '/': html,
  [`/_expo/static/js/web/${H('__expo-metro-runtime')}`]: 'runtime',
  [`/_expo/static/js/web/${H('entry')}`]: `routes: "${H('agent')}" "${H('index')}"`,
  [`/_expo/static/js/web/${H('index')}`]: 'home',
  [`/_expo/static/js/web/${H('agent')}`]: 'testID:"ad-load-bar" testID:"ad-slow-hint"',
}));
check('finds the tab in a route chunk behind the runtime script', r.shipped === H('agent'));

// the tab really gone everywhere → not shipped (and files were read)
r = await shippedInstantShowTab('https://x', site({
  '/': html,
  [`/_expo/static/js/web/${H('__expo-metro-runtime')}`]: 'runtime',
  [`/_expo/static/js/web/${H('entry')}`]: `"${H('agent')}"`,
  [`/_expo/static/js/web/${H('agent')}`]: 'testID:"ad-load-bar" only',
}));
check('a build missing ad-slow-hint is NOT shipped', r.shipped === null && r.files >= 3);

// nothing readable → files 0 (the caller fails it, never a pass)
r = await shippedInstantShowTab('https://x', async () => '');
check('an unreadable site reads 0 files (a failure, not a pass)', r.files === 0 && r.shipped === null);

if (failed) { console.error(`\n❌ verify-shipped-bundle-reader: ${failed} check(s) failed`); process.exit(1); }
console.log('\n✅ verify-shipped-bundle-reader: the speed robot reads the whole split build.');
