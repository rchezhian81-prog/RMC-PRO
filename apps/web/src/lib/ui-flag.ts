import { resolveUiV2 } from '@rmc/shared';

/**
 * UI V2 ("Deep Violet Matte Intelligence") rollout flag — PRESENTATION ONLY.
 *
 * Reads the build-time `NEXT_PUBLIC_UI_V2` env var. Because it is a
 * `NEXT_PUBLIC_*` value it is inlined into the client bundle at build time and
 * read at runtime on the server from the same environment, so both sides resolve
 * to the identical boolean — no hydration mismatch, no flash of the wrong skin.
 *
 * OFF unless the value is exactly "1"/"true" (see `resolveUiV2`). Defaults to OFF
 * everywhere, so production stays on the current UI until UI V2 is separately
 * built with the flag on and approved.
 *
 * NEVER gate a module, permission, route, tenant/plant boundary, or any
 * server-side business decision on this — it only toggles the `data-ui="v2"`
 * presentation attribute.
 */
export function isUiV2(): boolean {
  return resolveUiV2(process.env.NEXT_PUBLIC_UI_V2);
}
