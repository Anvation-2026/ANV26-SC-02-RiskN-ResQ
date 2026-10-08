// Web-only map (the browser cannot load react-native-maps). Metro picks this file on web; phones use MapView.js.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { colors, riskColor } from '../theme';
// Fallback point used only when no location is available (the real position comes from the `user` prop).
const DEFAULT_POINT = { latitude: 12.9716, longitude: 77.5946 };

// Schematic map: real lat/lng projected onto a canvas. No map SDK needed.
// Two modes: live backend data (default) or the disaster-response scenario, enabled by
// passing any of `zones`, `routeLine`, `markers`, `user`, `labelBlockedOnly`.
const ZONE_RADIUS_KM = { LOW: 0, MEDIUM: 0.7, MODERATE: 0.7, HIGH: 1.2, CRITICAL: 1.8 };

function Line({ a, b, color, width, opacity = 1 }) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute', left: (a.x + b.x) / 2 - len / 2, top: (a.y + b.y) / 2 - width / 2,
        width: len, height: width, borderRadius: width / 2, backgroundColor: color, opacity,
        transform: [{ rotate: `${(Math.atan2(dy, dx) * 180) / Math.PI}deg` }],
      }}
    />
  );
}

const Marker = ({ p, children, style }) => (
  <View pointerEvents="none" style={[{ position: 'absolute', left: p.x - 16, top: p.y - 16, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }, style]}>
    {children}
  </View>
);

// One bad coordinate (undefined, null, NaN, a string) must never take the whole map down: drop it instead.
const ok = (lat, lng) => typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng);
const okPair = (c) => (Array.isArray(c) ? ok(c[0], c[1]) : !!c && ok(c.latitude, c.longitude));
const toPair = (c) => (Array.isArray(c) ? [c[0], c[1]] : [c.latitude, c.longitude]);

