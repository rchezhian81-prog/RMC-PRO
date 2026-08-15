/**
 * UI V2 ("Deep Violet Matte Intelligence") rollout flag resolver — PRESENTATION ONLY.
 *
 * Pure and deterministic so the SAME value is produced on the server and in the
 * client bundle (this is what prevents a hydration mismatch or a flash of the
 * wrong skin). The rule is intentionally strict and fail-safe:
 *
 *   - Only the exact strings "1" or "true" (case-insensitive, surrounding
 *     whitespace ignored) turn the flag ON.
 *   - Everything else — missing, null, empty, "0", "false", "off", "yes", a
 *     typo, any other value — resolves to OFF.
 *
 * This flag decides ONLY whether the new visual skin is applied. It MUST NEVER
 * gate a module, permission, route, tenant/plant boundary, or any server-side
 * business decision — those remain enforced by the real module/RBAC system.
 */
export function resolveUiV2(raw: string | undefined | null): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === '1' || v === 'true';
}
