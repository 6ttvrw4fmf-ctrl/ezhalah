// A stray tap that opened the ad viewer is closed with the viewer's own ✕, not only with Escape (🦅 2026-11-13, backlog 1108).
//
// The app's Escape handler is a keydown listener on the TOP window (src/components/AdViewer.tsx). After a stray tap puts
// focus inside the viewer's iframe, Escape goes to the iframe and the sheet stays; every later robot tap then lands in the
// iframe and the top document reports «(no click event seen)» — the MOBILE af-card-evidence journey's red in every run.
// This EXECUTES dismissStrayOverlay() against stub pages.
import { dismissStrayOverlay } from './lib/liveClick.ts';

let failed = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++; };
const mutation = (label: string, caught: boolean) => check(`MUTATION — ${label}`, caught);

const stub = (opts: { open: boolean; hasX: boolean }) => {
  const seen: string[] = [];
  const page = {
    evaluate: async (fn: unknown) => { seen.push('evaluate'); return typeof fn === 'function' && String(fn).includes('ad-viewer') ? opts.open : undefined; },
    locator: (sel: string) => ({
      filter: () => ({ first: () => ({ click: async () => { if (!opts.hasX) throw new Error('no visible ✕'); seen.push(`click:${sel}`); } }) }),
    }),
    keyboard: { press: async (k: string) => { seen.push(`key:${k}`); } },
    waitForTimeout: async () => {},
  };
  return { page, seen };
};

{
  const { page, seen } = stub({ open: true, hasX: true });
  const r = await dismissStrayOverlay(page);
  check('an open viewer with a visible ✕ is closed by tapping ad-viewer-close', r && seen.includes('click:[data-testid="ad-viewer-close"]'));
  check('…and Escape (which an iframe can swallow) is not the path taken', !seen.includes('key:Escape'));
}
{
  const { page, seen } = stub({ open: true, hasX: false });
  await dismissStrayOverlay(page);
  check('with no visible ✕ (the split pane), it still falls back to Escape', seen.includes('key:Escape'));
}
{
  const { page, seen } = stub({ open: false, hasX: true });
  const r = await dismissStrayOverlay(page);
  check('no viewer open → nothing is tapped and nothing is pressed', !r && !seen.some((s) => s.startsWith('click:') || s.startsWith('key:')));
}
// Mutation: the pre-fix body (Escape only) must fail the first check.
{
  const { page, seen } = stub({ open: true, hasX: true });
  const oldBody = async (p: any) => { const open = await p.evaluate(() => 'ad-viewer'); if (!open) return false; await p.keyboard.press('Escape'); return true; };
  await oldBody(page);
  mutation('the Escape-only body is caught (it never taps ✕)', !seen.includes('click:[data-testid="ad-viewer-close"]'));
}

console.log(failed === 0 ? '\n✓ a stray ad viewer is closed by its own ✕' : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
