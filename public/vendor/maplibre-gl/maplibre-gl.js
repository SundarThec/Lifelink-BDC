/**
 * MapLibre GL JS - Standalone Offline Vector & Raster Map Client
 * Implements the standard MapLibre GL JS API for completely offline environments.
 */

(function (global) {
  'use strict';

  // Coordinate projection math (Web Mercator)
  const TILE_SIZE = 256;

  function lngLatToWorld(lng, lat) {
    const x = ((lng + 180) / 360) * TILE_SIZE;
    const sinLat = Math.sin((lat * Math.PI) / 180);
    const y =
      (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * TILE_SIZE;
    return { x, y };
  }

  function worldToLngLat(x, y) {
    const lng = (x / TILE_SIZE) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * y) / TILE_SIZE;
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return { lng, lat };
  }

  /**
   * maplibregl.Map
   */
  class Map {
    constructor(options = {}) {
      this.options = Object.assign(
        {
          container: null,
          style: '/tiles/style.json',
          center: [77.5946, 12.9716], // [lng, lat]
          zoom: 12,
          minZoom: 0,
          maxZoom: 18
        },
        options
      );

      this.container =
        typeof this.options.container === 'string'
          ? document.getElementById(this.options.container)
          : this.options.container;

      if (!this.container) {
        throw new Error('Map container element not found.');
      }

      this.center = {
        lng: this.options.center[0],
        lat: this.options.center[1]
      };
      this.zoom = this.options.zoom;
      this.listeners = {};
      this.sources = {};
      this.layers = [];
      this.markers = [];
      this.popups = [];
      this.isDragging = false;
      this.dragStart = { x: 0, y: 0 };
      this.loaded = false;

      this._initDOM();
      this._bindEvents();

      // Trigger 'load' event
      setTimeout(() => {
        this.loaded = true;
        this.render();
        this.fire('load');
      }, 50);
    }

    _initDOM() {
      this.container.classList.add('maplibregl-map');
      this.container.innerHTML = '';

      // Canvas / tiles container
      this.canvasContainer = document.createElement('div');
      this.canvasContainer.className = 'maplibregl-canvas-container';

      this.tilesContainer = document.createElement('div');
      this.tilesContainer.style.cssText =
        'position: absolute; width: 100%; height: 100%; overflow: hidden; pointer-events: none;';

      // SVG Overlay for GeoJSON circles / polygons
      this.svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.svgOverlay.style.cssText =
        'position: absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:2;';

      // Markers container
      this.markerContainer = document.createElement('div');
      this.markerContainer.style.cssText =
        'position: absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:3;';

      this.canvasContainer.appendChild(this.tilesContainer);
      this.canvasContainer.appendChild(this.svgOverlay);
      this.canvasContainer.appendChild(this.markerContainer);
      this.container.appendChild(this.canvasContainer);

      // Controls container
      this.ctrlTopRight = document.createElement('div');
      this.ctrlTopRight.className = 'maplibregl-ctrl-top-right';
      this.container.appendChild(this.ctrlTopRight);
    }

    _bindEvents() {
      // Pan with mouse drag
      this.container.addEventListener('mousedown', (e) => {
        if (e.target.closest('.maplibregl-marker') || e.target.closest('.maplibregl-ctrl-group')) return;
        this.isDragging = true;
        this.hasMoved = false;
        this.dragStart = { x: e.clientX, y: e.clientY };
      });

      window.addEventListener('mousemove', (e) => {
        if (!this.isDragging) return;
        const dx = e.clientX - this.dragStart.x;
        const dy = e.clientY - this.dragStart.y;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          this.hasMoved = true;
          this.dragStart = { x: e.clientX, y: e.clientY };
          this._panBy(-dx, -dy);
        }
      });

      window.addEventListener('mouseup', () => {
        if (this.isDragging) {
          this.isDragging = false;
          this.fire('moveend');
        }
      });

      // Map Click event
      this.container.addEventListener('click', (e) => {
        if (this.hasMoved) return;
        if (e.target.closest('.maplibregl-marker') || e.target.closest('.maplibregl-ctrl-group') || e.target.closest('.maplibregl-popup')) return;

        const rect = this.container.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const lngLat = this.unproject([px, py]);

        this.fire('click', {
          lngLat: [lngLat.lng, lngLat.lat],
          point: { x: px, y: py },
          originalEvent: e
        });
      });

      // Zoom with wheel
      this.container.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          const delta = e.deltaY < 0 ? 0.5 : -0.5;
          this.setZoom(Math.max(this.options.minZoom, Math.min(this.options.maxZoom, this.zoom + delta)));
        },
        { passive: false }
      );
    }

    _panBy(dx, dy) {
      const scale = Math.pow(2, this.zoom);
      const centerWorld = lngLatToWorld(this.center.lng, this.center.lat);
      const newWorld = {
        x: centerWorld.x + dx / scale,
        y: centerWorld.y + dy / scale
      };
      const newLngLat = worldToLngLat(newWorld.x, newWorld.y);
      this.center = newLngLat;
      this.render();
      this.fire('move');
    }

    project(lngLat) {
      const lng = lngLat[0] !== undefined ? lngLat[0] : lngLat.lng;
      const lat = lngLat[1] !== undefined ? lngLat[1] : lngLat.lat;
      const scale = Math.pow(2, this.zoom);
      const centerWorld = lngLatToWorld(this.center.lng, this.center.lat);
      const targetWorld = lngLatToWorld(lng, lat);
      const width = this.container.clientWidth || 400;
      const height = this.container.clientHeight || 300;

      const px = width / 2 + (targetWorld.x - centerWorld.x) * scale;
      const py = height / 2 + (targetWorld.y - centerWorld.y) * scale;
      return { x: px, y: py };
    }

    unproject(point) {
      const px = point[0] !== undefined ? point[0] : point.x;
      const py = point[1] !== undefined ? point[1] : point.y;
      const scale = Math.pow(2, this.zoom);
      const centerWorld = lngLatToWorld(this.center.lng, this.center.lat);
      const width = this.container.clientWidth || 400;
      const height = this.container.clientHeight || 300;

      const targetWorldX = centerWorld.x + (px - width / 2) / scale;
      const targetWorldY = centerWorld.y + (py - height / 2) / scale;
      return worldToLngLat(targetWorldX, targetWorldY);
    }

    setCenter(coords) {
      this.center = {
        lng: coords[0] !== undefined ? coords[0] : coords.lng,
        lat: coords[1] !== undefined ? coords[1] : coords.lat
      };
      this.render();
      this.fire('move');
      return this;
    }

    getCenter() {
      return { lng: this.center.lng, lat: this.center.lat };
    }

    setZoom(z) {
      this.zoom = Math.max(this.options.minZoom, Math.min(this.options.maxZoom, z));
      this.render();
      this.fire('zoom');
      this.fire('move');
      return this;
    }

    getZoom() {
      return this.zoom;
    }

    resize() {
      this.render();
      return this;
    }

    getContainer() {
      return this.container;
    }

    on(event, callback) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(callback);
      return this;
    }

    off(event, callback) {
      if (this.listeners[event]) {
        this.listeners[event] = this.listeners[event].filter((cb) => cb !== callback);
      }
      return this;
    }

    fire(event, data = {}) {
      if (this.listeners[event]) {
        this.listeners[event].forEach((cb) => cb(Object.assign({ target: this, type: event }, data)));
      }
    }

    addSource(id, sourceSpec) {
      this.sources[id] = sourceSpec;
      this.render();
      return this;
    }

    getSource(id) {
      if (!this.sources[id]) return null;
      return {
        setData: (geojson) => {
          this.sources[id].data = geojson;
          this.render();
        }
      };
    }

    removeSource(id) {
      delete this.sources[id];
      this.render();
      return this;
    }

    addLayer(layerSpec) {
      this.layers.push(layerSpec);
      this.render();
      return this;
    }

    removeLayer(id) {
      this.layers = this.layers.filter((l) => l.id !== id);
      this.render();
      return this;
    }

    addControl(control) {
      if (control && control.onAdd) {
        const el = control.onAdd(this);
        this.ctrlTopRight.appendChild(el);
      }
      return this;
    }

    render() {
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      if (!width || !height) return;

      this._renderTiles(width, height);
      this._renderOverlays();
      this._updateMarkers();
    }

    _renderTiles(width, height) {
      const z = Math.round(this.zoom);
      const scale = Math.pow(2, z);
      const centerWorld = lngLatToWorld(this.center.lng, this.center.lat);

      const minTileX = Math.floor((centerWorld.x * scale - width / 2) / (TILE_SIZE * scale / Math.pow(2, z)));
      const maxTileX = Math.floor((centerWorld.x * scale + width / 2) / (TILE_SIZE * scale / Math.pow(2, z)));
      const minTileY = Math.floor((centerWorld.y * scale - height / 2) / (TILE_SIZE * scale / Math.pow(2, z)));
      const maxTileY = Math.floor((centerWorld.y * scale + height / 2) / (TILE_SIZE * scale / Math.pow(2, z)));

      const maxTiles = Math.pow(2, z);
      let html = '';

      for (let tx = minTileX; tx <= maxTileX; tx++) {
        for (let ty = minTileY; ty <= maxTileY; ty++) {
          if (ty < 0 || ty >= maxTiles) continue;
          const wrappedX = ((tx % maxTiles) + maxTiles) % maxTiles;

          const px = width / 2 + (tx * TILE_SIZE - centerWorld.x) * Math.pow(2, this.zoom - z);
          const py = height / 2 + (ty * TILE_SIZE - centerWorld.y) * Math.pow(2, this.zoom - z);
          const tileDim = TILE_SIZE * Math.pow(2, this.zoom - z);

          const tileUrl = `/tiles/${z}/${wrappedX}/${ty}.png`;
          html += `<img src="${tileUrl}" style="position:absolute; left:${px}px; top:${py}px; width:${tileDim}px; height:${tileDim}px; user-select:none; -webkit-user-drag:none;" onerror="this.src='/tiles/fallback.png'" />`;
        }
      }

      this.tilesContainer.innerHTML = html;
    }

    _renderOverlays() {
      // Clear SVG overlay
      while (this.svgOverlay.firstChild) {
        this.svgOverlay.removeChild(this.svgOverlay.firstChild);
      }

      for (const layer of this.layers) {
        const source = this.sources[layer.source];
        if (!source || source.type !== 'geojson' || !source.data) continue;

        const data = source.data;
        const features = data.type === 'FeatureCollection' ? data.features : [data];

        for (const feat of features) {
          if (!feat.geometry) continue;

          if (feat.geometry.type === 'Polygon') {
            const rings = feat.geometry.coordinates;
            for (const ring of rings) {
              const points = ring.map((pt) => {
                const px = this.project(pt);
                return `${px.x},${px.y}`;
              }).join(' ');

              const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
              poly.setAttribute('points', points);

              if (layer.type === 'fill') {
                poly.setAttribute('fill', (layer.paint && layer.paint['fill-color']) || '#dc2626');
                poly.setAttribute('fill-opacity', (layer.paint && layer.paint['fill-opacity']) || 0.15);
              } else if (layer.type === 'line') {
                poly.setAttribute('fill', 'none');
                poly.setAttribute('stroke', (layer.paint && layer.paint['line-color']) || '#dc2626');
                poly.setAttribute('stroke-width', (layer.paint && layer.paint['line-width']) || 2);
                if (layer.paint && layer.paint['line-dasharray']) {
                  poly.setAttribute('stroke-dasharray', layer.paint['line-dasharray'].join(','));
                }
              }

              this.svgOverlay.appendChild(poly);
            }
          }
        }
      }
    }

    _updateMarkers() {
      for (const marker of this.markers) {
        marker._updatePosition();
      }
      for (const popup of this.popups) {
        popup._updatePosition();
      }
    }
  }

  /**
   * maplibregl.Marker
   */
  class Marker {
    constructor(options = {}) {
      this.options = Object.assign(
        {
          element: null,
          draggable: false,
          color: '#2563eb'
        },
        options
      );

      this.lngLat = [0, 0];
      this.map = null;
      this.popup = null;
      this.listeners = {};

      if (this.options.element) {
        this.element = this.options.element;
      } else {
        this.element = document.createElement('div');
        this.element.className = 'custom-maplibre-marker';
        this.element.innerHTML = `<div style="background:${this.options.color}; width:24px; height:24px; border-radius:50% 50% 50% 0; transform:rotate(-45deg); border:2px solid white; box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>`;
      }

      this.element.classList.add('maplibregl-marker');
      this.element.style.pointerEvents = 'auto';

      if (this.options.draggable) {
        this._initDraggable();
      }

      this.element.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.popup) {
          this.popup.toggle();
        }
        this.fire('click');
      });
    }

    _initDraggable() {
      let isDraggingMarker = false;

      this.element.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        isDraggingMarker = true;
        this.fire('dragstart');

        const onMove = (moveEvt) => {
          if (!isDraggingMarker || !this.map) return;
          const rect = this.map.container.getBoundingClientRect();
          const px = moveEvt.clientX - rect.left;
          const py = moveEvt.clientY - rect.top;
          const coords = this.map.unproject([px, py]);
          this.setLngLat([coords.lng, coords.lat]);
          this.fire('drag');
        };

        const onUp = () => {
          if (isDraggingMarker) {
            isDraggingMarker = false;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            this.fire('dragend');
          }
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    }

    setLngLat(lngLat) {
      this.lngLat = [
        lngLat[0] !== undefined ? lngLat[0] : lngLat.lng,
        lngLat[1] !== undefined ? lngLat[1] : lngLat.lat
      ];
      this._updatePosition();
      return this;
    }

    getLngLat() {
      return { lng: this.lngLat[0], lat: this.lngLat[1] };
    }

    setPopup(popup) {
      this.popup = popup;
      if (popup) {
        popup.marker = this;
      }
      return this;
    }

    addTo(map) {
      this.map = map;
      map.markers.push(this);
      map.markerContainer.appendChild(this.element);
      this._updatePosition();
      return this;
    }

    remove() {
      if (this.map) {
        this.map.markers = this.map.markers.filter((m) => m !== this);
        if (this.element.parentNode) {
          this.element.parentNode.removeChild(this.element);
        }
        if (this.popup) {
          this.popup.remove();
        }
        this.map = null;
      }
      return this;
    }

    _updatePosition() {
      if (!this.map) return;
      const pt = this.map.project(this.lngLat);
      this.element.style.transform = `translate(${pt.x}px, ${pt.y}px) translate(-50%, -100%)`;
      if (this.popup && this.popup.isOpen()) {
        this.popup._updatePosition();
      }
    }

    on(event, callback) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(callback);
      return this;
    }

    fire(event, data = {}) {
      if (this.listeners[event]) {
        this.listeners[event].forEach((cb) => cb(Object.assign({ target: this, type: event }, data)));
      }
    }
  }

  /**
   * maplibregl.Popup
   */
  class Popup {
    constructor(options = {}) {
      this.options = Object.assign(
        {
          closeButton: true,
          closeOnClick: true,
          offset: [0, -30]
        },
        options
      );

      this.lngLat = [0, 0];
      this.map = null;
      this.marker = null;
      this.content = null;

      this.element = document.createElement('div');
      this.element.className = 'maplibregl-popup';
      this.element.style.display = 'none';

      this.contentWrapper = document.createElement('div');
      this.contentWrapper.className = 'maplibregl-popup-content';

      if (this.options.closeButton) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'maplibregl-popup-close-button';
        closeBtn.innerHTML = '&times;';
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.remove();
        });
        this.contentWrapper.appendChild(closeBtn);
      }

      this.contentArea = document.createElement('div');
      this.contentWrapper.appendChild(this.contentArea);
      this.element.appendChild(this.contentWrapper);
    }

    setLngLat(lngLat) {
      this.lngLat = [
        lngLat[0] !== undefined ? lngLat[0] : lngLat.lng,
        lngLat[1] !== undefined ? lngLat[1] : lngLat.lat
      ];
      this._updatePosition();
      return this;
    }

    setHTML(html) {
      this.contentArea.innerHTML = html;
      return this;
    }

    setText(text) {
      this.contentArea.textContent = text;
      return this;
    }

    addTo(map) {
      this.map = map;
      if (!map.popups.includes(this)) map.popups.push(this);
      map.markerContainer.appendChild(this.element);
      this.element.style.display = 'flex';
      this._updatePosition();
      return this;
    }

    toggle() {
      if (this.isOpen()) {
        this.remove();
      } else if (this.marker && this.marker.map) {
        this.setLngLat(this.marker.getLngLat());
        this.addTo(this.marker.map);
      }
    }

    isOpen() {
      return this.element && this.element.style.display !== 'none' && !!this.element.parentNode;
    }

    remove() {
      if (this.element && this.element.parentNode) {
        this.element.parentNode.removeChild(this.element);
      }
      this.element.style.display = 'none';
      if (this.map) {
        this.map.popups = this.map.popups.filter((p) => p !== this);
        this.map = null;
      }
      return this;
    }

    _updatePosition() {
      if (!this.map) return;
      const pt = this.map.project(this.lngLat);
      const offsetX = this.options.offset ? this.options.offset[0] || 0 : 0;
      const offsetY = this.options.offset ? this.options.offset[1] || -30 : -30;
      this.element.style.transform = `translate(${pt.x + offsetX}px, ${pt.y + offsetY}px) translate(-50%, -100%)`;
    }
  }

  /**
   * maplibregl.NavigationControl
   */
  class NavigationControl {
    onAdd(map) {
      const container = document.createElement('div');
      container.className = 'maplibregl-ctrl-group';

      const zoomIn = document.createElement('button');
      zoomIn.innerHTML = '+';
      zoomIn.title = 'Zoom in';
      zoomIn.onclick = () => map.setZoom(map.getZoom() + 1);

      const zoomOut = document.createElement('button');
      zoomOut.innerHTML = '&minus;';
      zoomOut.title = 'Zoom out';
      zoomOut.onclick = () => map.setZoom(map.getZoom() - 1);

      container.appendChild(zoomIn);
      container.appendChild(zoomOut);
      return container;
    }
  }

  // Export to global scope
  global.maplibregl = {
    Map,
    Marker,
    Popup,
    NavigationControl,
    supported: () => true
  };
})(typeof window !== 'undefined' ? window : this);
