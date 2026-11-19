import * as L from 'leaflet';

/** Map methods/events added by leaflet-rotate (not in @types/leaflet). */
export interface RotatableMap extends L.Map {
  getBearing(): number;
  setBearing(degrees: number): void;
}

/**
 * Compass button: the needle always points to north, and clicking it rotates the map back to north-up.
 * Pair with leaflet-rotate (`rotate: true`), which provides the bearing and the `rotate` event.
 */
export class CompassControl extends L.Control {
  private needle?: SVGElement;
  private button?: HTMLAnchorElement;
  private rmap?: RotatableMap;

  constructor(options: L.ControlOptions = { position: 'topleft' }) {
    super(options);
  }

  override onAdd(map: L.Map): HTMLElement {
    const m = (this.rmap = map as RotatableMap);
    const bar = L.DomUtil.create('div', 'leaflet-bar leaflet-control-compass');
    const a = (this.button = L.DomUtil.create('a', '', bar) as HTMLAnchorElement);
    a.href = '#';
    a.setAttribute('role', 'button');
    a.innerHTML = `
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="M12 2 L16 12 H8 Z" fill="#dc2626"/>
        <path d="M12 22 L8 12 H16 Z" fill="#9ca3af"/>
        <text x="12" y="10.5" text-anchor="middle" font-size="5" font-weight="700" fill="#fff" font-family="system-ui, sans-serif">N</text>
      </svg>`;
    this.needle = a.querySelector('svg')!;

    L.DomEvent.disableClickPropagation(bar);
    L.DomEvent.on(a, 'click', (e) => {
      L.DomEvent.preventDefault(e);
      m.setBearing(0);
    });
    map.on('rotate', this.update, this);
    this.update();
    return bar;
  }

  override onRemove(map: L.Map): void {
    map.off('rotate', this.update, this);
    this.rmap = undefined;
  }

  private update(): void {
    if (!this.rmap || !this.needle || !this.button) return;
    const bearing = this.rmap.getBearing();
    // The map is turned by `bearing` degrees, so north on screen is at -bearing.
    this.needle.style.transform = `rotate(${-bearing}deg)`;
    const rotated = Math.abs(bearing % 360) > 0.5;
    this.button.classList.toggle('rotated', rotated);
    const label = rotated ? `Map rotated ${Math.round(bearing)}°: tap to reset to north` : 'North is up';
    this.button.title = label;
    this.button.setAttribute('aria-label', label);
  }
}
