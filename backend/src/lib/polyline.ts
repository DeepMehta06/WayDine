/**
 * Google Encoded Polyline Algorithm Format (precision 5), used to send our
 * own route geometry to Places API (New) `searchAlongRouteParameters`
 * without an extra Routes API field/request. Pure and network-free.
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
import type { LngLat } from "../contract/api.js";

function encodeSigned(num: number): string {
  let n = num << 1;
  if (num < 0) n = ~n;
  let out = "";
  while (n >= 0x20) {
    out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
    n >>= 5;
  }
  return out + String.fromCharCode(n + 63);
}

export function encodePolyline(points: LngLat[], precision = 1e5): string {
  let out = "";
  let prevLat = 0;
  let prevLng = 0;
  for (const [lng, lat] of points) {
    const lat5 = Math.round(lat * precision);
    const lng5 = Math.round(lng * precision);
    out += encodeSigned(lat5 - prevLat) + encodeSigned(lng5 - prevLng);
    prevLat = lat5;
    prevLng = lng5;
  }
  return out;
}
