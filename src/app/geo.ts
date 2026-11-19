import area from '@turf/area';
import length from '@turf/length';
import { lineString, polygon } from '@turf/helpers';

/** A point as [longitude, latitude] (GeoJSON order). */
export type LngLat = [number, number];

export interface Measurement {
  areaM2: number;
  perimeterM: number;
  /** Length in meters of each side; side i goes from point i to point i+1 (last side closes the shape). */
  sidesM: number[];
  /** True when two non-adjacent sides cross or touch: the area is then meaningless. */
  selfIntersects: boolean;
}

/** Sign of the cross product (b - a) x (c - a): >0 left turn, <0 right turn, 0 collinear. */
function orient(a: LngLat, b: LngLat, c: LngLat): number {
  return Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
}

/** c is collinear with segment ab; is it within ab's bounding box? */
function onSegment(a: LngLat, b: LngLat, c: LngLat): boolean {
  return (
    Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1])
  );
}

/** Do segments p1p2 and p3p4 intersect (including touching)? */
function segmentsIntersect(p1: LngLat, p2: LngLat, p3: LngLat, p4: LngLat): boolean {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  return (
    (d1 === 0 && onSegment(p3, p4, p1)) ||
    (d2 === 0 && onSegment(p3, p4, p2)) ||
    (d3 === 0 && onSegment(p1, p2, p3)) ||
    (d4 === 0 && onSegment(p1, p2, p4))
  );
}

/**
 * Whether the closed polygon through `points` has crossing or touching non-adjacent sides.
 * Uses planar lng/lat geometry, which is exact enough at parcel scale (away from the poles / antimeridian).
 */
export function isSelfIntersecting(points: LngLat[]): boolean {
  const n = points.length;
  if (n < 4) return false; // A triangle cannot cross itself.
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // First and last sides share point 0.
      if (segmentsIntersect(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** Geodesic measurements of the polygon formed by `points` (auto-closed). Needs >= 3 points for an area. */
export function measure(points: LngLat[]): Measurement {
  const sidesM: number[] = [];
  const n = points.length;
  if (n >= 2) {
    const edgeCount = n >= 3 ? n : 1;
    for (let i = 0; i < edgeCount; i++) {
      const a = points[i];
      const b = points[(i + 1) % n];
      sidesM.push(length(lineString([a, b]), { units: 'meters' }));
    }
  }
  const areaM2 = n >= 3 ? area(polygon([[...points, points[0]]])) : 0;
  return {
    areaM2,
    perimeterM: sidesM.reduce((s, x) => s + x, 0),
    sidesM,
    selfIntersects: isSelfIntersecting(points),
  };
}

const nf = (digits: number) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtM2 = (m2: number) => `${nf(2).format(m2)} m²`;
export const fmtHa = (m2: number) => `${nf(4).format(m2 / 10_000)} ha`;
export const fmtM = (m: number) => (m >= 1000 ? `${nf(3).format(m / 1000)} km` : `${nf(2).format(m)} m`);

/** Land-register style: "2 ha 35 a 12 ca" (1 ha = 100 a, 1 a = 100 ca = 100 m²). */
export function fmtHaACa(m2: number): string {
  const total = Math.round(m2);
  const ha = Math.floor(total / 10_000);
  const a = Math.floor((total % 10_000) / 100);
  const ca = total % 100;
  return `${ha} ha ${a} a ${ca} ca`;
}
