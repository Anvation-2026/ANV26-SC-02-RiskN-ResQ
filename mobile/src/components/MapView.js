import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { colors, riskColor } from '../theme';
import { USER, ZONES } from '../services/geo';

// Schematic map: real lat/lng projected onto a canvas. No map SDK needed.
const ZONE_RADIUS_KM = { LOW: 0, MEDIUM: 0.7, HIGH: 1.2, CRITICAL: 1.8 };

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

export default function MapView({ risk, roads, blocked, alternative, incidents, height = 340 }) {
  const [size, setSize] = useState({ w: 0, h: height });
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1600, useNativeDriver: Platform.OS !== 'web' }));
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const level = risk ? risk.level : 'LOW';
  const zoneCenter = ZONES[risk?.zone] || USER;
  const radiusKm = ZONE_RADIUS_KM[level];
  const blockedIds = new Set(blocked.map((r) => r.id));
  const altId = alternative ? alternative.road.id : null;
  const liveIncidents = incidents.filter((i) => !['REJECTED', 'RESOLVED'].includes(i.status)).slice(0, 12);

  const project = useMemo(() => {
    if (!size.w) return null;
    const pts = [[USER.latitude, USER.longitude]];
    roads.forEach((r) => r.coordinates.forEach((c) => pts.push(c)));
    liveIncidents.forEach((i) => pts.push([i.latitude, i.longitude]));
    const dLat = radiusKm / 111, dLng = radiusKm / 108;
    pts.push([zoneCenter.latitude + dLat, zoneCenter.longitude + dLng], [zoneCenter.latitude - dLat, zoneCenter.longitude - dLng]);
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
  }, [size, roads, liveIncidents.length, radiusKm, zoneCenter.latitude]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  const gridLines = [];
  for (let i = 1; i < 6; i++) {
    gridLines.push(<View key={`h${i}`} style={[styles.gh, { top: `${i * 16.6}%` }]} />);
    gridLines.push(<View key={`v${i}`} style={[styles.gv, { left: `${i * 16.6}%` }]} />);
  }

  const render = () => {
    if (!project) return null;
    const zc = project(zoneCenter.latitude, zoneCenter.longitude);
    const zr = radiusKm * project.pxPerKm;
    const zc2 = riskColor(level);
    const u = project(USER.latitude, USER.longitude);
    const ordered = [...roads].sort((a, b) => (blockedIds.has(a.id) ? 1 : 0) - (blockedIds.has(b.id) ? 1 : 0));
    return (
      <>
        {radiusKm > 0 && (
          <View pointerEvents="none" style={{ position: 'absolute', left: zc.x - zr, top: zc.y - zr, width: zr * 2, height: zr * 2, borderRadius: zr, backgroundColor: zc2 + '38', borderWidth: 2, borderColor: zc2 }} />
        )}
        {ordered.map((r) => {
          const pts = r.coordinates.map((c) => project(c[0], c[1]));
          const isBlocked = blockedIds.has(r.id), isAlt = r.id === altId;
          const color = isBlocked ? colors.HIGH : isAlt ? colors.route : '#94A3B8';
          const w = isBlocked || isAlt ? 8 : 6;
          const mid = pts[Math.floor(pts.length / 2)];
          return (
            <React.Fragment key={r.id}>
              {pts.slice(1).map((p, i) => <Line key={i} a={pts[i]} b={p} color="#fff" width={w + 4} />)}
              {pts.slice(1).map((p, i) => <Line key={`c${i}`} a={pts[i]} b={p} color={color} width={w} />)}
              <View pointerEvents="none" style={[styles.tag, { left: mid.x + 10, top: mid.y - 30, borderColor: color }]}>
                <Text style={[styles.tagText, { color }]}>{r.name}{isAlt ? ' · route' : ''}</Text>
              </View>
              {isBlocked && <Marker p={mid}><Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 24 }}>🚧</Text></Marker>}
            </React.Fragment>
          );
        })}
        {liveIncidents.map((i) => (
          <Marker key={i.id} p={project(i.latitude, i.longitude)}><Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 18 }}>⚠️</Text></Marker>
        ))}
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

export function MapLegend() {
  const items = [
    ['🔴', 'High Risk'], ['🚧', 'Blocked Road'], ['📍', 'Your Location'], ['🛣️', 'Recommended Route'], ['⚠️', 'Incident'],
  ];
  return (
    <View style={styles.legend}>
      {items.map(([i, t]) => (
        <View key={t} style={styles.legendItem}><Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14 }}>{i}</Text><Text style={styles.legendText}>{t}</Text></View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  map: { backgroundColor: '#E6EDF5', borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  gh: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#D3DDEA' },
  gv: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#D3DDEA' },
  tag: { position: 'absolute', backgroundColor: '#fff', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, borderWidth: 1 },
  tagText: { fontSize: 11, fontFamily: 'PlusJakartaSans_800ExtraBold' },
  ring: { position: 'absolute', width: 28, height: 28, borderRadius: 14, backgroundColor: colors.route },
  userDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.route, borderWidth: 3, borderColor: '#fff', boxShadow: '0 2px 6px rgba(0,0,0,0.3)' },
  youTag: { position: 'absolute', backgroundColor: colors.navy, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  youText: { color: '#fff', fontSize: 11, fontFamily: 'PlusJakartaSans_800ExtraBold' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  legendText: { fontSize: 12, fontFamily: 'PlusJakartaSans_600SemiBold', color: colors.text },
});