export default function MapView({
  risk, roads: rawRoads, blocked: rawBlocked, alternative, incidents: rawIncidents, height = 340,
  zones: rawZones, routeLine: rawRoute, markers: rawMarkers, user: rawUser, labelBlockedOnly = false,
}) {
  const roads = (Array.isArray(rawRoads) ? rawRoads : [])
    .map((r) => ({ ...r, coordinates: Array.isArray(r.coordinates) ? r.coordinates.filter(okPair).map(toPair) : [] }))
    .filter((r) => r.coordinates.length > 1);
  const blocked = Array.isArray(rawBlocked) ? rawBlocked : [];
  const incidents = (Array.isArray(rawIncidents) ? rawIncidents : []).filter((i) => ok(i.latitude, i.longitude));
  const markers = (Array.isArray(rawMarkers) ? rawMarkers : []).filter((m) => ok(m.latitude, m.longitude));
  const zones = Array.isArray(rawZones) ? rawZones.filter((z) => ok(z.latitude, z.longitude)) : undefined;
  const routeLine = Array.isArray(rawRoute) ? rawRoute.filter(okPair).map(toPair) : undefined;
  const user = rawUser && ok(rawUser.latitude, rawUser.longitude) ? rawUser : undefined;
  const [size, setSize] = useState({ w: 0, h: height });
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1600, useNativeDriver: Platform.OS !== 'web' }));
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const me = user || DEFAULT_POINT;
  const level = risk ? risk.level : 'LOW';
  const zoneCenter = me; // risk zone is drawn around the user's position
  // Zones to draw: scenario zones if given, otherwise the single backend risk zone.
  const zoneList = useMemo(
    () => zones || [{ latitude: zoneCenter.latitude, longitude: zoneCenter.longitude, radiusKm: ZONE_RADIUS_KM[level], level }],
    [zones, level, zoneCenter.latitude, zoneCenter.longitude]
  );
  const blockedIds = new Set(blocked.map((r) => r && r.id));
  const altId = alternative && alternative.road ? alternative.road.id : null;
  const liveIncidents = incidents.filter((i) => !['REJECTED', 'RESOLVED'].includes(i.status)).slice(0, 12);

  const project = useMemo(() => {
    if (!size.w) return null;
    const pts = [[me.latitude, me.longitude]];
    roads.forEach((r) => r.coordinates.forEach((c) => pts.push(c)));
    liveIncidents.forEach((i) => pts.push([i.latitude, i.longitude]));
    (routeLine || []).forEach((c) => pts.push(c));
    markers.filter((m) => m.fit !== false).forEach((m) => pts.push([m.latitude, m.longitude]));
    // Scenario mode fits roads/route/markers (zones may be much larger and are simply clipped).
    if (!zones) zoneList.forEach((z) => {
      const dLat = z.radiusKm / 111, dLng = z.radiusKm / 108;
      pts.push([z.latitude + dLat, z.longitude + dLng], [z.latitude - dLat, z.longitude - dLng]);
    });
    const lats = pts.map((p) => p[0]), lngs = pts.map((p) => p[1]);
    const midLat = (Math.min(...lats) + Math.max(...lats)) / 2, midLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    const kx = Math.cos((midLat * Math.PI) / 180);
    const spanX = Math.max(0.001, (Math.max(...lngs) - Math.min(...lngs)) * kx);
    const spanY = Math.max(0.001, Math.max(...lats) - Math.min(...lats));
    const pad = 34;
    const s = Math.min((size.w - 2 * pad) / spanX, (size.h - 2 * pad) / spanY);
    const fn = (lat, lng) => ({ x: size.w / 2 + (lng - midLng) * kx * s, y: size.h / 2 - (lat - midLat) * s });
    fn.pxPerKm = s / 111;
    return fn;
  }, [size, roads, liveIncidents.length, zoneList, zones, routeLine, markers, me.latitude, me.longitude]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  const gridLines = [];
  for (let i = 1; i < 6; i++) {
    gridLines.push(<View key={`h${i}`} style={[styles.gh, { top: `${i * 16.6}%` }]} />);
    gridLines.push(<View key={`v${i}`} style={[styles.gv, { left: `${i * 16.6}%` }]} />);
  }

  const render = () => {
    if (!project) return null;
    const u = project(me.latitude, me.longitude);
    const ordered = [...roads].filter((r) => Array.isArray(r.coordinates) && r.coordinates.length > 1).sort((a, b) => (a.status === 'BLOCKED' ? 1 : 0) - (b.status === 'BLOCKED' ? 1 : 0));
    const routePts = (routeLine || []).map((c) => project(c[0], c[1]));
    return (
      <>
        {zoneList.filter((z) => z.radiusKm > 0).map((z, i) => {
          const c = project(z.latitude, z.longitude), r = z.radiusKm * project.pxPerKm, col = riskColor(z.level);
          return <View key={i} pointerEvents="none" style={{ position: 'absolute', left: c.x - r, top: c.y - r, width: r * 2, height: r * 2, borderRadius: r, backgroundColor: col + '38', borderWidth: 2, borderColor: col }} />;
        })}
        {ordered.map((r) => {
          const pts = r.coordinates.map((c) => project(c[0], c[1]));
          const isBlocked = blockedIds.has(r.id) || r.status === 'BLOCKED', isAlt = r.id === altId;
          const color = isBlocked ? colors.HIGH : isAlt ? colors.route : '#94A3B8';
          const w = isBlocked || isAlt ? 8 : 6;
          const mid = pts[Math.floor(pts.length / 2)];
          const showTag = !labelBlockedOnly || isBlocked;
          return (
            <React.Fragment key={r.id}>
              {pts.slice(1).map((p, i) => <Line key={i} a={pts[i]} b={p} color="#fff" width={w + 4} />)}
              {pts.slice(1).map((p, i) => <Line key={`c${i}`} a={pts[i]} b={p} color={color} width={w} />)}
              {showTag && (
                <View pointerEvents="none" style={[styles.tag, { left: mid.x + 10, top: mid.y - 30, borderColor: color }]}>
                  <Text style={[styles.tagText, { color }]}>{r.name}{isAlt ? ' · route' : ''}</Text>
                </View>
              )}
              {isBlocked && <Marker p={mid}><Text style={{ fontSize: 24 }}>🚧</Text></Marker>}
            </React.Fragment>
          );
        })}
        {routePts.slice(1).map((p, i) => <Line key={`rw${i}`} a={routePts[i]} b={p} color="#fff" width={14} />)}
        {routePts.slice(1).map((p, i) => <Line key={`rc${i}`} a={routePts[i]} b={p} color={colors.route} width={9} />)}
        {liveIncidents.map((i) => (
          <Marker key={i.id} p={project(i.latitude, i.longitude)}><Text style={{ fontSize: 18 }}>⚠️</Text></Marker>
        ))}
        {markers.map((m) => {
          const p = project(m.latitude, m.longitude);
          return (
            <React.Fragment key={m.id}>
              <Marker p={p}>
                <View style={[styles.pin, { backgroundColor: m.color || colors.LOW }, m.highlight && styles.pinHi]}>
                  <Text style={{ fontSize: m.highlight ? 15 : 12 }}>{m.emoji}</Text>
                </View>
              </Marker>
              {m.label && (m.highlight || /relief/i.test(m.label)) ? (
                <View pointerEvents="none" style={[styles.tag, { left: p.x + 14, top: p.y - 8, borderColor: m.color || colors.LOW }]}>
                  <Text style={[styles.tagText, { color: m.color || colors.LOW }]}>{m.label}</Text>
                </View>
              ) : null}
            </React.Fragment>
          );
        })}
        <Animated.View pointerEvents="none" style={[styles.ring, { left: u.x - 14, top: u.y - 14, opacity: ringOpacity, transform: [{ scale: ringScale }] }]} />
        <Marker p={u}><View style={styles.userDot} /></Marker>
        <View pointerEvents="none" style={[styles.youTag, { left: u.x + 12, top: u.y + 8 }]}><Text style={styles.youText}>📍 You</Text></View>
      </>
    );
  };

  return (
    <View style={[styles.map, { height }]} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {gridLines}
      {render()}
    </View>
  );
}

const DEFAULT_LEGEND = [
  ['🔴', 'High Risk'], ['🚧', 'Blocked Road'], ['📍', 'Your Location'], ['🛣️', 'Recommended Route'], ['⚠️', 'Incident'],
];

export function MapLegend({ items = DEFAULT_LEGEND }) {
  return (
    <View style={styles.legend}>
      {items.map(([i, t]) => (
        <View key={t} style={styles.legendItem}><Text style={{ fontSize: 14 }}>{i}</Text><Text style={styles.legendText}>{t}</Text></View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  map: { backgroundColor: '#E6EDF5', borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  gh: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#D3DDEA' },
  gv: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#D3DDEA' },
  tag: { position: 'absolute', backgroundColor: '#fff', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, borderWidth: 1 },
  tagText: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 11 },
  ring: { position: 'absolute', width: 28, height: 28, borderRadius: 14, backgroundColor: colors.route },
  userDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.route, borderWidth: 3, borderColor: '#fff', boxShadow: '0 2px 6px rgba(0,0,0,0.3)' },
  pin: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  pinHi: { width: 32, height: 32, borderRadius: 16, borderWidth: 3 },
  youTag: { position: 'absolute', backgroundColor: colors.navy, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  youText: { fontFamily: 'PlusJakartaSans_800ExtraBold', color: '#fff', fontSize: 11 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  legendText: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: colors.text },
});
