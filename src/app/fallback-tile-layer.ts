import * as L from 'leaflet';

export interface FallbackTileLayerOptions extends L.GridLayerOptions {
  /** How many zoom levels up to look for a tile when one is missing (default 5). */
  maxFallback?: number;
}

/**
 * Tile layer that, when a tile is missing (HTTP error), shows the matching quarter/sixteenth/... of the
 * parent tile instead, stretched to fit. Coverage of satellite imagery varies by area (e.g. rural Morocco
 * stops at zoom 18 while cities go to 19), so this keeps the map filled at every zoom level.
 *
 * The server must return an HTTP error for missing tiles: for Esri services add `?blankTile=false`,
 * otherwise they return a "Map data not yet available" image with status 200.
 *
 * `urlTemplate` supports {z}, {x}, {y} only.
 */
export class FallbackTileLayer extends L.GridLayer {
  private readonly maxFallback: number;

  constructor(
    private readonly urlTemplate: string,
    options: FallbackTileLayerOptions = {},
  ) {
    super(options);
    this.maxFallback = options.maxFallback ?? 5;
  }

  protected override createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const size = this.getTileSize();
    const tile = document.createElement('div');
    tile.style.overflow = 'hidden';

    const img = document.createElement('img');
    // CORS request (Esri allows it) so the service worker gets a readable response it can cache
    // for offline use, instead of an opaque one.
    img.crossOrigin = 'anonymous';
    img.alt = '';
    img.setAttribute('role', 'presentation');
    img.style.position = 'absolute';
    tile.appendChild(img);

    const load = (up: number) => {
      const scale = 2 ** up;
      const x = Math.floor(coords.x / scale);
      const y = Math.floor(coords.y / scale);
      // Show only the part of the ancestor tile that covers this tile.
      img.style.width = `${size.x * scale}px`;
      img.style.height = `${size.y * scale}px`;
      img.style.left = `${-(coords.x - x * scale) * size.x}px`;
      img.style.top = `${-(coords.y - y * scale) * size.y}px`;
      img.onload = () => done(undefined, tile);
      img.onerror = () => {
        if (up < this.maxFallback && coords.z - up > 0) load(up + 1);
        else done(new Error(`No tile for ${coords.z}/${coords.y}/${coords.x}`), tile);
      };
      img.src = L.Util.template(this.urlTemplate, { z: coords.z - up, x, y });
    };
    load(0);

    return tile;
  }
}
