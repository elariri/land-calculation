import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, ViewChild, computed, signal } from '@angular/core';
import * as L from 'leaflet';
import { FallbackTileLayer } from './fallback-tile-layer';
import { LngLat, fmtHa, fmtHaACa, fmtM, fmtM2, measure } from './geo';
import { Place, parseLatLng, searchPlaces } from './search';

interface Position {
  lat: number;
  lng: number;
  /** Radius in meters of the 95% confidence circle reported by the device. */
  accuracy: number;
}

type Mode = 'draw' | 'edit';

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements AfterViewInit, OnDestroy {
  @ViewChild('map', { static: true }) mapEl!: ElementRef<HTMLDivElement>;

  readonly points = signal<LngLat[]>([]);
  readonly mode = signal<Mode>('draw');
  readonly m = computed(() => measure(this.points()));

  readonly searching = signal(false);
  readonly searchError = signal<string | null>(null);
  readonly results = signal<Place[]>([]);
  /** Suggestion highlighted with the arrow keys; Enter goes there. */
  readonly activeResult = signal(0);

  /** Live GPS tracking is on. */
  readonly tracking = signal(false);
  readonly position = signal<Position | null>(null);
  readonly locationError = signal<string | null>(null);

  /** Side panel (search, results) shown; hide it to see the whole map. */
  readonly panelOpen = signal(true);

  readonly fmtM2 = fmtM2;
  readonly fmtHa = fmtHa;
  readonly fmtHaACa = fmtHaACa;
  readonly fmtM = fmtM;

  private map!: L.Map;
  private shape!: L.Polygon;
  private vertexLayer = L.layerGroup();
  private labelLayer = L.layerGroup();
  /** Handles at the middle of each side; dragging one inserts a new corner there (bends the side). */
  private midpointLayer = L.layerGroup();
  /** Pin for the last search result. */
  private searchLayer = L.layerGroup();
  /** Blue dot + accuracy circle for the device position. */
  private positionLayer = L.layerGroup();
  private searchAbort?: AbortController;
  private searchTimer?: ReturnType<typeof setTimeout>;
  /** Tells Leaflet when the map area changes size (panel hidden/shown, rotation, window resize). */
  private resizeObserver?: ResizeObserver;
  /** Fly to the first GPS fix after tracking is turned on, then leave the view alone. */
  private centerOnNextFix = false;

  ngAfterViewInit(): void {
    // `blankTile=false` makes Esri return 404 for missing tiles (instead of a "Map data not yet
    // available" image), so FallbackTileLayer can show the closest lower zoom that has data.
    const esri = (service: string) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}?blankTile=false`;

    const satellite = new FallbackTileLayer(esri('World_Imagery'), {
      maxZoom: 20,
      maxNativeZoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    });
    // City / place names, borders, and roads drawn on top of the imagery.
    const labels = L.layerGroup([
      new FallbackTileLayer(esri('Reference/World_Transportation'), { maxZoom: 20, maxNativeZoom: 19, pane: 'overlayLabels' }),
      new FallbackTileLayer(esri('Reference/World_Boundaries_and_Places'), {
        maxZoom: 20,
        maxNativeZoom: 19,
        pane: 'overlayLabels',
        attribution: 'Labels © Esri',
      }),
    ]);
    const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20,
      maxNativeZoom: 19,
      crossOrigin: true, // Readable responses, so the service worker can cache them offline.
      attribution: '© OpenStreetMap contributors',
    });

    // Default view: Morocco.
    this.map = L.map(this.mapEl.nativeElement, { center: [31.8, -7.1], zoom: 6, layers: [satellite] });
    // Labels sit above the imagery but below the drawn parcel and must not swallow clicks.
    const labelPane = this.map.createPane('overlayLabels');
    labelPane.style.zIndex = '350';
    labelPane.style.pointerEvents = 'none';
    labels.addTo(this.map);
    L.control.layers({ Satellite: satellite, Streets: streets }, { 'Place names & roads': labels }).addTo(this.map);
    L.control.scale({ imperial: false }).addTo(this.map);

    this.shape = L.polygon([], { color: '#facc15', weight: 2, fillOpacity: 0.25 }).addTo(this.map);
    this.searchLayer.addTo(this.map);
    this.positionLayer.addTo(this.map);
    this.labelLayer.addTo(this.map);
    this.midpointLayer.addTo(this.map);

    this.resizeObserver = new ResizeObserver(() => this.map.invalidateSize());
    this.resizeObserver.observe(this.mapEl.nativeElement);

    this.map.on('locationfound', (e: L.LocationEvent) => this.onLocation(e));
    this.map.on('locationerror', (e: L.ErrorEvent) => {
      this.locationError.set(
        e.code === 1
          ? 'Location permission denied. Allow it in the browser settings for this site.'
          : `Could not get your location: ${e.message}`,
      );
      if (e.code === 1) this.stopTracking();
    });
    this.vertexLayer.addTo(this.map);

    this.map.on('click', (e: L.LeafletMouseEvent) => {
      if (this.mode() !== 'draw') return;
      this.points.update((p) => [...p, [e.latlng.lng, e.latlng.lat]]);
      this.redraw();
    });
  }

  /** Ask for confirmation before a reload/close throws away a drawn parcel (nothing is saved yet). */
  @HostListener('window:beforeunload', ['$event'])
  warnBeforeLeaving(e: BeforeUnloadEvent): void {
    if (this.points().length === 0) return;
    e.preventDefault();
    e.returnValue = ''; // Older browsers need this to show the dialog.
  }

  ngOnDestroy(): void {
    clearTimeout(this.searchTimer);
    this.searchAbort?.abort();
    this.resizeObserver?.disconnect();
    this.map?.stopLocate();
    this.map?.remove();
  }

  toggleMode(): void {
    this.mode.update((m) => (m === 'draw' ? 'edit' : 'draw'));
  }

  undo(): void {
    this.points.update((p) => p.slice(0, -1));
    this.redraw();
  }

  clear(): void {
    this.points.set([]);
    this.mode.set('draw');
    this.redraw();
  }

  zoomToShape(): void {
    if (this.points().length >= 2) this.map.fitBounds(this.shape.getBounds(), { padding: [40, 40] });
  }

  // ---- Search ----

  /** Called on every keystroke: shows suggestions after a short pause in typing. */
  onSearchInput(text: string): void {
    clearTimeout(this.searchTimer);
    this.searchError.set(null);
    this.activeResult.set(0);
    const q = text.trim();

    const coords = parseLatLng(q);
    if (coords) {
      this.searchAbort?.abort();
      this.searching.set(false);
      this.results.set([{ name: `Go to coordinates ${coords.lat}, ${coords.lng}`, ...coords }]);
      return;
    }
    if (q.length < 3) {
      this.searchAbort?.abort();
      this.searching.set(false);
      this.results.set([]);
      return;
    }
    this.searchTimer = setTimeout(() => this.runSearch(q), 300);
  }

  /** Keyboard navigation in the suggestion list. */
  onSearchKey(e: KeyboardEvent, input: HTMLInputElement): void {
    const n = this.results().length;
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault();
      this.activeResult.update((i) => (i + 1) % n);
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault();
      this.activeResult.update((i) => (i - 1 + n) % n);
    } else if (e.key === 'Escape') {
      this.results.set([]);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.searchNow(input);
    }
  }

  /** Enter: go to the highlighted suggestion, searching first if suggestions aren't in yet. */
  private async searchNow(input: HTMLInputElement): Promise<void> {
    clearTimeout(this.searchTimer);
    const q = input.value.trim();
    if (!this.results().length && q && !parseLatLng(q)) await this.runSearch(q);
    const place = this.results()[this.activeResult()] ?? this.results()[0];
    if (place) this.pick(place, input);
  }

  pick(place: Place, input: HTMLInputElement): void {
    if (!place.name.startsWith('Go to coordinates')) input.value = place.name;
    this.goTo(place);
  }

  private async runSearch(q: string): Promise<void> {
    this.searchAbort?.abort();
    const abort = (this.searchAbort = new AbortController());
    this.searching.set(true);
    try {
      const c = this.map.getCenter();
      const places = await searchPlaces(q, { near: { lat: c.lat, lng: c.lng }, signal: abort.signal });
      this.results.set(places);
      this.activeResult.set(0);
      if (!places.length) this.searchError.set(`No place found for "${q}".`);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') this.searchError.set('Search failed. Check your connection and try again.');
    } finally {
      if (this.searchAbort === abort) this.searching.set(false);
    }
  }

  private goTo(place: Place): void {
    this.results.set([]);
    if (place.bounds) {
      const [s, w, n, e] = place.bounds;
      this.map.fitBounds([[s, w], [n, e]], { maxZoom: 18 });
    } else {
      this.map.setView([place.lat, place.lng], 18);
    }
    this.searchLayer.clearLayers();
    L.marker([place.lat, place.lng], {
      interactive: false,
      icon: L.divIcon({ className: 'search-pin', html: '<span></span>', iconSize: [18, 18], iconAnchor: [9, 18] }),
    }).addTo(this.searchLayer);
  }

  // ---- Current position ----

  toggleTracking(): void {
    if (this.tracking()) {
      this.stopTracking();
      return;
    }
    this.locationError.set(null);
    this.tracking.set(true);
    this.centerOnNextFix = true;
    this.map.locate({ watch: true, enableHighAccuracy: true, setView: false, maximumAge: 0, timeout: 20000 });
  }

  /** Adds the current GPS position as the next corner (walk the boundary of the field). */
  addMyPosition(): void {
    const pos = this.position();
    if (!pos) return;
    this.points.update((p) => [...p, [pos.lng, pos.lat]]);
    this.redraw();
  }

  private stopTracking(): void {
    this.map.stopLocate();
    this.tracking.set(false);
    this.position.set(null);
    this.positionLayer.clearLayers();
  }

  private onLocation(e: L.LocationEvent): void {
    this.locationError.set(null);
    this.position.set({ lat: e.latlng.lat, lng: e.latlng.lng, accuracy: e.accuracy });
    this.positionLayer.clearLayers();
    L.circle(e.latlng, {
      radius: e.accuracy,
      interactive: false,
      color: '#2563eb',
      weight: 1,
      fillOpacity: 0.12,
    }).addTo(this.positionLayer);
    L.circleMarker(e.latlng, {
      radius: 7,
      interactive: false,
      color: '#fff',
      weight: 2,
      fillColor: '#2563eb',
      fillOpacity: 1,
    }).addTo(this.positionLayer);
    if (this.centerOnNextFix) {
      this.centerOnNextFix = false;
      this.map.setView(e.latlng, Math.max(this.map.getZoom(), 18));
    }
  }

  private redraw(): void {
    const pts = this.points();
    this.shape.setLatLngs(pts.map(([lng, lat]) => L.latLng(lat, lng)));

    this.vertexLayer.clearLayers();
    pts.forEach(([lng, lat], i) => {
      const marker = L.marker([lat, lng], {
        draggable: true,
        icon: L.divIcon({ className: 'vertex', html: `<span>${i + 1}</span>`, iconSize: [22, 22] }),
      });
      // Midpoint handles go stale while a corner moves; hide them until the drag ends.
      marker.on('dragstart', () => this.midpointLayer.clearLayers());
      marker.on('drag', (e) => this.movePoint(i, (e.target as L.Marker).getLatLng()));
      marker.on('dragend', () => this.redraw());
      // Right-click (long-press on mobile) removes the point.
      marker.on('contextmenu', () => {
        this.points.update((p) => p.filter((_, j) => j !== i));
        this.redraw();
      });
      this.vertexLayer.addLayer(marker);
    });

    this.drawMidpoints();
    this.drawLabels();
  }

  private movePoint(i: number, ll: L.LatLng): void {
    this.points.update((p) => p.map((q, j) => (j === i ? [ll.lng, ll.lat] : q)));
    this.shape.setLatLngs(this.points().map(([x, y]) => L.latLng(y, x)));
    this.drawLabels();
  }

  /** One draggable handle per side; dragging it inserts a corner between the side's two ends. */
  private drawMidpoints(): void {
    this.midpointLayer.clearLayers();
    const pts = this.points();
    this.m().sidesM.forEach((_, i) => {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const handle = L.marker([(a[1] + b[1]) / 2, (a[0] + b[0]) / 2], {
        draggable: true,
        icon: L.divIcon({ className: 'midpoint', html: '<span></span>', iconSize: [14, 14] }),
        title: 'Drag to bend this side',
      });
      const inserted = i + 1;
      handle.on('dragstart', () => {
        const ll = handle.getLatLng();
        this.points.update((p) => [...p.slice(0, inserted), [ll.lng, ll.lat], ...p.slice(inserted)]);
        this.midpointLayer.eachLayer((l) => l !== handle && this.midpointLayer.removeLayer(l));
      });
      handle.on('drag', () => this.movePoint(inserted, handle.getLatLng()));
      handle.on('dragend', () => this.redraw());
      this.midpointLayer.addLayer(handle);
    });
  }

  /** Side-length labels at the middle of each edge; also turns the shape red when its sides cross. */
  private drawLabels(): void {
    this.shape.setStyle({ color: this.m().selfIntersects ? '#dc2626' : '#facc15' });
    this.labelLayer.clearLayers();
    const pts = this.points();
    this.m().sidesM.forEach((len, i) => {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const mid = L.latLng((a[1] + b[1]) / 2, (a[0] + b[0]) / 2);
      L.marker(mid, {
        interactive: false,
        icon: L.divIcon({ className: 'side-label', html: `<span>${fmtM(len)}</span>`, iconSize: [0, 0] }),
      }).addTo(this.labelLayer);
    });
  }
}
