/**
 * GPS vendor feed — pure helpers (no NestJS / DB imports) so the parsing and
 * the key handling are unit tested on their own.
 *
 * A tracking vendor (or any device gateway) POSTs positions to /gps/ingest with
 * the tenant's ingest key. Vendors name fields differently, so the parser
 * accepts the common spellings: lat/latitude, lng/lon/longitude, speed/speedKmph,
 * heading/course, timestamp/recordedAt/time (ISO string or epoch seconds/ms),
 * and identifies the vehicle by vehicleNo/vehicle/registration or by
 * deviceId/imei/device.
 */
import { createHash, randomBytes } from 'node:crypto';
import { isValidLatLng } from './gps.util';

export const MAX_POSITIONS_PER_REQUEST = 500;

export interface VendorPosition {
  index: number;
  vehicleNo: string | null;
  deviceId: string | null;
  latitude: number;
  longitude: number;
  speedKmph: number | null;
  heading: number | null;
  accuracyM: number | null;
  recordedAt: Date;
}

export interface ParsedPositions {
  positions: VendorPosition[];
  rejected: Array<{ index: number; reason: string }>;
}

/** Registration numbers compare without spaces, hyphens or case: "TN 01 AB-1234" = "TN01AB1234". */
export function normalizeVehicleNo(v: unknown): string {
  return String(v ?? '').replace(/[\s\-./]/g, '').toUpperCase();
}

const pick = (o: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  }
  return undefined;
};

const numOrNull = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** ISO string, epoch seconds or epoch milliseconds → Date; missing → now. */
export function parseTimestamp(v: unknown, now: Date = new Date()): Date | null {
  if (v === undefined || v === null || v === '') return now;
  if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v))) {
    const n = Number(v);
    const ms = n < 1e11 ? n * 1000 : n; // seconds vs milliseconds
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Accept one object, an array, or {positions:[…]} / {data:[…]}. */
export function parsePositions(body: unknown, now: Date = new Date()): ParsedPositions {
  let items: unknown[];
  if (Array.isArray(body)) items = body;
  else if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const inner = b.positions ?? b.data ?? b.records ?? b.items;
    items = Array.isArray(inner) ? inner : [body];
  } else items = [];

  const positions: VendorPosition[] = [];
  const rejected: Array<{ index: number; reason: string }> = [];
  items.slice(0, MAX_POSITIONS_PER_REQUEST).forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') { rejected.push({ index, reason: 'not an object' }); return; }
    const o = raw as Record<string, unknown>;
    const vehicleNoRaw = pick(o, ['vehicleNo', 'vehicle_no', 'vehicle', 'registration', 'regNo', 'reg_no', 'plate', 'name']);
    const deviceRaw = pick(o, ['deviceId', 'device_id', 'imei', 'device', 'uniqueId', 'unique_id']);
    const vehicleNo = vehicleNoRaw === undefined ? null : normalizeVehicleNo(vehicleNoRaw);
    const deviceId = deviceRaw === undefined ? null : String(deviceRaw).trim().toUpperCase();
    if (!vehicleNo && !deviceId) { rejected.push({ index, reason: 'no vehicleNo or deviceId' }); return; }
    const latitude = Number(pick(o, ['latitude', 'lat']));
    const longitude = Number(pick(o, ['longitude', 'lng', 'lon', 'long']));
    if (!isValidLatLng(latitude, longitude)) { rejected.push({ index, reason: 'invalid latitude/longitude' }); return; }
    const recordedAt = parseTimestamp(pick(o, ['recordedAt', 'recorded_at', 'timestamp', 'time', 'fixTime', 'deviceTime', 'at']), now);
    if (!recordedAt) { rejected.push({ index, reason: 'invalid timestamp' }); return; }
    if (recordedAt.getTime() > now.getTime() + 5 * 60_000) { rejected.push({ index, reason: 'timestamp in the future' }); return; }
    const speed = numOrNull(pick(o, ['speedKmph', 'speed_kmph', 'speed', 'speedKph']));
    const heading = numOrNull(pick(o, ['heading', 'course', 'bearing', 'direction']));
    const accuracy = numOrNull(pick(o, ['accuracyM', 'accuracy_m', 'accuracy', 'hdop']));
    positions.push({
      index, vehicleNo: vehicleNo || null, deviceId: deviceId || null, latitude, longitude,
      speedKmph: speed !== null && speed >= 0 ? speed : null,
      heading: heading !== null && heading >= 0 && heading <= 360 ? heading : null,
      accuracyM: accuracy !== null && accuracy >= 0 ? accuracy : null,
      recordedAt,
    });
  });
  if (items.length > MAX_POSITIONS_PER_REQUEST) {
    rejected.push({ index: MAX_POSITIONS_PER_REQUEST, reason: `only the first ${MAX_POSITIONS_PER_REQUEST} positions of a request are read` });
  }
  return { positions, rejected };
}

/** A new ingest key: 40 url-safe characters with a recognisable prefix. */
export function generateIngestKey(): string {
  return `rmcgps_${randomBytes(30).toString('base64url').slice(0, 40)}`;
}

/** Keys are stored as SHA-256 hex; the key itself is shown once. */
export function hashIngestKey(key: string): string {
  return createHash('sha256').update(key.trim()).digest('hex');
}

/** The last four characters, so the screen can name the active key without revealing it. */
export function ingestKeyHint(key: string): string {
  return key.slice(-4);
}
