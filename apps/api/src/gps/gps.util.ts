/**
 * GPS tracking pure helpers. No NestJS/DB imports so each is unit-testable in
 * isolation (the .mjs tests import the compiled dist).
 *
 *   - `isValidLatLng`  — reject out-of-range or non-finite coordinates.
 *   - `haversineKm`    — great-circle distance between two points.
 *   - `trackSummary`   — total path length, straight-line distance and bounds of
 *     an ordered list of pings.
 *   - `etaMinutes`     — naive ETA from a remaining distance and a speed.
 */

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number): number => (deg * Math.PI) / 180;
const round = (v: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round((Number(v) || 0) * f) / f;
};

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** True for a finite latitude in [-90, 90] and longitude in [-180, 180]. */
export function isValidLatLng(latitude: unknown, longitude: unknown): boolean {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/** Great-circle distance between two coordinates, in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return round(EARTH_RADIUS_KM * c, 3);
}

export interface TrackSummary {
  pings: number;
  /** Sum of consecutive great-circle hops (the driven-ish path length). */
  pathKm: number;
  /** Great-circle distance from the first ping to the last. */
  straightLineKm: number;
  first: LatLng | null;
  last: LatLng | null;
}

/**
 * Summarise an ordered list of pings (oldest → newest): the cumulative path
 * length, the straight-line distance between the endpoints, and the endpoints.
 * Ignores points that aren't valid coordinates.
 */
export function trackSummary(points: Array<{ latitude: unknown; longitude: unknown }>): TrackSummary {
  const valid: LatLng[] = [];
  for (const p of points) {
    if (isValidLatLng(p.latitude, p.longitude)) {
      valid.push({ latitude: Number(p.latitude), longitude: Number(p.longitude) });
    }
  }
  let pathKm = 0;
  for (let i = 1; i < valid.length; i++) {
    pathKm += haversineKm(valid[i - 1] as LatLng, valid[i] as LatLng);
  }
  const first = valid[0] ?? null;
  const last = valid[valid.length - 1] ?? null;
  return {
    pings: valid.length,
    pathKm: round(pathKm, 3),
    straightLineKm: first && last ? haversineKm(first, last) : 0,
    first,
    last,
  };
}

/**
 * Naive ETA in whole minutes for a remaining distance at a given speed. Returns
 * null when the speed is not a positive number (can't estimate while stopped).
 */
export function etaMinutes(distanceKm: unknown, speedKmph: unknown): number | null {
  const dist = Number(distanceKm);
  const speed = Number(speedKmph);
  if (!Number.isFinite(dist) || dist < 0) return null;
  if (!Number.isFinite(speed) || speed <= 0) return null;
  return Math.round((dist / speed) * 60);
}
