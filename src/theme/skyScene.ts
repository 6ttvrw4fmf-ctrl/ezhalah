/** Owner-approved sky/desert treatment, 2026-10-24. Motion never gates search readiness. */
export const skyScene = {
  fadeMs: 300,
  stripHeight: 68,
  cloudOpacity: 0.72,
  duskCloudOpacity: 0.26,
  sidebarDriftMs: 18000,
  sidebarDriftPx: 20,
  eagleDriftPx: 12,
} as const;

/** Stable variation per logo, so virtualized tiles don't change clouds while they move. */
export function cloudVariant(name: string): number {
  return Array.from(name).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % 4;
}
