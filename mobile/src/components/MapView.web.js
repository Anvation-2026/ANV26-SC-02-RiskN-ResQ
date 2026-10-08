// Real map for the browser: OpenStreetMap tiles through Leaflet (no API key needed).
// Metro uses this file on web; phones use MapView.js (react-native-maps, Apple/Google maps).
// Same props as the phone map: user, risk, zones, roads, blocked, incidents, markers, routeLine, alternative.
import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { colors, riskColor } from '../theme';
import { useT } from '../i18n';
import { cellCorners, drawableCells, drawableRain, RAIN_COLOR, RAIN_FILL, RAIN_RADIUS_KM, RISK_COLOR, RISK_FILL, SAT_COLOR, TERRAIN_COLOR } from './rain';

const DEFAULT_POINT = { latitude: 12.9716, longitude: 77.5946 }; // used only when no location is available
const ZONE_RADIUS_KM = { LOW: 0, MEDIUM: 0.7, MODERATE: 0.7, HIGH: 1.2, CRITICAL: 1.8 };
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// One bad coordinate (undefined, null, NaN, a string) must never take the whole map down: drop it instead.
const ok = (lat, lng) => typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng);
const okPair = (c) => (Array.isArray(c) ? ok(c[0], c[1]) : !!c && ok(c.latitude, c.longitude));
const toPair = (c) => (Array.isArray(c) ? [c[0], c[1]] : [c.latitude, c.longitude]);

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const emoji = (html, size = 26) => L.divIcon({ html: `<div style="font-size:${size - 8}px;line-height:${size}px;text-align:center;text-shadow:0 1px 3px rgba(0,0,0,.35)">${html}</div>`, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
const dot = (color, size = 22, ring = true) => L.divIcon({
  html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)${ring ? `,0 0 0 8px ${color}33` : ''}"></div>`,
  className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
});

export default function MapView({
  risk, roads: rawRoads, blocked: rawBlocked, alternative, incidents: rawIncidents, height = 340,
  zones: rawZones, routeLine: rawRoute, markers: rawMarkers, user: rawUser, labelBlockedOnly = false,
  rainAreas = [], onRainPress, places = [], onPlacePress,
  riskCells = [], satelliteCells = [], hotspots = [], terrainCells = [], cellHalf, onIntelPress,
}) {
  const intelCb = useRef(onIntelPress);
  intelCb.current = onIntelPress;
  const rainCb = useRef(onRainPress);
  rainCb.current = onRainPress;
  const placeCb = useRef(onPlacePress);
  placeCb.current = onPlacePress;
  const el = useRef(null);
  const state = useRef({ map: null, layer: null, fitted: '', bounds: null });

  const roads = (Array.isArray(rawRoads) ? rawRoads : [])
    .map((r) => ({ ...r, coordinates: Array.isArray(r.coordinates) ? r.coordinates.filter(okPair).map(toPair) : [] }))
    .filter((r) => r.coordinates.length > 1);
  const blocked = Array.isArray(rawBlocked) ? rawBlocked : [];
  const incidents = (Array.isArray(rawIncidents) ? rawIncidents : []).filter((i) => ok(i.latitude, i.longitude) && !['REJECTED', 'RESOLVED'].includes(i.status));
  const markers = (Array.isArray(rawMarkers) ? rawMarkers : []).filter((m) => ok(m.latitude, m.longitude));
  const routeLine = Array.isArray(rawRoute) ? rawRoute.filter(okPair).map(toPair) : [];
  const user = rawUser && ok(rawUser.latitude, rawUser.longitude) ? rawUser : null;
  const level = risk ? risk.level : 'LOW';

  // Create the map once.
  useEffect(() => {
    const map = L.map(el.current, { zoomControl: true, attributionControl: true, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView([(user || DEFAULT_POINT).latitude, (user || DEFAULT_POINT).longitude], 14);
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
    state.current.map = map;
    state.current.layer = L.layerGroup().addTo(map);
    // When the container gets its real size (screen shown, window resized) refresh the tiles and re-fit the view.
    const refit = () => {
      map.invalidateSize({ animate: false });
      // A map created while hidden or zero-sized keeps a stale tile origin: force a full reset once it has a real size.
      map.setView(map.getCenter(), map.getZoom(), { reset: true, animate: false });
      if (state.current.bounds) map.fitBounds(state.current.bounds, { padding: [40, 40], maxZoom: 16, animate: false });
      // layout may still be settling: fit once more shortly afterwards with the final size
      setTimeout(() => {
        map.invalidateSize({ animate: false });
        if (state.current.bounds) map.fitBounds(state.current.bounds, { padding: [40, 40], maxZoom: 16, animate: false });
      }, 300);
    };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(refit) : null;
    if (ro) ro.observe(el.current);
    // Safety net: whenever the real container size differs from the size the map believes it has (for example the
    // screen was hidden when the map was created), refit. Reading two numbers every 400 ms is negligible.
    const guard = setInterval(() => {
      const node = el.current;
      if (!node || !node.clientWidth || !node.clientHeight) return;
      const sz = map.getSize();
      if (sz.x !== node.clientWidth || sz.y !== node.clientHeight) refit();
    }, 400);
    setTimeout(() => map.invalidateSize(), 50);
    return () => { clearInterval(guard); if (ro) ro.disconnect(); map.remove(); state.current = { map: null, layer: null, fitted: '', bounds: null }; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Redraw the overlays whenever the data changes.
  useEffect(() => {
    const { map, layer } = state.current;
    if (!map) return;
    layer.clearLayers();
    const bounds = [];
    const blockedIds = new Set(blocked.map((r) => r && r.id));
    const altId = alternative && alternative.road ? alternative.road.id : null;

    // terrain susceptibility (ground that collects water; not evidence of flooding), then flood-risk cells, under everything else
    if (cellHalf) {
      (Array.isArray(terrainCells) ? terrainCells : []).forEach((cell) => {
        L.polygon(cellCorners(cell, cellHalf), { color: TERRAIN_COLOR, weight: 0, fillColor: TERRAIN_COLOR, fillOpacity: 0.14, interactive: false }).addTo(layer);
      });
      drawableCells(riskCells).forEach((cell) => {
        // keep the cell you are in, and any cell that is MEDIUM or worse, inside the view
        const mine = user && Math.abs(cell.latitude - user.latitude) <= cellHalf.lat && Math.abs(cell.longitude - user.longitude) <= cellHalf.lng;
        if (mine || cell.risk_level !== 'LOW') bounds.push([cell.latitude - cellHalf.lat, cell.longitude - cellHalf.lng], [cell.latitude + cellHalf.lat, cell.longitude + cellHalf.lng]);
        const col = RISK_COLOR[cell.risk_level];
        L.polygon(cellCorners(cell, cellHalf), { color: col, weight: cell.risk_level === 'LOW' ? 0 : 1, fillColor: col, fillOpacity: RISK_FILL[cell.risk_level] })
          .on('click', () => intelCb.current && intelCb.current({ kind: 'cell', cell })).addTo(layer);
      });
      (Array.isArray(satelliteCells) ? satelliteCells : []).forEach((cell) => {
        L.polygon(cellCorners(cell, cellHalf), { color: SAT_COLOR, weight: 2, dashArray: '6 5', fillColor: SAT_COLOR, fillOpacity: 0.12 })
          .on('click', () => intelCb.current && intelCb.current({ kind: 'satellite', cell })).addTo(layer);
        L.marker([cell.latitude, cell.longitude], { icon: emoji('🛰️', 26) }).on('click', () => intelCb.current && intelCb.current({ kind: 'satellite', cell })).addTo(layer);
        bounds.push([cell.latitude, cell.longitude]);
      });
    }
    (Array.isArray(hotspots) ? hotspots : []).filter((h) => ok(h.latitude, h.longitude)).forEach((h) => {
      L.circle([h.latitude, h.longitude], { radius: h.radius_km * 1000, color: '#B91C1C', weight: 2, dashArray: '2 6', fill: false })
        .on('click', () => intelCb.current && intelCb.current({ kind: 'hotspot', hotspot: h })).addTo(layer);
      L.marker([h.latitude, h.longitude], { icon: emoji('❗', 26) }).on('click', () => intelCb.current && intelCb.current({ kind: 'hotspot', hotspot: h })).addTo(layer);
    });

    // heavy-rainfall areas (weather observations, drawn under everything else; tap for details)
    drawableRain(rainAreas).forEach((a) => {
      L.circle([a.latitude, a.longitude], { radius: RAIN_RADIUS_KM * 1000, color: RAIN_COLOR[a.rain_level], weight: 1, fillColor: RAIN_COLOR[a.rain_level], fillOpacity: RAIN_FILL[a.rain_level] })
        .on('click', () => rainCb.current && rainCb.current(a)).addTo(layer);
      if (a.rain_level !== 'MODERATE') bounds.push([a.latitude, a.longitude]); // heavy areas stay in view
    });

    // flood-risk zones
    const zoneList = Array.isArray(rawZones)
      ? rawZones.filter((z) => ok(z.latitude, z.longitude)).map((z) => ({ lat: z.latitude, lng: z.longitude, km: z.radiusKm, level: z.level }))
      : user && ZONE_RADIUS_KM[level] ? [{ lat: user.latitude, lng: user.longitude, km: ZONE_RADIUS_KM[level], level }] : [];
    zoneList.filter((z) => z.km > 0).forEach((z) => {
      const c = riskColor(z.level);
      const circle = L.circle([z.lat, z.lng], { radius: z.km * 1000, color: c, weight: 2, fillColor: c, fillOpacity: 0.2 }).bindTooltip(`${z.level} flood risk zone`).addTo(layer);
      const cb = circle.getBounds(); bounds.push([cb.getSouth(), cb.getWest()], [cb.getNorth(), cb.getEast()]);
    });

    // roads (blocked ones red + dashed, with a barrier marker)
    roads.forEach((r) => {
      const isBlocked = blockedIds.has(r.id) || r.status === 'BLOCKED';
      const isAlt = r.id === altId;
      const potential = !isBlocked && r.risk_state === 'POTENTIALLY_AFFECTED';
      const color = isBlocked ? colors.HIGH : isAlt ? colors.route : potential ? '#F97316' : r.low_lying ? '#F59E0B' : '#64748B';
      L.polyline(r.coordinates, { color: '#fff', weight: 11, opacity: 0.9 }).addTo(layer);
      L.polyline(r.coordinates, { color, weight: isBlocked || isAlt ? 7 : 5, opacity: 0.95, dashArray: isBlocked ? '10 8' : potential ? '4 6' : null })
        .bindTooltip(esc(r.name || 'Road') + (isBlocked ? ' (blocked)' : potential ? ' (potentially affected)' : ''), { permanent: !labelBlockedOnly || isBlocked, direction: 'top', className: 'rr-tip' }).addTo(layer);
      if (isBlocked) L.marker(r.coordinates[Math.floor(r.coordinates.length / 2)], { icon: emoji('🚧', 30), interactive: false }).addTo(layer);
      if (isBlocked || isAlt) r.coordinates.forEach((p) => bounds.push(p)); // ordinary roads must not zoom the map out
    });

    // recommended route (drawn above roads)
    if (routeLine.length > 1) {
      L.polyline(routeLine, { color: '#fff', weight: 12 }).addTo(layer);
      L.polyline(routeLine, { color: colors.route, weight: 7 }).bindTooltip('Recommended route').addTo(layer);
      routeLine.forEach((p) => bounds.push(p));
    }

    // reported incidents
    incidents.forEach((i) => {
      L.marker([i.latitude, i.longitude], { icon: emoji('⚠️', 28) })
        .bindTooltip(esc(i.description || String(i.type || 'Incident').replace(/_/g, ' '))).addTo(layer);
      bounds.push([i.latitude, i.longitude]);
    });

    // volunteers / requests / destination
    markers.forEach((m) => {
      L.marker([m.latitude, m.longitude], { icon: dot(m.color || colors.LOW, m.highlight ? 26 : 18, !!m.highlight) })
        .bindTooltip(esc(m.label || ''), { permanent: !!(m.label && m.highlight), direction: 'right', className: 'rr-tip' }).addTo(layer);
      bounds.push([m.latitude, m.longitude]);
    });

    // hospitals and shelters (small round badges; tap for the name)
    (Array.isArray(places) ? places : []).filter((p) => ok(p.latitude, p.longitude)).forEach((p) => {
      const hospital = p.kind === 'HOSPITAL';
      L.marker([p.latitude, p.longitude], { icon: dot(hospital ? '#DC2626' : '#0F766E', 16, false) })
        .bindTooltip(esc(`${hospital ? 'Hospital' : 'Shelter'}: ${p.name}`)).on('click', () => placeCb.current && placeCb.current(p)).addTo(layer);
    });

    // you
    if (user) {
      L.marker([user.latitude, user.longitude], { icon: dot(colors.route, 22, true), zIndexOffset: 1000 })
        .bindTooltip('You', { permanent: true, direction: 'bottom', className: 'rr-you' }).addTo(layer);
      bounds.push([user.latitude, user.longitude]);
    }

    // Fit the view when the set of things changes, not on every refresh (so panning and zooming are not undone).
    const key = JSON.stringify([user && [user.latitude.toFixed(3), user.longitude.toFixed(3)], drawableRain(rainAreas).length, drawableCells(riskCells).length, satelliteCells.length, hotspots.length, roads.length, routeLine.length, markers.length, incidents.length]);
    if (key !== state.current.fitted && bounds.length) {
      state.current.fitted = key;
      state.current.bounds = L.latLngBounds(bounds);
      map.invalidateSize({ animate: false });
      map.setView(map.getCenter(), map.getZoom(), { reset: true, animate: false });
      map.fitBounds(state.current.bounds, { padding: [40, 40], maxZoom: 16, animate: false });
    }
  }, [JSON.stringify(rawRoads), JSON.stringify(rawBlocked), JSON.stringify(rawIncidents), JSON.stringify(rawMarkers), JSON.stringify(rawRoute), // eslint-disable-line react-hooks/exhaustive-deps
    JSON.stringify(rawZones), JSON.stringify(rainAreas), JSON.stringify(places), JSON.stringify(riskCells), JSON.stringify(satelliteCells),
    JSON.stringify(hotspots), JSON.stringify(terrainCells), level, user && user.latitude, user && user.longitude, alternative && alternative.road && alternative.road.id, labelBlockedOnly]);

  return (
    <View style={[styles.map, { height }]}>
      {React.createElement('div', { ref: el, style: { width: '100%', height: '100%' } })}
    </View>
  );
}

const LEGEND = [
  ['📍', 'legend.you'], ['🟢', 'legend.lowRisk'], ['🟡', 'legend.medium'], ['🟠', 'legend.high'], ['🔴', 'legend.critical'], ['🌧️', 'legend.rain'],
  ['🛰️', 'legend.satellite'], ['❗', 'legend.hotspot'], ['🚧', 'legend.blocked'], ['⚠️', 'legend.incident'], ['🛣️', 'legend.route'],
  ['🏥', 'legend.places'], ['🟧', 'legend.potential'],
];

export function MapLegend({ items }) {
  const t = useT();
  const list = items || LEGEND.map(([i, k]) => [i, t(k)]);
  return (
    <View style={styles.legend}>
      {list.map(([i, label]) => (
        <View key={label} style={styles.legendItem}><Text style={{ fontSize: 14 }}>{i}</Text><Text style={styles.legendText}>{label}</Text></View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  map: { backgroundColor: '#E6EDF5', borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  legendText: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: colors.text },
});
