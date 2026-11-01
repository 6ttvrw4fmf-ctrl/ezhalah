/** Owner-approved sky/desert treatment, 2026-10-24. Motion never gates search readiness. */
export const skyScene = {
  fadeMs: 300,
  stripHeight: 68,
  cloudOpacity: 0.72,
  duskCloudOpacity: 0.26,
  sidebarDriftMs: 18000,
  sidebarDriftPx: 20,
  eagleDriftPx: 12,
  /** Big sky clouds (home + chat): each drifts side to side on its own slow clock (owner 2026-10-24: «gently move»). */
  heroDriftPx: [26, 20, 30, 22] as readonly number[],
  heroDriftMs: [46000, 58000, 52000, 64000] as readonly number[],
  /** Sidebar clouds (owner 2026-10-24: «add those same clouds and move them slowly»), one clock each. */
  sidebarCloudPx: [16, 12, 18, 14] as readonly number[],
  sidebarCloudMs: [50000, 62000, 56000, 68000] as readonly number[],
} as const;

/** Stable variation per logo, so virtualized tiles don't change clouds while they move. */
export function cloudVariant(name: string): number {
  return Array.from(name).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % 4;
}
