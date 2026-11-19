export interface Place {
  name: string;
  lat: number;
  lng: number;
  /** [south, west, north, east] when the place is an area (city, region...). */
  bounds?: [number, number, number, number];
}

/**
 * Parses "lat, lng" typed by the user (decimal degrees; comma, semicolon or space separated).
 * Returns null if the text is not a coordinate pair or is out of range.
 */
export function parseLatLng(text: string): { lat: number; lng: number } | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    /** [west, north, east, south] */
    extent?: [number, number, number, number];
  };
}

/** "Name, City, Region, Country" without empty or repeated parts. */
export function photonLabel(p: PhotonFeature['properties']): string {
  const main = p.name ?? [p.street, p.housenumber].filter(Boolean).join(' ');
  const parts = [main, p.city, p.county, p.state, p.country].filter((x): x is string => !!x);
  return parts.filter((x, i) => parts.indexOf(x) === i).join(', ');
}

/**
 * Looks up places by name with Photon (OpenStreetMap data, made for search-as-you-type).
 * `near` biases results toward that point (e.g. the map center).
 * Fair use: debounce calls and abort stale ones. https://photon.komoot.io
 */
export async function searchPlaces(
  query: string,
  opts: { near?: { lat: number; lng: number }; signal?: AbortSignal } = {},
): Promise<Place[]> {
  const params = new URLSearchParams({ q: query, limit: '6', lang: 'fr' });
  if (opts.near) {
    params.set('lat', opts.near.lat.toFixed(4));
    params.set('lon', opts.near.lng.toFixed(4));
  }
  const res = await fetch(`https://photon.komoot.io/api/?${params}`, { signal: opts.signal });
  if (!res.ok) throw new Error(`Search failed (HTTP ${res.status})`);
  const data: { features: PhotonFeature[] } = await res.json();
  const places = data.features.map((f): Place => {
    const [lng, lat] = f.geometry.coordinates;
    const e = f.properties.extent;
    return {
      name: photonLabel(f.properties),
      lat,
      lng,
      bounds: e ? [e[3], e[0], e[1], e[2]] : undefined,
    };
  });
  // A town and its administrative area often come back with the same label; keep the first.
  return places.filter((p, i) => places.findIndex((q) => q.name === p.name) === i);
}
