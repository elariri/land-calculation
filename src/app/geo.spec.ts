import { LngLat, fmtHa, fmtHaACa, fmtM, fmtM2, isSelfIntersecting, measure } from './geo';

/** Meters per degree of latitude on turf's sphere (R = 6371008.8 m). */
const M_PER_DEG = (6371008.8 * Math.PI) / 180;

/** Collapse any (narrow) no-break spaces that fr-FR uses as group separators. */
const norm = (s: string) => s.replace(/\s/g, ' ');

describe('measure', () => {
  it('returns zeros for fewer than 2 points', () => {
    expect(measure([])).toEqual({ areaM2: 0, perimeterM: 0, sidesM: [], selfIntersects: false });
    expect(measure([[0, 0]]).sidesM).toEqual([]);
  });

  it('gives one side and no area for 2 points', () => {
    const r = measure([[0, 0], [0, 0.001]]);
    expect(r.sidesM.length).toBe(1);
    expect(r.sidesM[0]).toBeCloseTo(0.001 * M_PER_DEG, 3);
    expect(r.areaM2).toBe(0);
  });

  it('measures a small square at the equator', () => {
    const d = 0.001;
    const side = d * M_PER_DEG; // ~111.19 m
    const r = measure([[0, 0], [d, 0], [d, d], [0, d]]);
    expect(r.sidesM.length).toBe(4);
    r.sidesM.forEach((s) => expect(Math.abs(s - side) / side).toBeLessThan(1e-4));
    expect(Math.abs(r.perimeterM - 4 * side) / (4 * side)).toBeLessThan(1e-4);
    expect(Math.abs(r.areaM2 - side * side) / (side * side)).toBeLessThan(1e-3);
  });

  it('gives the same area regardless of winding direction', () => {
    const cw: LngLat[] = [[-7, 31], [-7, 31.001], [-6.999, 31.001], [-6.999, 31]];
    const ccw = [...cw].reverse();
    expect(measure(cw).areaM2).toBeCloseTo(measure(ccw).areaM2, 6);
  });

  it('flags a bow-tie (crossed) quadrilateral', () => {
    const r = measure([[0, 0], [1, 1], [1, 0], [0, 1]]);
    expect(r.selfIntersects).toBeTrue();
  });
});

describe('isSelfIntersecting', () => {
  it('is false for triangles and convex shapes', () => {
    expect(isSelfIntersecting([[0, 0], [1, 0], [0, 1]])).toBeFalse();
    expect(isSelfIntersecting([[0, 0], [1, 0], [1, 1], [0, 1]])).toBeFalse();
  });

  it('is false for a concave (L-shaped) polygon', () => {
    expect(isSelfIntersecting([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]])).toBeFalse();
  });

  it('is true for a bow-tie', () => {
    expect(isSelfIntersecting([[0, 0], [1, 1], [1, 0], [0, 1]])).toBeTrue();
  });

  it('is true when the closing side crosses another side', () => {
    // Pentagon whose last side (4 -> 0) cuts across side 1 -> 2.
    expect(isSelfIntersecting([[0, 0], [2, 0], [2, 2], [3, 1], [-1, 1]])).toBeTrue();
  });

  it('is true when a corner touches a non-adjacent side', () => {
    // Point 3 sits exactly on side 0 -> 1.
    expect(isSelfIntersecting([[0, 0], [2, 0], [2, 2], [1, 0], [0, 2]])).toBeTrue();
  });
});

describe('formatters', () => {
  it('formats m², ha and m/km in fr-FR', () => {
    expect(norm(fmtM2(1234.5))).toBe('1 234,50 m²');
    expect(fmtHa(23_512)).toBe('2,3512 ha');
    expect(fmtM(12.345)).toBe('12,35 m');
    expect(fmtM(1500)).toBe('1,500 km');
  });

  it('formats land-register style ha/a/ca', () => {
    expect(fmtHaACa(23_512)).toBe('2 ha 35 a 12 ca');
    expect(fmtHaACa(0)).toBe('0 ha 0 a 0 ca');
    expect(fmtHaACa(99.6)).toBe('0 ha 1 a 0 ca'); // rounds to 100 m² = 1 a
  });
});
