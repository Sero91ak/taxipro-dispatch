/* TaxiPro Fahrer – kostenlose integrierte Verkehrszentrale.
 * Keine API-Keys, keine Pay-per-use-Anbieter, keine Blitzer-/Kontrollwarnungen.
 * Daten: Autobahn GmbH API. Karte: OpenFreeMap + MapLibre.
 */
(function () {
  'use strict';
  const ROADS = ['A61', 'A565', 'A555', 'A59', 'A4', 'A3'];
  const KINDS = ['warning', 'closure', 'roadworks'];
  const LABELS = { warning: 'Verkehrsgefahr', closure: 'Sperrung', roadworks: 'Baustelle' };
  const EMOJI = { warning: '⚠️', closure: '⛔', roadworks: '🚧' };
  const REGION = { minLng: 6.25, maxLng: 7.85, minLat: 50.22, maxLat: 51.28 };
  const TTL = 5 * 60 * 1000;
  const MAX_CACHE_AGE = 120 * 60 * 1000;
  const MAX_FEED_AGE = 45 * 60 * 1000;
  const CENTRAL_FEED = 'traffic-feed.json';
  const CACHE_KEY = 'tp_public_traffic_cache_v1';
  const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  const MAP_LIB = 'https://unpkg.com/maplibre-gl@6.19.0/dist/maplibre-gl.mjs';
  let active = false, map = null, maplibre = null, libPromise = null, positionMarker = null;
  let data = [], updatedAt = 0, fetching = null, lastAttempt = 0, filter = 'all', road = 'all', dataSource = 'cache';
  let markers = [], timer = null, locationCoords = null, radiusKm = null, lastDirectAttempt = 0;

  const $ = id => document.getElementById(id);
  function setStatus(message) {
    const el = $('tp-traffic-status');
    if (el) el.textContent = message;
  }
  function dateText(timestamp) {
    return timestamp ? new Date(timestamp).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–';
  }

  function distanceKm(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b[1] - a[1]) * rad;
    const dLon = (b[0] - a[0]) * rad;
    const latA = a[1] * rad, latB = b[1] * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
  }
  function updateFreshness() {
    const el = $('tp-traffic-freshness');
    if (!el) return;
    const age = updatedAt ? Date.now() - updatedAt : Infinity;
    const isCurrent = age >= 0 && age <= MAX_FEED_AGE;
    const isStale = Number.isFinite(age) && age <= MAX_CACHE_AGE && !isCurrent;
    el.dataset.state = isCurrent ? 'current' : isStale ? 'stale' : 'unavailable';
    el.textContent = isCurrent
      ? '● Datenstand ' + dateText(updatedAt) + ' · amtliche Meldungen'
      : isStale
        ? '⚠ VERALTET: Stand ' + dateText(updatedAt) + ' · nicht als Live-Daten verwenden'
        : '✕ Keine aktuellen Verkehrsdaten verfügbar';
  }
  function validCoord(raw) {
    const c = raw && raw.coordinate ? raw.coordinate : raw;
    let lat = Number(c && (c.lat ?? c.latitude));
    let lng = Number(c && (c.long ?? c.lng ?? c.longitude));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      const parts = String(raw && raw.point || '').split(',');
      lng = Number(parts[0]); lat = Number(parts[1]);
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lng < REGION.minLng || lng > REGION.maxLng || lat < REGION.minLat || lat > REGION.maxLat) return null;
    return [lng, lat];
  }
  function normalize(item, kind, autobahn, i) {
    if (!item || typeof item !== 'object') return null;
    const coords = validCoord(item);
    if (!coords) return null;
    const title = String(item.title || item.subtitle || LABELS[kind]).trim().slice(0, 200);
    const detail = Array.isArray(item.description) ? item.description.join(' ') : (item.description || item.subtitle || '');
    const id = String(item.identifier || kind + ':' + autobahn + ':' + i);
    return { id, kind, autobahn, title, detail: String(detail).replace(/\s+/g, ' ').trim().slice(0, 350), coords, future: item.future === true };
  }
  function loadCached() {
    try {
      const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!saved || !Array.isArray(saved.data) || !saved.updatedAt) return;
      if (Date.now() - saved.updatedAt > MAX_CACHE_AGE) return;
      data = saved.data.filter(x => x && Array.isArray(x.coords));
      dataSource = 'cache';
      updatedAt = saved.updatedAt;
    } catch (_) {}
  }
  function saveCached() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: data.slice(0, 450), updatedAt })); } catch (_) {}
  }
  function getVisible() {
    const selected = data.filter(x =>
      (road === 'all' || x.autobahn === road) &&
      (filter === 'planned' ? !!x.future : !x.future && (filter === 'all' || x.kind === filter)) &&
      (!radiusKm || !locationCoords || distanceKm(locationCoords, x.coords) <= radiusKm));
    const focus = locationCoords || (map ? [map.getCenter().lng, map.getCenter().lat] : [7.008, 50.650]);
    return selected.sort((a, b) => distanceKm(focus, a.coords) - distanceKm(focus, b.coords));
  }
  function render() {
    const list = $('tp-traffic-list');
    if (!list) return;
    updateFreshness();
    markers.forEach(m => m.remove());
    markers = [];
    list.replaceChildren();
    const visible = getVisible();
    const count = $('tp-traffic-count');
    if (count) count.textContent = visible.length + ' Meldung' + (visible.length === 1 ? '' : 'en') + ' im Bereich';
    if (map && maplibre) {
      visible.slice(0, 250).forEach(item => {
        const el = document.createElement('div');
        el.className = 'tp-traffic-pin ' + item.kind;
        el.textContent = EMOJI[item.kind];
        el.setAttribute('aria-label', LABELS[item.kind]);
        const popup = document.createElement('div');
        const heading = document.createElement('strong');
        heading.textContent = item.autobahn + ' · ' + LABELS[item.kind];
        const paragraph = document.createElement('p');
        paragraph.textContent = item.title + (item.detail ? ' – ' + item.detail : '');
        popup.append(heading, paragraph);
        const m = new maplibre.Marker({ element: el }).setLngLat(item.coords).setPopup(new maplibre.Popup({ maxWidth: '270px' }).setDOMContent(popup)).addTo(map);
        markers.push(m);
      });
    }
    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'tp-traffic-empty';
      empty.textContent = updatedAt ? 'Für die Auswahl liegen aktuell keine amtlichen Autobahnmeldungen vor.' : 'Noch keine Verkehrsmeldungen geladen. Bitte Datenquelle prüfen.';
      list.append(empty);
      return;
    }
    visible.slice(0, 40).forEach(item => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tp-traffic-item';
      const sym = document.createElement('span');
      sym.className = 'tp-traffic-symbol';
      sym.textContent = EMOJI[item.kind];
      const box = document.createElement('span');
      box.className = 'tp-traffic-item-main';
      const name = document.createElement('span');
      name.className = 'tp-traffic-item-title';
      name.textContent = item.autobahn + ' · ' + (item.future ? 'Geplant · ' : '') + LABELS[item.kind] + ': ' + item.title;
      const desc = document.createElement('span');
      desc.className = 'tp-traffic-item-sub';
      desc.textContent = item.detail || 'Information der Autobahn GmbH';
      box.append(name, desc); b.append(sym, box);
      b.addEventListener('click', () => {
        if (!map) return;
        map.flyTo({ center: item.coords, zoom: 13, duration: 650 });
        const marker = markers.find(m => Math.abs(m.getLngLat().lng - item.coords[0]) < 0.00001 && Math.abs(m.getLngLat().lat - item.coords[1]) < 0.00001);
        if (marker) marker.togglePopup();
      });
      list.append(b);
    });
  }
  async function loadLibrary() {
    if (maplibre) return maplibre;
    if (libPromise) return libPromise;
    libPromise = (async () => {
      if (!document.querySelector('link[data-tp-maplibre]')) {
        const css = document.createElement('link');
        css.rel = 'stylesheet'; css.dataset.tpMaplibre = '1';
        css.href = 'https://unpkg.com/maplibre-gl@6.19.0/dist/maplibre-gl.css';
        document.head.append(css);
      }
      maplibre = await import(MAP_LIB);
      return maplibre;
    })();
    try { return await libPromise; } catch (e) { libPromise = null; throw e; }
  }
  async function ensureMap() {
    if (map) { requestAnimationFrame(() => map && map.resize()); return; }
    try {
      const ml = await loadLibrary();
      if (!active) return;
      map = new ml.Map({
        container: 'tp-traffic-map',
        style: MAP_STYLE,
        center: [7.008, 50.650],
        zoom: 10.4,
        attributionControl: true
      });
      map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
      map.once('load', () => { map.resize(); render(); });
      map.on('error', e => {
        const container = $('tp-traffic-map');
        if (container) container.title = 'Kartenmaterial teilweise nicht verfügbar; Datenmeldungen weiterhin separat lesbar.';
        console.warn('TaxiPro Verkehrskarte:', e.error);
      });
    } catch (e) {
      console.warn('TaxiPro: MapLibre nicht verfügbar', e);
      const container = $('tp-traffic-map');
      if (container) {
        container.replaceChildren();
        const error = document.createElement('div');
        error.className = 'tp-traffic-empty';
        error.textContent = 'Kartenmaterial momentan nicht verfügbar. Die amtlichen Verkehrsmeldungen stehen weiterhin darunter.';
        container.append(error);
      }
    }
  }
  async function fetchOfficial(autobahn, kind) {
    const url = 'https://verkehr.autobahn.de/o/autobahn/' + autobahn + '/services/' + kind;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, { signal: controller.signal, mode: 'cors', cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const obj = await response.json();
      const items = obj && obj[kind];
      if (!Array.isArray(items)) throw new Error('Unerwartetes Datenformat');
      return items.map((item, i) => normalize(item, kind, autobahn, i)).filter(Boolean);
    } finally { clearTimeout(timeout); }
  }
  async function loadCentralFeed() {
    const url = new URL(CENTRAL_FEED, location.href);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url.toString(), { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Feed HTTP ' + response.status);
      const feed = await response.json();
      if (feed?.schema !== 1 || !Array.isArray(feed.events)) throw new Error('Unbekanntes Feed-Format');
      const timestamp = Date.parse(feed.generatedAt || '');
      if (!Number.isFinite(timestamp) || timestamp > Date.now() + 300000) throw new Error('Noch keine gültigen Live-Daten vorhanden');
      const events = feed.events.filter(x =>
        x && ROADS.includes(x.autobahn) && KINDS.includes(x.kind) && Array.isArray(x.coords) &&
        x.coords.length === 2 && Number.isFinite(x.coords[0]) && Number.isFinite(x.coords[1]) &&
        x.coords[0] >= REGION.minLng && x.coords[0] <= REGION.maxLng &&
        x.coords[1] >= REGION.minLat && x.coords[1] <= REGION.maxLat
      );
      return { events, timestamp, partial: !!feed.partial, failed: (feed.failedGroups || []).length, stale: (feed.staleGroups || []).length };
    } finally { clearTimeout(timeout); }
  }

  async function loadDirectFallback() {
    // Nur wenn der zentrale Feed nicht erreichbar oder veraltet ist.
    // Schonender Fallback: maximal ein Direktabruf pro Fahrergerät in 15 Minuten.
    if (lastDirectAttempt && Date.now() - lastDirectAttempt < 15 * 60 * 1000) return null;
    lastDirectAttempt = Date.now();
    // Kein kostenpflichtiger API-Dienst; begrenzte gleichzeitige Anfragen.
    const queue = ROADS.flatMap(r => KINDS.map(k => [r, k]));
    const results = [];
    let next = 0;
    async function worker() {
      for (;;) {
        const i = next++;
        if (i >= queue.length) return;
        const [r, k] = queue[i];
        try { results.push({ success: true, rows: await fetchOfficial(r, k) }); }
        catch (_) { results.push({ success: false, rows: [] }); }
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker));
    const good = results.filter(x => x.success);
    if (!good.length) return null;
    const seen = new Set();
    const events = good.flatMap(x => x.rows).filter(x => {
      if (seen.has(x.id)) return false;
      seen.add(x.id);
      return true;
    });
    return { events, partial: good.length !== queue.length };
  }

  async function refresh(force) {
    if (!active || document.hidden) return;
    if (fetching) return fetching;
    if (!force && lastAttempt && Date.now() - lastAttempt < TTL) return;
    if (lastAttempt && Date.now() - lastAttempt < 30000) return;
    lastAttempt = Date.now();
    setStatus('Amtliche Verkehrsmeldungen werden abgeglichen …');
    fetching = (async () => {
      let central = null;
      try { central = await loadCentralFeed(); } catch (error) {
        console.warn('TaxiPro: Zentraler Verkehrsfeed nicht verfügbar', error);
      }
      if (central) {
        data = central.events;
        updatedAt = central.timestamp;
        dataSource = 'GitHub-Feed';
        saveCached();
        const age = Date.now() - updatedAt;
        if (age <= MAX_FEED_AGE) {
          setStatus('Amtliche Autobahnmeldungen · Stand: ' + dateText(updatedAt) +
            (central.partial ? ' · Quellendaten teilweise unvollständig (' + central.failed + ' Ausfälle)' : '') +
            (central.stale ? ' · ' + central.stale + ' Teilbereiche aus Cache' : '') +
            ' · kein vollständiger Live-Verkehrsfluss');
          render();
          return;
        }
      }
      const direct = await loadDirectFallback();
      if (direct) {
        data = direct.events;
        updatedAt = Date.now();
        dataSource = 'Autobahn-API direkt';
        saveCached();
        setStatus('Amtliche Autobahnmeldungen · Stand: ' + dateText(updatedAt) +
          (direct.partial ? ' · Einige Datenquellen nicht erreichbar' : '') +
          ' · direkt geladen · keine vollständige Live-Stauflusskarte');
      } else if (updatedAt && Date.now() - updatedAt <= MAX_CACHE_AGE) {
        setStatus('Achtung: Verkehrsquellen aktuell nicht erreichbar. Veraltete Daten vom ' + dateText(updatedAt) + ' – nicht als aktuelle Meldungen verwenden.');
      } else {
        data = [];
        updatedAt = 0;
        dataSource = 'nicht verfügbar';
        setStatus('Verkehrsdaten derzeit nicht verfügbar. Karte und Standort können weiterhin nutzbar sein.');
      }
      render();
    })();
    try { await fetching; } finally { fetching = null; }
  }

  function locate() {
    const announce = message => { const el = $('tp-traffic-location-status'); if (el) el.textContent = message; };
    if (!navigator.geolocation) {
      announce('Standortfunktion ist auf diesem Gerät nicht verfügbar.');
      if (radiusKm) { radiusKm = null; const sel = $('tp-traffic-radius'); if (sel) sel.value = 'all'; render(); }
      return;
    }
    const button = $('tp-traffic-locate');
    if (button) button.disabled = true;
    navigator.geolocation.getCurrentPosition(pos => {
      if (button) button.disabled = false;
      if (!active) return;
      const coords = [pos.coords.longitude, pos.coords.latitude];
      if (!Number.isFinite(coords[0]) || !Number.isFinite(coords[1]) || Math.abs(coords[1]) > 90 || Math.abs(coords[0]) > 180) {
        announce('Ungültige GPS-Position erhalten.');
        return;
      }
      locationCoords = coords;
      if (map && maplibre) {
        if (positionMarker) positionMarker.remove();
        const el = document.createElement('div');
        el.style.cssText = 'width:16px;height:16px;background:#38bdf8;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 6px #38bdf840';
        positionMarker = new maplibre.Marker({ element: el }).setLngLat(coords).addTo(map);
        map.flyTo({ center: coords, zoom: 12.5, duration: 600 });
      }
      announce('Standort einmalig ermittelt. ' + (radiusKm ? 'Meldungen im Umkreis von ' + radiusKm + ' km.' : 'Du kannst jetzt einen Umkreis wählen.') + ' Kein GPS-Versand an die Zentrale.');
      render();
    }, () => {
      if (button) button.disabled = false;
      if (radiusKm) { radiusKm = null; const sel = $('tp-traffic-radius'); if (sel) sel.value = 'all'; render(); }
      announce('Standort nicht verfügbar oder Freigabe abgelehnt. Alle Meldungen bleiben sichtbar.');
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 });
  }
  function activate() {
    active = true;
    const panel = $('driver-traffic-panel');
    if (!panel) return;
    if (!timer) timer = setInterval(() => { if (active && !document.hidden) { updateFreshness(); refresh(false); } }, 60000);
    updateFreshness();
    ensureMap();
    refresh(false);
  }
  function deactivate() { active = false; }
  function init() {
    if (!$('driver-traffic-panel')) return;
    loadCached();
    $('tp-traffic-road')?.addEventListener('change', e => { road = e.target.value; render(); });
    $('tp-traffic-radius')?.addEventListener('change', e => {
      const selected = Number(e.target.value);
      radiusKm = [10, 25, 50].includes(selected) ? selected : null;
      if (radiusKm && !locationCoords) locate();
      else render();
    });
    $('tp-traffic-refresh')?.addEventListener('click', () => { ensureMap(); refresh(true); });
    $('tp-traffic-locate')?.addEventListener('click', locate);
    document.querySelectorAll('#tp-traffic-filters [data-filter]').forEach(button => {
      button.addEventListener('click', () => {
        filter = button.dataset.filter;
        document.querySelectorAll('#tp-traffic-filters [data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
        render();
      });
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && active) { ensureMap(); refresh(false); } });
  }
  window.TaxiTraffic = { activate, deactivate };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
