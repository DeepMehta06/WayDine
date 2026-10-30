import { describe, expect, it } from "vitest";
import { encodePolyline } from "../src/lib/polyline.js";

describe("encodePolyline", () => {
  it("matches Google's own published example", () => {
    // https://developers.google.com/maps/documentation/utilities/polylinealgorithm
    // (lat,lng) pairs from the docs, converted to our [lng,lat] input order.
    const points: [number, number][] = [
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ];
    expect(encodePolyline(points)).toBe("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  });

  it("round-trips through a decoder for a dense real-shaped route", () => {
    const points: [number, number][] = Array.from({ length: 50 }, (_, i) => [72.8 + i * 0.0013, 19.0 + i * 0.0021]);
    const encoded = encodePolyline(points);
    expect(decode(encoded)).toEqual(points.map(([lng, lat]) => [Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]));
  });

  it("returns an empty string for no points", () => {
    expect(encodePolyline([])).toBe("");
  });
});

/** Reference decoder (independent implementation) used only to verify the encoder round-trips. */
function decode(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([lng / 1e5, lat / 1e5]);
  }
  return points;
}
