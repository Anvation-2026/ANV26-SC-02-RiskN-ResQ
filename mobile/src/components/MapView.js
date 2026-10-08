import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import RNMapView, {
  Circle as RNCircle,
  Marker as RNMarker,
  Polyline as RNPolyline,
  PROVIDER_DEFAULT,
} from 'react-native-maps';
import Feather from '@expo/vector-icons/Feather';
import { colors, radius, riskColor, shadow } from '../theme';
import { USER, ZONES } from '../services/geo';

const ZONE_RADIUS_KM = { LOW: 0, MEDIUM: 0.7, MODERATE: 0.7, HIGH: 1.2, CRITICAL: 1.8 };

const DEFAULT_REGION = {
  latitude: 12.9716,
  longitude: 77.5946,
  latitudeDelta: 0.045,
  longitudeDelta: 0.045,
};

export function MapLegend({ items }) {
  const defaultItems = [
    { label: 'High Risk', color: colors.HIGH, type: 'dot' },
    { label: 'Blocked', color: colors.HIGH, type: 'dashed' },
    { label: 'Location', color: colors.primary, type: 'dot' },
    { label: 'Recommended', color: colors.route, type: 'line' },
  ];

  const chips = useMemo(() => {
    if (!items || !Array.isArray(items)) return defaultItems;
    return items.map((item) => {
      let label = '';
      if (Array.isArray(item)) {
        label = String(item[1] || item[0] || '');
      } else if (item && typeof item === 'object') {
        label = String(item.label || item.name || '');
      } else {
        label = String(item || '');
      }
      let type = 'dot';
      let color = colors.primary;
      if (label.includes('Risk')) { color = colors.HIGH; type = 'dot'; }
      else if (label.includes('Blocked')) { color = colors.HIGH; type = 'dashed'; }
      else if (label.includes('Route') || label.includes('Recommended')) { color = colors.route; type = 'line'; }
      else if (label.includes('Resource')) { color = '#0F766E'; type = 'dot'; }
      return { label, color, type };
    });
  }, [items]);

  return (
    <View style={legendStyles.container}>
      {chips.map((item, idx) => (
        <View key={idx} style={legendStyles.chip}>
          {item.type === 'dashed' ? (
            <View style={legendStyles.dashedLine} />
          ) : item.type === 'line' ? (
            <View style={[legendStyles.solidLine, { backgroundColor: item.color }]} />
          ) : (
            <View style={[legendStyles.dot, { backgroundColor: item.color }]} />
          )}
          <Text style={legendStyles.label}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

const legendStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 2,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 5,
  },
  solidLine: {
    width: 12,
    height: 3,
    borderRadius: 1.5,
    marginRight: 5,
  },
  dashedLine: {
    width: 12,
    height: 3,
    borderRadius: 1,
    borderWidth: 1,
    borderColor: colors.HIGH,
    borderStyle: 'dashed',
    marginRight: 5,
  },
  label: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    color: '#475569',
  },
});

export function normalizeCoord(c) {
  if (!c) return null;
  let lat, lng;
  if (Array.isArray(c)) {
    lat = Number(c[0]);
    lng = Number(c[1]);
  } else if (typeof c === 'object') {
    lat = Number(c.latitude ?? c.lat);
    lng = Number(c.longitude ?? c.lng ?? c.lon);
  }
  if (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !isNaN(lat) &&
    !isNaN(lng) &&
    isFinite(lat) &&
    isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  ) {
    return { latitude: lat, longitude: lng };
  }
  return null;
}

export default function MapView({
  risk,
  roads = [],
  blocked = [],
  alternative,
  incidents = [],
  height = 340,
  zones,
  routeLine,
  markers = [],
  user,
  labelBlockedOnly = false,
}) {
  const mapRef = useRef(null);
  const me = user || USER;
  const level = risk ? risk.level : 'LOW';
  const zoneCenter = (risk && ZONES[risk.zone]) || USER;

  const validZones = useMemo(() => {
    const list = zones || [
      { latitude: zoneCenter.latitude, longitude: zoneCenter.longitude, radiusKm: ZONE_RADIUS_KM[level] || 0.8, level }
    ];
    if (!Array.isArray(list)) return [];
    return list
      .map((z) => {
        if (!z) return null;
        const pt = normalizeCoord(z);
        if (!pt || !z.radiusKm || z.radiusKm <= 0) return null;
        return { ...pt, radiusKm: z.radiusKm, level: z.level || 'LOW' };
      })
      .filter(Boolean);
  }, [zones, level, zoneCenter]);

  const blockedIds = useMemo(() => new Set((blocked || []).map((r) => r && r.id).filter(Boolean)), [blocked]);
  const altId = alternative && alternative.road ? alternative.road.id : null;

  // Zoom control handlers
  const handleZoom = (inFactor) => {
    if (!mapRef.current) return;
    mapRef.current.getCamera().then((camera) => {
      if (camera) {
        const factor = inFactor ? 0.5 : 2.0;
        camera.altitude = (camera.altitude || 10000) * factor;
        camera.zoom = (camera.zoom || 14) + (inFactor ? 1 : -1);
        mapRef.current.animateCamera(camera, { duration: 250 });
      }
    }).catch(() => {});
  };

  const handleRecenter = () => {
    if (!mapRef.current) return;
    const pt = normalizeCoord(me) || DEFAULT_REGION;
    mapRef.current.animateToRegion({
      latitude: pt.latitude,
      longitude: pt.longitude,
      latitudeDelta: 0.035,
      longitudeDelta: 0.035,
    }, 400);
  };

  // Build route polyline coordinates safely
  const activeRouteCoords = useMemo(() => {
    if (!routeLine || !Array.isArray(routeLine)) return null;
    const pts = routeLine.map(normalizeCoord).filter(Boolean);
    return pts.length >= 2 ? pts : null;
  }, [routeLine]);

  // Fit camera when active route updates
  useEffect(() => {
    if (!mapRef.current || !activeRouteCoords || activeRouteCoords.length < 2) return;
    try {
      mapRef.current.fitToCoordinates(activeRouteCoords, {
        edgePadding: { top: 45, right: 45, bottom: 45, left: 45 },
        animated: true,
      });
    } catch (e) {
      /* camera fit safety */
    }
  }, [activeRouteCoords]);

  // Process roads safely
  const validRoads = useMemo(() => {
    if (!Array.isArray(roads)) return [];
    return roads
      .map((road, idx) => {
        if (!road || !Array.isArray(road.coordinates)) return null;
        const pts = road.coordinates.map(normalizeCoord).filter(Boolean);
        if (pts.length < 2) return null;
        const midIdx = Math.floor(pts.length / 2);
        return {
          id: road.id || `road-${idx}`,
          name: road.name || 'Corridor',
          status: road.status || 'OPEN',
          pts,
          midCoord: pts[midIdx],
        };
      })
      .filter(Boolean);
  }, [roads]);

  // Process markers safely
  const validMarkers = useMemo(() => {
    if (!Array.isArray(markers)) return [];
    return markers
      .map((m) => {
        if (!m) return null;
        const pt = normalizeCoord(m);
        if (!pt) return null;
        return { ...m, ...pt };
      })
      .filter(Boolean);
  }, [markers]);

  // Process incidents safely
  const validIncidents = useMemo(() => {
    if (!Array.isArray(incidents)) return [];
    return incidents
      .slice(0, 8)
      .map((inc) => {
        if (!inc) return null;
        const pt = normalizeCoord(inc);
        if (!pt) return null;
        return { ...inc, ...pt };
      })
      .filter(Boolean);
  }, [incidents]);

  const userCoord = useMemo(() => normalizeCoord(me) || DEFAULT_REGION, [me]);

  return (
    <View style={[styles.container, { height }]}>
      <RNMapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        initialRegion={DEFAULT_REGION}
        showsUserLocation={false}
        showsCompass={true}
        showsScale={false}
        toolbarEnabled={false}
      >
        {/* 1. FLOOD RISK ZONES (TRANSPARENT CIRCLES) */}
        {validZones.map((z, idx) => {
          const isCritical = z.level === 'CRITICAL' || z.level === 'HIGH';
          const isMedium = z.level === 'MEDIUM' || z.level === 'MODERATE';
          const fillColor = isCritical
            ? 'rgba(220, 38, 38, 0.22)'
            : isMedium
            ? 'rgba(245, 158, 11, 0.20)'
            : 'rgba(22, 163, 74, 0.16)';
          const strokeColor = isCritical
            ? 'rgba(220, 38, 38, 0.85)'
            : isMedium
            ? 'rgba(245, 158, 11, 0.85)'
            : 'rgba(22, 163, 74, 0.8)';

          return (
            <RNCircle
              key={`zone-${idx}`}
              center={{ latitude: z.latitude, longitude: z.longitude }}
              radius={z.radiusKm * 1000}
              fillColor={fillColor}
              strokeColor={strokeColor}
              strokeWidth={2}
              zIndex={1}
            />
          );
        })}

        {/* 2. ROAD NETWORK POLYLINES */}
        {validRoads.map((road) => {
          const isBlocked = blockedIds.has(road.id) || road.status === 'BLOCKED';
          const isLiveAlternative = !activeRouteCoords && altId === road.id;

          if (isBlocked) {
            return (
              <React.Fragment key={`road-${road.id}`}>
                <RNPolyline
                  coordinates={road.pts}
                  strokeColor="#DC2626"
                  strokeWidth={5}
                  lineDashPattern={[8, 5]}
                  zIndex={4}
                />
              </React.Fragment>
            );
          }

          if (isLiveAlternative) {
            return (
              <React.Fragment key={`road-${road.id}`}>
                <RNPolyline
                  coordinates={road.pts}
                  strokeColor="#FFFFFF"
                  strokeWidth={8}
                  zIndex={5}
                />
                <RNPolyline
                  coordinates={road.pts}
                  strokeColor="#1565FF"
                  strokeWidth={5}
                  zIndex={6}
                />
              </React.Fragment>
            );
          }

          return (
            <RNPolyline
              key={`road-${road.id}`}
              coordinates={road.pts}
              strokeColor="#94A3B8"
              strokeWidth={3.5}
              zIndex={2}
            />
          );
        })}

        {/* 3. RECOMMENDED ALTERNATIVE ROUTE (DIJKSTRA DETOUR) */}
        {activeRouteCoords && (
          <>
            <RNPolyline
              coordinates={activeRouteCoords}
              strokeColor="#FFFFFF"
              strokeWidth={8}
              zIndex={8}
            />
            <RNPolyline
              coordinates={activeRouteCoords}
              strokeColor="#1565FF"
              strokeWidth={5}
              zIndex={9}
            />
          </>
        )}

        {/* 4. BLOCKED ROAD BADGE MARKERS */}
        {validRoads
          .filter((r) => (blockedIds.has(r.id) || r.status === 'BLOCKED') && r.midCoord)
          .map((road) => (
            <RNMarker
              key={`blocked-marker-${road.id}`}
              coordinate={road.midCoord}
              anchor={{ x: 0.5, y: 0.5 }}
              zIndex={15}
            >
              <View style={styles.blockedBadge}>
                <Text style={styles.blockedBadgeText}>BLOCKED</Text>
              </View>
            </RNMarker>
          ))}

        {/* 5. USER LOCATION PIN */}
        <RNMarker
          coordinate={userCoord}
          anchor={{ x: 0.5, y: 0.5 }}
          zIndex={20}
        >
          <View style={styles.userPinContainer}>
            <View style={styles.userPinPulse} />
            <View style={styles.userPinDot} />
            <View style={styles.userPinPill}>
              <Text style={styles.userPinText}>YOU</Text>
            </View>
          </View>
        </RNMarker>

        {/* 6. SCENARIO DESTINATION & VOLUNTEER MARKERS */}
        {validMarkers.map((m) => {
          const isDest = m.id === 'dest';
          return (
            <RNMarker
              key={m.id}
              coordinate={{ latitude: m.latitude, longitude: m.longitude }}
              anchor={{ x: 0.5, y: 0.5 }}
              zIndex={isDest ? 14 : m.highlight ? 18 : 12}
            >
              <View style={[styles.customPin, m.highlight && styles.highlightedPin]}>
                <View style={[styles.pinBadge, { backgroundColor: m.color || colors.navy }]}>
                  <Text style={styles.pinBadgeText}>
                    {m.label || (isDest ? 'RELIEF CTR' : 'RESOURCE')}
                  </Text>
                </View>
              </View>
            </RNMarker>
          );
        })}

        {/* 7. LIVE INCIDENTS */}
        {validIncidents.map((inc) => (
          <RNMarker
            key={`inc-${inc.id}`}
            coordinate={{ latitude: inc.latitude, longitude: inc.longitude }}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={10}
          >
            <View style={styles.incidentPin}>
              <Feather name="alert-triangle" size={11} color="#FFFFFF" />
            </View>
          </RNMarker>
        ))}
      </RNMapView>

      {/* FLOATING CONTROLS (Recenter & Zoom) */}
      <View style={styles.floatingControls}>
        <Pressable
          style={styles.controlBtn}
          onPress={handleRecenter}
          hitSlop={4}
        >
          <Feather name="crosshair" size={16} color="#0F172A" />
        </Pressable>
        <View style={styles.controlDivider} />
        <Pressable
          style={styles.controlBtn}
          onPress={() => handleZoom(true)}
          hitSlop={4}
        >
          <Feather name="plus" size={16} color="#0F172A" />
        </Pressable>
        <View style={styles.controlDivider} />
        <Pressable
          style={styles.controlBtn}
          onPress={() => handleZoom(false)}
          hitSlop={4}
        >
          <Feather name="minus" size={16} color="#0F172A" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.card,
    overflow: 'hidden',
    backgroundColor: '#E2E8F0',
    position: 'relative',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadow,
  },
  floatingControls: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
    zIndex: 25,
  },
  controlBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlDivider: {
    width: 22,
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  blockedBadge: {
    backgroundColor: '#DC2626',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    elevation: 3,
  },
  blockedBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    letterSpacing: 0.5,
  },
  userPinContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  userPinPulse: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(21, 101, 255, 0.25)',
  },
  userPinDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#1565FF',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  userPinPill: {
    backgroundColor: '#0B1F33',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    marginTop: 2,
  },
  userPinText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
  },
  customPin: {
    alignItems: 'center',
  },
  highlightedPin: {
    transform: [{ scale: 1.1 }],
  },
  pinBadge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    elevation: 3,
  },
  pinBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
  },
  incidentPin: {
    backgroundColor: '#D97706',
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
});
