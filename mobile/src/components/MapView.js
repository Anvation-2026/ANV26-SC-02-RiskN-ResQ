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
  Polygon as RNPolygon,
  Polyline as RNPolyline,
  PROVIDER_DEFAULT,
  UrlTile as RNUrlTile,
} from 'react-native-maps';
import Feather from '@expo/vector-icons/Feather';
import { colors, radius, riskColor, shadow } from '../theme';
import { useT } from '../i18n';
import { HAZARD_STYLE, polygonRings, ROUTE_COLOR } from './geojson';
import { cellCorners, drawableCells, drawableRain, RAIN_COLOR, RAIN_FILL, RAIN_RADIUS_KM, RISK_COLOR, RISK_FILL, SAT_COLOR, TERRAIN_COLOR } from './rain';

export function MapLegend({ items }) {
  const t = useT();
  const defaultItems = [
    { label: t('legend.you'), color: colors.primary, type: 'dot' },
    { label: t('legend.lowRisk'), color: RISK_COLOR.LOW, type: 'dot' },
    { label: t('legend.medium'), color: RISK_COLOR.MEDIUM, type: 'dot' },
    { label: t('legend.high'), color: RISK_COLOR.HIGH, type: 'dot' },
    { label: t('legend.critical'), color: RISK_COLOR.CRITICAL, type: 'dot' },
    { label: t('legend.rain'), color: '#38BDF8', type: 'dot' },
    { label: t('legend.satellite'), color: SAT_COLOR, type: 'dot' },
    { label: t('legend.hotspot'), color: '#B91C1C', type: 'dot' },
    { label: t('legend.verifiedBlocked'), color: '#B91C1C', type: 'line' },
    { label: t('legend.blocked'), color: colors.HIGH, type: 'dashed' },
    { label: t('legend.terrain'), color: TERRAIN_COLOR, type: 'dot' },
    { label: t('legend.incident'), color: '#D97706', type: 'dot' },
    { label: t('legend.verifiedIncident'), color: '#B91C1C', type: 'dot' },
    { label: t('legend.route'), color: colors.route, type: 'line' },
    { label: t('legend.places'), color: '#0F766E', type: 'dot' },
    { label: t('legend.potential'), color: '#F97316', type: 'line' },
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
      if (label.includes('Rain')) { color = '#38BDF8'; type = 'dot'; }
      else if (label.includes('Risk') || label.includes('Hazard')) { color = colors.HIGH; type = 'dot'; }
      else if (label.includes('Blocked')) { color = colors.HIGH; type = 'dashed'; }
      else if (label.includes('Route') || label.includes('Recommended')) { color = colors.route; type = 'line'; }
      else if (label.includes('Resource') || label.includes('Volunteer')) { color = '#0F766E'; type = 'dot'; }
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
    borderColor: colors.HIGH,
    borderWidth: 1,
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
  rainAreas = [],
  onRainPress,
  places = [],
  onPlacePress,
  riskCells = [],
  satelliteCells = [],
  hotspots = [],
  terrainCells = [],
  cellHalf,
  onIntelPress,
  onRoadPress,
  onIncidentPress,
  onMarkerPress,
  basemap,
  tileOverlays = [],
  routeSegments,
  altRouteLine,
  onPointPress,
  pickedPoint,
  routeColor,
  routeOptions,
  onRouteSelect,
  hazardShapes,
  floodShapes,
}) {
  const mapRef = useRef(null);
  const userCoord = useMemo(() => normalizeCoord(user), [user]);
  const level = risk ? (risk.level || risk.risk_level || 'LOW') : 'LOW';

  const defaultRegion = useMemo(() => {
    if (userCoord) {
      return {
        latitude: userCoord.latitude,
        longitude: userCoord.longitude,
        latitudeDelta: 0.035,
        longitudeDelta: 0.035,
      };
    }
    return {
      latitude: 20.5937,
      longitude: 78.9629,
      latitudeDelta: 0.1,
      longitudeDelta: 0.1,
    };
  }, [userCoord]);

  const validZones = useMemo(() => {
    if (Array.isArray(zones) && zones.length > 0) {
      return zones
        .map((z) => {
          if (!z) return null;
          const pt = normalizeCoord(z);
          if (!pt || !z.radiusKm || z.radiusKm <= 0) return null;
          return { ...pt, radiusKm: z.radiusKm, level: z.level || 'LOW' };
        })
        .filter(Boolean);
    }
    // never draw an invented zone around the user: flood risk is shown by the backend's risk cells
    return [];
  }, [zones]);

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
    if (!mapRef.current || !userCoord) return;
    mapRef.current.animateToRegion({
      latitude: userCoord.latitude,
      longitude: userCoord.longitude,
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

  // Animate to user when location becomes available
  useEffect(() => {
    if (mapRef.current && userCoord && !activeRouteCoords) {
      mapRef.current.animateToRegion({
        latitude: userCoord.latitude,
        longitude: userCoord.longitude,
        latitudeDelta: 0.035,
        longitudeDelta: 0.035,
      }, 400);
    }
  }, [userCoord?.latitude, userCoord?.longitude]);

  // A coarse daily image (NASA ~375 m) is only meaningful at a regional zoom: step out when it is chosen.
  useEffect(() => {
    if (!mapRef.current || !basemap || basemap.id !== 'today') return;
    const c = userCoord || defaultRegion;
    mapRef.current.animateToRegion({ latitude: c.latitude, longitude: c.longitude, latitudeDelta: 0.6, longitudeDelta: 0.6 }, 400);
  }, [basemap && basemap.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
          lowLying: !!road.low_lying,
          potential: road.risk_state === 'POTENTIALLY_AFFECTED',
          verified: road.risk_state === 'VERIFIED_BLOCKED' || road.status === 'BLOCKED',
          reported: road.risk_state === 'REPORTED_BLOCKED',
          raw: road,
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
      .slice(0, 15)
      .map((inc) => {
        if (!inc) return null;
        const pt = normalizeCoord(inc);
        if (!pt) return null;
        return { ...inc, ...pt };
      })
      .filter(Boolean);
  }, [incidents]);

  return (
    <View style={[styles.container, { height }]}>
      <RNMapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        initialRegion={defaultRegion}
        // "satellite" uses the phone's own satellite imagery (Apple / Google: a mosaic, not live); NASA's daily image is a tile layer
        mapType={basemap && basemap.id === 'satellite' ? 'satellite' : 'standard'}
        onPress={(e) => { const c = e && e.nativeEvent && e.nativeEvent.coordinate; if (c && onPointPress) onPointPress({ latitude: c.latitude, longitude: c.longitude }); }}
        showsUserLocation={false}
        showsCompass={true}
        showsScale={false}
        toolbarEnabled={false}
      >
        {/* 0a. NASA daily image as the basemap, then satellite overlays (flood detection, radar water) */}
        {basemap && basemap.id === 'today' && basemap.url ? (
          <RNUrlTile urlTemplate={basemap.url} maximumNativeZ={basemap.max_native_zoom || 9} maximumZ={19} zIndex={-2} tileSize={256} shouldReplaceMapContent />
        ) : null}
        {(Array.isArray(tileOverlays) ? tileOverlays : []).filter((o) => o && o.url).map((o) => (
          <RNUrlTile key={`ov-${o.id}`} urlTemplate={o.url} maximumNativeZ={o.max_native_zoom || 12} maximumZ={19} zIndex={-1} tileSize={256} opacity={o.opacity == null ? 0.8 : o.opacity} />
        ))}

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

        {/* 0. FLOOD INTELLIGENCE LAYERS: terrain susceptibility, risk cells, satellite water change, hotspots */}
        {cellHalf && (Array.isArray(terrainCells) ? terrainCells : []).map((cell) => (
          <RNPolygon key={`terrain-${cell.cell}`} coordinates={cellCorners(cell, cellHalf).map(([latitude, longitude]) => ({ latitude, longitude }))}
            fillColor={`${TERRAIN_COLOR}29`} strokeColor={TERRAIN_COLOR} strokeWidth={1} lineDashPattern={[2, 4]} zIndex={0} tappable
            onPress={() => onIntelPress && onIntelPress({ kind: 'terrain', cell })} />
        ))}
        {cellHalf && drawableCells(riskCells).map((cell) => (
          <RNPolygon key={`risk-${cell.cell}`} coordinates={cellCorners(cell, cellHalf).map(([latitude, longitude]) => ({ latitude, longitude }))}
            fillColor={`${RISK_COLOR[cell.risk_level]}${Math.round(RISK_FILL[cell.risk_level] * 255).toString(16).padStart(2, '0')}`}
            strokeColor={RISK_COLOR[cell.risk_level]} strokeWidth={cell.risk_level === 'LOW' ? 0 : 1} zIndex={0} tappable
            onPress={(e) => { const c = e && e.nativeEvent && e.nativeEvent.coordinate; if (onIntelPress) onIntelPress({ kind: 'cell', cell, point: c ? { latitude: c.latitude, longitude: c.longitude } : null }); }} />
        ))}
        {cellHalf && (Array.isArray(satelliteCells) ? satelliteCells : []).map((cell) => (
          <React.Fragment key={`sat-${cell.cell}`}>
            <RNPolygon coordinates={cellCorners(cell, cellHalf).map(([latitude, longitude]) => ({ latitude, longitude }))}
              fillColor={`${SAT_COLOR}1F`} strokeColor={SAT_COLOR} strokeWidth={2} lineDashPattern={[8, 6]} zIndex={1} tappable
              onPress={() => onIntelPress && onIntelPress({ kind: 'satellite', cell })} />
            <RNMarker coordinate={{ latitude: cell.latitude, longitude: cell.longitude }} anchor={{ x: 0.5, y: 0.5 }} zIndex={11}
              onPress={() => onIntelPress && onIntelPress({ kind: 'satellite', cell })}>
              <View style={[styles.placePin, { backgroundColor: SAT_COLOR }]}><Text style={styles.placePinText}>S</Text></View>
            </RNMarker>
          </React.Fragment>
        ))}
        {(Array.isArray(hotspots) ? hotspots : []).filter((h) => normalizeCoord(h)).map((h) => (
          <React.Fragment key={`hot-${h.id}`}>
            <RNCircle center={{ latitude: h.latitude, longitude: h.longitude }} radius={h.radius_km * 1000} strokeColor="#B91C1C" strokeWidth={2}
              lineDashPattern={[2, 6]} fillColor="transparent" zIndex={2} />
            <RNMarker coordinate={{ latitude: h.latitude, longitude: h.longitude }} anchor={{ x: 0.5, y: 0.5 }} zIndex={13}
              onPress={() => onIntelPress && onIntelPress({ kind: 'hotspot', hotspot: h })}>
              <View style={[styles.placePin, { backgroundColor: '#B91C1C' }]}><Text style={styles.placePinText}>!</Text></View>
            </RNMarker>
          </React.Fragment>
        ))}

        {/* 1b. HEAVY RAINFALL AREAS (weather observations; tap for details) */}
        {drawableRain(rainAreas).map((a) => (
          <RNCircle
            key={`rain-${a.latitude}-${a.longitude}`}
            center={{ latitude: a.latitude, longitude: a.longitude }}
            radius={RAIN_RADIUS_KM * 1000}
            fillColor={`${RAIN_COLOR[a.rain_level]}${Math.round(RAIN_FILL[a.rain_level] * 255).toString(16).padStart(2, '0')}`}
            strokeColor={RAIN_COLOR[a.rain_level]}
            strokeWidth={1}
            zIndex={0}
            tappable
            onPress={() => onRainPress && onRainPress(a)}
          />
        ))}

        {/* 2. ROAD NETWORK POLYLINES */}
        {validRoads.map((road) => {
          // backend road states: VERIFIED BLOCKED solid dark red, REPORTED BLOCKED dashed red, POTENTIALLY AFFECTED dashed orange
          const isBlocked = road.verified || road.reported || blockedIds.has(road.id);
          const isLiveAlternative = !activeRouteCoords && altId === road.id;
          const press = () => onRoadPress && onRoadPress(road.raw);

          if (isBlocked) {
            return (
              <RNPolyline
                key={`road-${road.id}`}
                coordinates={road.pts}
                strokeColor={road.verified ? '#B91C1C' : '#DC2626'}
                strokeWidth={5}
                lineDashPattern={road.verified ? undefined : [8, 5]}
                zIndex={4}
                tappable
                onPress={press}
              />
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
              strokeColor={road.potential ? '#F97316' : road.lowLying ? '#F59E0B' : '#94A3B8'}
              strokeWidth={road.potential || road.lowLying ? 4.5 : 3.5}
              lineDashPattern={road.potential ? [6, 6] : undefined}
              zIndex={2}
              tappable
              onPress={press}
            />
          );
        })}

        {/* 2b. SATELLITE-DETECTED POTENTIAL NEW WATER and the hazards the route planner checked against */}
        {[...(Array.isArray(floodShapes) ? floodShapes.map((f, i) => ({ id: `flood-${i}`, kind: 'SATELLITE_INUNDATION', geometry: f.geometry })) : []),
          ...(Array.isArray(hazardShapes) ? hazardShapes : [])].map((h) => {
          const st = HAZARD_STYLE[h.kind] || HAZARD_STYLE.USER_REPORT;
          return polygonRings(h.geometry).map((p, j) => (
            <RNPolygon key={`hz-${h.id}-${j}`} coordinates={p.outer.map(([latitude, longitude]) => ({ latitude, longitude }))}
              holes={p.holes.map((r) => r.map(([latitude, longitude]) => ({ latitude, longitude })))}
              fillColor={`${st.color}${Math.round(st.fill * 255).toString(16).padStart(2, '0')}`} strokeColor={st.color} strokeWidth={st.dashed ? 1 : 2}
              lineDashPattern={st.dashed ? [5, 5] : undefined} zIndex={3} />
          ));
        })}
        {/* 2c. OTHER CANDIDATE ROUTES (tap to select): grey dashed, red dashed when they cross a hazard */}
        {(Array.isArray(routeOptions) ? routeOptions : []).map((r) => {
          const pts = (r.points || []).map(normalizeCoord).filter(Boolean);
          return pts.length > 1 ? (
            <RNPolyline key={`opt-${r.id}`} coordinates={pts} strokeColor={r.affected ? ROUTE_COLOR.affected : ROUTE_COLOR.other} strokeWidth={5}
              lineDashPattern={[9, 7]} zIndex={7} tappable onPress={() => onRouteSelect && onRouteSelect(r.id)} />
          ) : null;
        })}
        {/* 3a. FASTEST ALTERNATIVE (grey, dashed) when it is not the recommended route */}
        {Array.isArray(altRouteLine) && altRouteLine.length > 1 ? (
          <RNPolyline coordinates={altRouteLine.map(normalizeCoord).filter(Boolean)} strokeColor="rgba(71,85,105,0.75)" strokeWidth={4} lineDashPattern={[8, 8]} zIndex={7} />
        ) : null}
        {/* 3b. RECOMMENDED LOWER-RISK ROUTE: each stretch in the flood-risk colour of the cells it crosses */}
        {activeRouteCoords && (
          <>
            <RNPolyline coordinates={activeRouteCoords} strokeColor="#FFFFFF" strokeWidth={8} zIndex={8} />
            {Array.isArray(routeSegments) && routeSegments.length ? routeSegments.filter((g) => g.points && g.points.length > 1).map((g, i) => (
              <RNPolyline key={`seg-${i}`} coordinates={g.points.map(normalizeCoord).filter(Boolean)} strokeColor={g.level ? RISK_COLOR[g.level] : '#1565FF'} strokeWidth={5} zIndex={9} />
            )) : <RNPolyline coordinates={activeRouteCoords} strokeColor={routeColor || '#1565FF'} strokeWidth={5} zIndex={9} />}
          </>
        )}
        {pickedPoint && normalizeCoord(pickedPoint) ? (
          <RNMarker coordinate={normalizeCoord(pickedPoint)} pinColor="#7C3AED" zIndex={19} />
        ) : null}

        {/* 4. BLOCKED ROAD BADGE MARKERS */}
        {validRoads
          .filter((r) => (r.verified || r.reported || blockedIds.has(r.id)) && r.midCoord)
          .map((road) => (
            <RNMarker
              key={`blocked-marker-${road.id}`}
              coordinate={road.midCoord}
              anchor={{ x: 0.5, y: 0.5 }}
              zIndex={15}
              onPress={() => onRoadPress && onRoadPress(road.raw)}
            >
              <View style={[styles.blockedBadge, road.verified && { backgroundColor: '#7F1D1D' }]}>
                <Text style={styles.blockedBadgeText}>{road.verified ? 'VERIFIED BLOCKED' : 'REPORTED BLOCKED'}</Text>
              </View>
            </RNMarker>
          ))}

        {/* 4b. HOSPITALS AND SHELTERS */}
        {(Array.isArray(places) ? places : []).filter((p) => normalizeCoord(p)).map((p) => (
          <RNMarker
            key={`place-${p.id}`}
            coordinate={{ latitude: p.latitude, longitude: p.longitude }}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={10}
            onPress={() => onPlacePress && onPlacePress(p)}
          >
            <View style={[styles.placePin, { backgroundColor: p.kind === 'HOSPITAL' ? '#DC2626' : '#0F766E' }]}>
              <Text style={styles.placePinText}>{p.kind === 'HOSPITAL' ? '+' : 'S'}</Text>
            </View>
          </RNMarker>
        ))}

        {/* 5. REAL USER LOCATION PIN (with its GPS accuracy circle) */}
        {userCoord && user && user.source !== 'manual' && typeof user.accuracy === 'number' && user.accuracy > 0 && user.accuracy < 2000 ? (
          <RNCircle center={userCoord} radius={user.accuracy} strokeColor="rgba(21,101,255,0.5)" strokeWidth={1} fillColor="rgba(21,101,255,0.08)" zIndex={19} />
        ) : null}
        {userCoord && (
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
        )}

        {/* 6. DESTINATION & VOLUNTEER MARKERS */}
        {validMarkers.map((m) => {
          const isDest = m.id === 'dest';
          return (
            <RNMarker
              key={m.id}
              coordinate={{ latitude: m.latitude, longitude: m.longitude }}
              anchor={{ x: 0.5, y: 0.5 }}
              zIndex={isDest ? 14 : m.highlight ? 18 : 12}
              onPress={() => onMarkerPress && onMarkerPress(m)}
            >
              <View style={[styles.customPin, m.highlight && styles.highlightedPin]}>
                <View style={[styles.pinBadge, { backgroundColor: m.color || colors.navy }]}>
                  <Text style={styles.pinBadgeText}>
                    {m.label || (isDest ? 'RELIEF CTR' : 'RESPONDER')}
                  </Text>
                </View>
              </View>
            </RNMarker>
          );
        })}

        {/* 7. LIVE REPORTED HAZARD INCIDENTS */}
        {validIncidents.map((inc) => (
          <RNMarker
            key={`inc-${inc.id}`}
            coordinate={{ latitude: inc.latitude, longitude: inc.longitude }}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={10}
            onPress={() => onIncidentPress && onIncidentPress(inc)}
          >
            <View style={[styles.incidentPin, inc.status === 'VERIFIED' && { backgroundColor: '#B91C1C' }]}>
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
  placePin: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  placePinText: { color: '#fff', fontSize: 12, fontFamily: 'PlusJakartaSans_800ExtraBold', lineHeight: 14 },
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
