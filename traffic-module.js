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
  const TTL = 15 * 60 * 1000;
  const MAX_CACHE_AGE = 30 * 60 * 1000;
  const CACHE_KEY = 'tp_public_traffic_cache_v1';
  const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  const MAP_LIB = 'https://unpkg.com/maplibre-gl@6.19.0/dist/maplibre-gl.mjs';
  let active = false, map = null, maplibre = null, libPromise = null, positionMarker = null;
  let data = [], updatedAt = 0, fetching = null, lastAttempt = 0, filter = 'all', road = 'all';
  let markers = [], timer = null;

  const $ = id => document.getElementById(id);
  function setStatus(message) {
    const el = $('tp-traffic-status');
    if (el) el.textContent = message;
  }
  function dateText(timestamp) {
    return timestamp ? new Date(timestamp).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–';
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
      updatedAt = saved.updatedAt;
    } catch (_) {}
  }
  function saveCached() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: data.slice(0, 450), updatedAt })); } catch (_) {}
  }
  function getVisible() {
    const selected = data.filter(x => (filter === 'all' || x.kind === filter) && (road === 'all' || x.autobahn === road));
    if (!map) return selected;
    const center = map.getCenter();
    return selected.sort((a, b) => {
      const da = (a.coords[0] - center.lng) ** 2 + (a.coords[1] - center.lat) ** 2;
      const db = (b.coords[0] - center.lng) ** 2 + (b.coords[1] - center.lat) ** 2;
      return da - db;
    });
  }
  function render() {
    const list = $('tp-traffic-list');
    if (!list) return;
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
    setStatus('Karte wird geladen …');
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
        if (!updatedAt && !fetching) setStatus('Kartenmaterial konnte teilweise nicht geladen werden. Internetverbindung prüfen.');
        console.warn('TaxiPro Verkehrskarte:', e.error);
      });
    } catch (e) {
      console.warn('TaxiPro: MapLibre nicht verfügbar', e);
      setStatus('Karte nicht verfügbar. Verkehrsmeldungen sind weiterhin unten sichtbar.');
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
  async function refresh(force) {
    if (!active || document.hidden) return;
    if (fetching) return fetching;
    if (!force && updatedAt && Date.now() - updatedAt < TTL) {
      setStatus('Amtliche Meldungen · Stand: ' + dateText(updatedAt) + ' · Aktualisierung höchstens alle 15 Minuten');
      render();
      return;
    }
    if (Date.now() - lastAttempt < 30000) return;
    lastAttempt = Date.now();
    setStatus('Amtliche Meldungen für die Region werden aktualisiert …');
    fetching = (async () => {
      const requests = ROADS.flatMap(r => KINDS.map(k => [r, k]));
      const outcomes = await Promise.allSettled(requests.map(([r, k]) => fetchOfficial(r, k)));
      const ok = outcomes.filter(o => o.status === 'fulfilled');
      if (ok.length) {
        const all = ok.flatMap(o => o.value);
        const ids = new Set();
        data = all.filter(x => { if (ids.has(x.id)) return false; ids.add(x.id); return true; });
        updatedAt = Date.now(); saveCached();
        setStatus('Amtliche Meldungen · Stand: ' + dateText(updatedAt) + (ok.length < requests.length ? ' · Einzelne Datenquellen nicht erreichbar' : ' · Automatische Aktualisierung alle 15 Minuten'));
      } else {
        setStatus(updatedAt && Date.now() - updatedAt <= MAX_CACHE_AGE
          ? 'Keine Verbindung zur Autobahn-Datenquelle. Angezeigt werden ältere Meldungen vom ' + dateText(updatedAt) + '.'
          : 'Amtliche Verkehrsmeldungen derzeit nicht verfügbar. Keine Live-Daten vorhanden.');
        if (!updatedAt || Date.now() - updatedAt > MAX_CACHE_AGE) { data = []; updatedAt = 0; }
      }
      render();
    })();
    try { await fetching; } finally { fetching = null; }
  }
  function locate() {
    if (!navigator.geolocation) { setStatus('Standortfunktion auf diesem Gerät nicht verfügbar.'); return; }
    const button = $('tp-traffic-locate');
    if (button) button.disabled = true;
    navigator.geolocation.getCurrentPosition(pos => {
      if (button) button.disabled = false;
      if (!active || !map || !maplibre) return;
      const coords = [pos.coords.longitude, pos.coords.latitude];
      if (positionMarker) positionMarker.remove();
      const el = document.createElement('div');
      el.style.cssText = 'width:16px;height:16px;background:#38bdf8;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 6px #38bdf840';
      positionMarker = new maplibre.Marker({ element: el }).setLngLat(coords).addTo(map);
      map.flyTo({ center: coords, zoom: 13, duration: 600 });
      setStatus('Standort nur auf deinem Gerät angezeigt. Keine GPS-Übertragung an die Taxi-Zentrale.');
    }, () => {
      if (button) button.disabled = false;
      setStatus('Standort nicht verfügbar oder Freigabe abgelehnt.');
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 });
  }
  function activate() {
    active = true;
    const panel = $('driver-traffic-panel');
    if (!panel) return;
    if (!timer) timer = setInterval(() => { if (active && !document.hidden) refresh(false); }, 60000);
    ensureMap();
    refresh(false);
  }
  function deactivate() { active = false; }
  function init() {
    if (!$('driver-traffic-panel')) return;
    loadCached();
    $('tp-traffic-road')?.addEventListener('change', e => { road = e.target.value; render(); });
    $('tp-traffic-refresh')?.addEventListener('click', () => refresh(true));
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
