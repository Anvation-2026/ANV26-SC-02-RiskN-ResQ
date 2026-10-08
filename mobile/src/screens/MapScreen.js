import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import Header from '../components/Header';
import MapView, { MapLegend } from '../components/MapView';
import ConnectionBanner from '../components/ConnectionBanner';
import ResponsePanel from '../components/ResponsePanel';
import ErrorBoundary from '../components/ErrorBoundary';
import { useResponse } from '../context/ResponseContext';
import { useData } from '../context/DataContext';
import { ago, rainLabel, RAIN_LABEL, RISK_COLOR, SAT_COLOR } from '../components/rain';
import { getFloodRiskAt, getNearestEvacuation } from '../services/api';
import { useT } from '../i18n';
import { Sheet } from '../components/ui';
import { ROUTE_NOTE } from '../services/copy';
import { colors, radius, shadow } from '../theme';

const ROAD_STATE = { OPEN: ['Open', '#16A34A'], POTENTIALLY_AFFECTED: ['Potentially affected', '#EA580C'], REPORTED_BLOCKED: ['Reported blocked', '#DC2626'], VERIFIED_BLOCKED: ['Verified blocked', '#991B1B'] };

const MODES = [
  ['live', 'Live Telemetry'],
  ['response', 'Corridor & Response'],
];

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const { userLocation, risk, blocked, roads, alternative, incidents, locationLabel, weatherMonitor, places, intel } = useData();
  const [layers, setLayers] = useState({ risk: true, rain: true, satellite: true, hotspots: true, roads: true, terrain: false, incidents: true, hospitals: true, shelters: true, volunteers: true });
  const [roadPick, setRoadPick] = useState(null);
  const [incidentPick, setIncidentPick] = useState(null);
  const [intelPick, setIntelPick] = useState(null);
  const [cellDetail, setCellDetail] = useState(null);
  const [evac, setEvac] = useState(null);
  const [evacBusy, setEvacBusy] = useState(false);
  const [rainPick, setRainPick] = useState(null);
  const [placePick, setPlacePick] = useState(null);
  const t = useT();
  const [mode, setMode] = useState('live');
  const R = useResponse();

  const toggle = (k) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  // every tapped map object (rain area, risk cell, satellite cell, hotspot, hospital/shelter, evacuation result) opens in one bottom sheet
  const sheetOpen = !!(rainPick || placePick || intelPick || evac || roadPick || incidentPick);
  const closeSheet = () => { setRainPick(null); setPlacePick(null); setIntelPick(null); setEvac(null); setRoadPick(null); setIncidentPick(null); };
  const only = (fn) => (x) => { closeSheet(); fn(x); }; // one object in the sheet at a time
  const INTEL_TITLE = { cell: 'Flood risk estimate', satellite: 'Satellite water-change observation', hotspot: 'Potential flood hotspot', terrain: 'Terrain susceptibility' };
  const sheetTitle = evac ? 'Nearest designated evacuation point' : intelPick ? INTEL_TITLE[intelPick.kind]
    : placePick ? (placePick.kind === 'HOSPITAL' ? 'Hospital' : 'Designated shelter / assembly point') : roadPick ? 'Road status' : incidentPick ? 'Incident report' : 'Rainfall observation';
  const visiblePlaces = (places || []).filter((p) => (p.kind === 'HOSPITAL' ? layers.hospitals : layers.shelters));
  const sheetTone = intelPick && intelPick.kind === 'cell' && cellDetail && cellDetail.risk_level ? RISK_COLOR[cellDetail.risk_level] : intelPick && intelPick.kind === 'hotspot' ? RISK_COLOR[intelPick.hotspot.risk_level] : undefined;
  const pickIntel = (p) => {
    closeSheet(); setIntelPick(p); setCellDetail(null);
    if (p.kind === 'cell') getFloodRiskAt(p.cell.latitude, p.cell.longitude).then(setCellDetail).catch(() => setCellDetail({ error: true }));
  };
  const findEvac = async () => {
    if (!userLocation) return;
    setEvacBusy(true);
    try { setEvac(await getNearestEvacuation(userLocation.latitude, userLocation.longitude)); } catch (e) { setEvac({ points: [], message: 'Could not look up evacuation points. Check your connection.' }); }
    setEvacBusy(false);
  };

  // Dominant map height: 50-54% of screen height
  const mapHeight = Math.max(340, Math.min(480, Math.round(screenHeight * 0.50)));

  // Real response markers & route line
  const scenario = useMemo(() => {
    const markers = [];
    const matchedId = R?.match?.matched && R?.match?.volunteer ? String(R.match.volunteer.id) : null;

    if (R?.destinationVolunteer) {
      const dv = R.destinationVolunteer;
      markers.push({
        id: 'dest',
        latitude: dv.latitude,
        longitude: dv.longitude,
        label: `★ ${dv.name} (${dv.resource || dv.skill || 'Responder'})`,
        color: colors.route,
        highlight: true,
      });
    }

    if (Array.isArray(R?.volunteers)) {
      R.volunteers.forEach((v) => {
        if (v && typeof v.latitude === 'number' && typeof v.longitude === 'number') {
          const isMatched = String(v.id) === matchedId;
          // Avoid duplicate marker if destinationVolunteer is already added
          if (isMatched && R?.destinationVolunteer) return;
          markers.push({
            id: String(v.id),
            latitude: v.latitude,
            longitude: v.longitude,
            highlight: isMatched,
            label: isMatched ? `★ ${v.name} · ${v.resource}` : `${v.name} · ${v.resource}`,
            color: isMatched ? colors.route : v.availability === 'AVAILABLE' ? colors.LOW : '#94A3B8',
          });
        }
      });
    }

    const routeLine = R?.route && R.route.success && Array.isArray(R.route.coordinates)
      ? R.route.coordinates
      : undefined;

    return {
      edges: [],
      blockedEdges: [],
      routeLine,
      markers,
    };
  }, [R]);

  const names = (blocked || []).map((r) => r.name).join(', ');

  return (
    <View style={styles.root}>
      <Header
        title="Live Map"
        subtitle="Real-Time Corridor Telemetry & Risk Zones"
      />

      <ScrollView
        contentContainerStyle={[
          styles.scrollBody,
          { paddingBottom: Math.max(insets.bottom, 16) + 85 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* TAB SWITCHER */}
        <View style={styles.tabSwitcher}>
          {MODES.map(([k, l]) => {
            const active = mode === k;
            return (
              <Pressable
                key={k}
                onPress={() => setMode(k)}
                style={[styles.tabBtn, active && styles.tabBtnActive]}
                hitSlop={4}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {l}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <ConnectionBanner />

        {/* DOMINANT REAL INTERACTIVE MAP */}
        <ErrorBoundary fallbackTitle="Map View Unavailable">
          <View style={styles.mapWrapper}>
            <MapView
              risk={risk}
              roads={layers.roads ? roads : roads.map((r) => ({ ...r, risk_state: undefined, low_lying: false }))}
              blocked={blocked}
              alternative={alternative}
              incidents={layers.incidents ? incidents : []}
              height={mapHeight}
              routeLine={evac && evac.route && evac.route.success ? evac.route.polyline : scenario.routeLine}
              markers={(() => {
                const base = layers.volunteers ? scenario.markers : scenario.markers.filter((m) => m.id === 'dest' || m.highlight); // a matched responder stays visible
                return evac && evac.points && evac.points[0] ? [...base, { id: 'dest', latitude: evac.points[0].latitude, longitude: evac.points[0].longitude, label: `★ ${evac.points[0].name}`, color: colors.route, highlight: true }] : base;
              })()}
              user={userLocation || R?.userLocation}
              labelBlockedOnly
              rainAreas={layers.rain && weatherMonitor ? weatherMonitor.locations : []}
              riskCells={layers.risk && intel ? intel.cells : []}
              terrainCells={layers.terrain && intel ? intel.cells.filter((c) => (c.susceptibility || 0) >= 60) : []}
              satelliteCells={layers.satellite && intel ? intel.satellite_water_change : []}
              hotspots={layers.hotspots && intel ? intel.hotspots : []}
              cellHalf={intel ? intel.half_deg : undefined}
              onIntelPress={pickIntel}
              onRainPress={only(setRainPick)}
              places={visiblePlaces}
              onPlacePress={only(setPlacePick)}
              onRoadPress={only(setRoadPick)}
              onIncidentPress={only(setIncidentPick)}
            />
          </View>
        </ErrorBoundary>


        <View style={styles.layerPanel}>
          <Text style={styles.kicker}>MAP LAYERS</Text>
          <View style={styles.layerRow}>
            {[['risk', t('layer.risk'), 'layers'], ['rain', t('layer.rain'), 'cloud-rain'], ['satellite', t('layer.satellite'), 'radio'], ['hotspots', t('layer.hotspots'), 'alert-octagon'],
              ['roads', t('layer.roads'), 'git-commit'], ['terrain', t('layer.terrain'), 'triangle'], ['incidents', t('layer.incidents'), 'alert-triangle'],
              ['hospitals', t('layer.hospitals'), 'plus-square'], ['shelters', t('layer.shelters'), 'home'], ['volunteers', t('layer.volunteers'), 'users']].map(([k, label, icon]) => (
              <Pressable key={k} onPress={() => toggle(k)} accessibilityRole="switch" accessibilityState={{ checked: layers[k] }} aria-checked={!!layers[k]} accessibilityLabel={label}
                style={[styles.layerChip, layers[k] && styles.layerChipOn]}>
                <Feather name={layers[k] ? 'check-square' : 'square'} size={12} color={layers[k] ? '#fff' : '#64748B'} />
                <Feather name={icon} size={12} color={layers[k] ? '#fff' : '#64748B'} />
                <Text style={[styles.layerText, layers[k] && { color: '#fff' }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        {intel && intel.providers && intel.providers.some((p) => p.state !== 'OK') ? (
          <Text style={styles.dataNote}>
            Data status: {intel.providers.filter((p) => p.state !== 'OK').map((p) => `${p.name.replace('_', ' ')} ${p.state === 'UNAVAILABLE' || p.state === 'NOT_RUN' ? 'unavailable' : p.state.toLowerCase()}`).join(' · ')}. Risk uses the remaining signals.
          </Text>
        ) : null}
        <MapLegend />
        <View style={{ marginTop: 10 }}>
          <Pressable onPress={findEvac} disabled={evacBusy || !userLocation} accessibilityRole="button" style={styles.evacBtn}>
            <Feather name="navigation" size={14} color="#fff" />
            <Text style={styles.evacText}>{evacBusy ? 'Looking…' : t('evac.button')}</Text>
          </Pressable>
        </View>
        <Sheet visible={sheetOpen} onClose={closeSheet} title={sheetTitle} tone={sheetTone}>
        {rainPick && (
          <View style={styles.rainCard}>
            <View style={styles.kickerRow}>
              <Text style={styles.rainTitle}>{rainLabel(t, rainPick.rain_level)}</Text>
            </View>
            <Text style={styles.rainLine}>Rainfall: <Text style={styles.rainBold}>{rainPick.rainfall_mm.toFixed(1)} mm</Text></Text>
            <Text style={styles.rainLine}>Period: <Text style={styles.rainBold}>1 hour</Text> ({(rainPick.rainfall_24h_mm ?? 0).toFixed(1)} mm in 24 h)</Text>
            <Text style={styles.rainLine}>Location: <Text style={styles.rainBold}>{rainPick.latitude.toFixed(3)}, {rainPick.longitude.toFixed(3)}</Text></Text>
            <Text style={styles.rainLine}>Observed: <Text style={styles.rainBold}>{new Date(rainPick.timestamp).toLocaleString()}</Text></Text>
            <Text style={styles.rainLine}>Source: <Text style={styles.rainBold}>{rainPick.source}</Text></Text>
            <Text style={styles.rainLine}>Status: <Text style={styles.rainBold}>{RAIN_LABEL[rainPick.rain_level].toUpperCase()}</Text></Text>
            {rainPick.forecast_peak_mm != null && rainPick.forecast_level !== 'LOW' ? (
              <Text style={styles.rainLine}>Next 3 hours: <Text style={styles.rainBold}>up to {rainPick.forecast_peak_mm.toFixed(1)} mm/h around {rainPick.forecast_peak_in_h} h from now</Text></Text>
            ) : null}
            {rainPick.low_lying ? <Text style={styles.rainLine}>This area is low-lying ground, so water may collect here sooner.</Text> : null}
            <Text style={styles.rainNote}>This is a rainfall reading. Flood risk is shown separately by the risk level and alerts.</Text>
          </View>
        )}
        {placePick && (
          <View style={[styles.rainCard, { borderColor: '#99F6E4' }]}>
            <View style={styles.kickerRow}>
              <Text style={styles.rainTitle}>{placePick.kind === 'HOSPITAL' ? 'Hospital' : 'Shelter / assembly point'}</Text>
            </View>
            <Text style={styles.rainLine}><Text style={styles.rainBold}>{placePick.name}</Text></Text>
            {placePick.address ? <Text style={styles.rainLine}>{placePick.address}</Text> : null}
            {placePick.phone ? <Text style={styles.rainLine}>Phone: <Text style={styles.rainBold}>{placePick.phone}</Text></Text> : null}
            {placePick.distance_km != null ? <Text style={styles.rainLine}>{placePick.distance_km} km from you</Text> : null}
            <Text style={styles.rainNote}>Source: {placePick.source === 'OSM' ? 'OpenStreetMap' : 'added by an administrator'}. Check that a place is open before travelling.</Text>
          </View>
        )}
        {intelPick && (
          <View style={[styles.rainCard, { borderColor: intelPick.kind === 'satellite' ? '#DDD6FE' : intelPick.kind === 'hotspot' ? '#FECACA' : '#E2E8F0' }]}>
            <View style={styles.kickerRow}>
              <Text style={styles.rainTitle}>
                {intelPick.kind === 'cell' ? 'Flood risk estimate for this area' : intelPick.kind === 'satellite' ? 'Satellite-detected water expansion' : 'Potential flood hotspot'}
              </Text>
            </View>
            {intelPick.kind === 'cell' && (cellDetail ? (cellDetail.error ? <Text style={styles.rainLine}>Details unavailable right now.</Text> : cellDetail.insufficient ? (
              <Text style={styles.rainLine}>{cellDetail.reason}</Text>
            ) : (
              <>
                <Text style={styles.rainLine}><Text style={[styles.rainBold, { color: RISK_COLOR[cellDetail.risk_level] }]}>{cellDetail.risk_level}</Text> · {cellDetail.risk_score}/100{cellDetail.probability != null ? ` · probability ${Math.round(cellDetail.probability * 100)}% (prototype estimate)` : ''}</Text>
                <Text style={styles.rainLine}>{cellDetail.reason}</Text>
                {cellDetail.signals.filter((x) => x.points > 0).map((x) => <Text key={x.key} style={styles.rainLine}>• {x.label} (+{x.points}): {x.detail} [{x.source || 'n/a'}]</Text>)}
                {cellDetail.missing.length ? <Text style={styles.rainNote}>Not available: {cellDetail.missing.map((m) => m.label.toLowerCase()).join(', ')}.</Text> : null}
                <Text style={styles.rainNote}>{cellDetail.model}. Area-level estimate (about 9 km cell), updated {ago(cellDetail.computed_at)}.</Text>
              </>
            )) : <Text style={styles.rainLine}>Loading…</Text>)}
            {intelPick.kind === 'satellite' && (
              <>
                <Text style={styles.rainLine}>Classification: <Text style={styles.rainBold}>{intelPick.cell.abnormal ? 'Water change observed (abnormal gain)' : 'No abnormal change'}</Text></Text>
                <Text style={styles.rainLine}>Change: <Text style={styles.rainBold}>+{intelPick.cell.expansion_area_km2} km²</Text>{intelPick.cell.expansion_percentage != null ? ` (${Math.round(intelPick.cell.expansion_percentage)}% more than baseline)` : ' (new water where there was almost none)'}</Text>
                {intelPick.cell.water_area_km2 != null ? <Text style={styles.rainLine}>Water now: {intelPick.cell.water_area_km2} km² · baseline {intelPick.cell.baseline_water_area_km2 != null ? `${intelPick.cell.baseline_water_area_km2} km²` : 'n/a'}{intelPick.cell.baseline_scenes ? ` from ${intelPick.cell.baseline_scenes} earlier pass(es)` : ''}</Text> : null}
                <Text style={styles.rainLine}>Confidence: <Text style={styles.rainBold}>{String(intelPick.cell.confidence).toLowerCase()}</Text></Text>
                <Text style={styles.rainLine}>Observation: {String(intelPick.cell.observed_at).slice(0, 10)} ({intelPick.cell.age_days != null ? `${intelPick.cell.age_days} days ago` : ago(intelPick.cell.observed_at)}){intelPick.cell.stale ? ' · STALE' : ''}</Text>
                <Text style={styles.rainLine}>Source: {intelPick.cell.source}{intelPick.cell.method ? ` · ${intelPick.cell.method}` : ''}</Text>
                <Text style={styles.rainNote}>This is a satellite observation of water extent, compared with earlier passes on the same orbit. It indicates possible flooding or ponding; it does not confirm a flood, and satellites pass only every few days.</Text>
              </>
            )}
            {intelPick.kind === 'hotspot' && (
              <>
                <Text style={styles.rainLine}><Text style={[styles.rainBold, { color: RISK_COLOR[intelPick.hotspot.risk_level] }]}>{intelPick.hotspot.risk_level}</Text> · {intelPick.hotspot.risk_score}/100 · confidence {String(intelPick.hotspot.confidence).toLowerCase()}</Text>
                {intelPick.hotspot.signals.map((x) => <Text key={x.key} style={styles.rainLine}>• {x.label}: {x.detail}</Text>)}
                {intelPick.hotspot.recommended_action ? <Text style={styles.rainLine}>Recommended action: <Text style={styles.rainBold}>{intelPick.hotspot.recommended_action}</Text></Text> : null}
                <Text style={styles.rainNote}>Sources: {intelPick.hotspot.sources.join('; ')}. {intelPick.hotspot.note} Updated {ago(intelPick.hotspot.updated_at)}.</Text>
              </>
            )}
            {intelPick.kind === 'terrain' && (
              <>
                <Text style={styles.rainLine}>Susceptibility: <Text style={styles.rainBold}>{intelPick.cell.susceptibility != null ? `${Math.round(intelPick.cell.susceptibility)}/100` : 'n/a'}</Text></Text>
                {intelPick.cell.elevation_m != null ? <Text style={styles.rainLine}>Elevation: {Math.round(intelPick.cell.elevation_m)} m</Text> : null}
                {intelPick.cell.slope_deg != null ? <Text style={styles.rainLine}>Slope: {Number(intelPick.cell.slope_deg).toFixed(1)}°</Text> : null}
                <Text style={styles.rainLine}>Source: {intelPick.cell.terrain_source || 'Elevation model'}</Text>
                <Text style={styles.rainNote}>Terrain increases susceptibility; it does not by itself prove flooding. It only adds to the flood risk while it is raining.</Text>
              </>
            )}
          </View>
        )}
        {roadPick && (
          <View style={[styles.rainCard, { borderColor: '#E2E8F0' }]}>
            <View style={styles.kickerRow}><Text style={styles.rainTitle}>{roadPick.name || 'Road'}</Text></View>
            <Text style={styles.rainLine}>Status: <Text style={[styles.rainBold, { color: ROAD_STATE[roadPick.risk_state || 'OPEN'][1] }]}>{ROAD_STATE[roadPick.risk_state || 'OPEN'][0]}</Text>{roadPick.status === 'BLOCKED' ? ' (closed by an administrator)' : ''}</Text>
            {roadPick.risk_level ? <Text style={styles.rainLine}>Area flood risk along it: {roadPick.risk_level}{roadPick.risk_score != null ? ` (${roadPick.risk_score}/100)` : ''}</Text> : null}
            {(roadPick.risk_reasons || []).map((r) => <Text key={r} style={styles.rainLine}>• {r}</Text>)}
            <Text style={styles.rainLine}>Road data: {roadPick.source === 'OSM' ? 'OpenStreetMap' : 'reference geometry'}</Text>
            <Text style={styles.rainNote}>Only reported or verified incidents and administrator closures mark a road blocked. "Potentially affected" is an area-level flood-risk estimate, not an observation of this road.</Text>
          </View>
        )}
        {incidentPick && (
          <View style={[styles.rainCard, { borderColor: '#FDE68A' }]}>
            <View style={styles.kickerRow}><Text style={styles.rainTitle}>{String(incidentPick.type || 'Incident').replace(/_/g, ' ')}</Text></View>
            <Text style={styles.rainLine}>Status: <Text style={styles.rainBold}>{incidentPick.status === 'VERIFIED' ? 'Verified by an administrator' : 'Community report, not yet verified'}</Text></Text>
            {incidentPick.description ? <Text style={styles.rainLine}>{incidentPick.description}</Text> : null}
            {incidentPick.trustScore != null ? <Text style={styles.rainLine}>Trust: {incidentPick.trustScore}/100{incidentPick.confidence ? ` (${String(incidentPick.confidence).toLowerCase()} confidence)` : ''}</Text> : null}
            {incidentPick.confirmations ? <Text style={styles.rainLine}>Confirmed by {incidentPick.confirmations} other nearby report(s)</Text> : null}
            <Text style={styles.rainLine}>Reported {ago(incidentPick.timestamp || incidentPick.created_at)}{incidentPick.has_photo ? ' · photo attached' : ''}</Text>
            <Text style={styles.rainNote}>Community reports are supporting evidence. One report does not by itself mean flooding.</Text>
          </View>
        )}
        {evac && (
          <View style={[styles.rainCard, { borderColor: '#BFDBFE' }]}>
            <View style={styles.kickerRow}>
              <Text style={styles.rainTitle}>Designated evacuation point</Text>
            </View>
            {evac.points && evac.points.length ? (
              <>
                <Text style={styles.rainLine}><Text style={styles.rainBold}>{evac.points[0].name}</Text> · {evac.points[0].distance_km} km away ({evac.points[0].kind === 'SHELTER' ? 'shelter / assembly point' : 'hospital'})</Text>
                {evac.route && evac.route.success ? (
                  <Text style={styles.rainLine}>Route: {evac.route.distance_km} km, about {evac.route.eta_minutes} min. {evac.route.reason}</Text>
                ) : <Text style={styles.rainLine}>{evac.message || 'A route could not be calculated.'}</Text>}
                {evac.points.slice(1).map((p) => <Text key={p.id} style={styles.rainLine}>Also: {p.name} · {p.distance_km} km</Text>)}
                <Text style={styles.rainNote}>{evac.route && evac.route.safetyNote ? evac.route.safetyNote + ' ' : ''}Designated means listed in the data source, not verified safe. Check that a place is open before travelling.</Text>
              </>
            ) : <Text style={styles.rainLine}>{evac.message || 'No designated evacuation points are loaded yet.'}</Text>}
          </View>
        )}
        </Sheet>

        {weatherMonitor && weatherMonitor.status !== 'ok' && (
          <Text style={styles.rainStale}>{weatherMonitor.message || 'Weather data unavailable'}</Text>
        )}

        {/* BOTTOM SECTION / ROUTE STATUS */}
        {mode === 'response' ? (
          <ErrorBoundary fallbackTitle="Response Telemetry Unavailable">
            <View style={styles.responseContainer}>
              <ResponsePanel />
            </View>
          </ErrorBoundary>
        ) : (
          <View style={styles.routeCard}>
            <View style={styles.kickerRow}>
              <Text style={styles.kicker}>MONITORED CORRIDORS</Text>
              {blocked.length > 0 && (
                <View style={styles.blockedPill}>
                  <Text style={styles.blockedPillText}>HAZARD DETECTED</Text>
                </View>
              )}
            </View>

            {blocked.length > 0 ? (
              <>
                <View style={styles.hazardNotice}>
                  <Feather name="alert-triangle" size={15} color={colors.HIGH} style={{ marginRight: 6 }} />
                  <Text style={styles.warn}>
                    {blocked.length} Active Corridor Blockage{blocked.length > 1 ? 's' : ''}
                  </Text>
                </View>
                <Text style={styles.blockedListText} numberOfLines={2}>
                  {names}
                </Text>

                {scenario.routeLine ? (
                  <View style={styles.altSection}>
                    <Text style={styles.altLabel}>RECOMMENDED LOWER-RISK ROUTE:</Text>
                    <Text style={styles.altName}>
                      {R?.destinationLabel || 'Recommended lower-risk route'}
                    </Text>
                    <View style={styles.stats}>
                      <View style={styles.statBox}>
                        <Text style={styles.sl}>Distance</Text>
                        <Text style={styles.sv}>
                          {R?.route?.distanceKm ? `${R.route.distanceKm.toFixed(1)} km` : '--'}
                        </Text>
                      </View>
                      <View style={styles.statBox}>
                        <Text style={styles.sl}>Est. Time</Text>
                        <Text style={styles.sv}>
                          {R?.route?.etaMinutes ? `${R.route.etaMinutes} min` : '--'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.reasonText}>
                      Reason: {R?.route?.reason || 'Avoids reported blocked road.'}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.noAltText}>
                    Switch to Corridor & Response to calculate an automated detour around active hazards.
                  </Text>
                )}
              </>
            ) : (
              <View style={styles.okSection}>
                <Feather name="check-circle" size={16} color={colors.LOW} style={{ marginRight: 6 }} />
                <Text style={styles.ok}>No blocked corridors reported in your vicinity.</Text>
              </View>
            )}

            <View style={styles.noteDivider} />
            <Text style={styles.note}>
              {ROUTE_NOTE}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  layerPanel: { backgroundColor: colors.card, borderRadius: radius.card, padding: 12, marginTop: 10, borderWidth: 1, borderColor: '#E2E8F0' },
  layerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  layerChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#fff' },
  layerChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  layerText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#475569' },
  dataNote: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: '#B45309', marginTop: 8, lineHeight: 16 },
  evacBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: colors.navy, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  evacText: { color: '#fff', fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13 },
  placesToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, alignSelf: 'flex-start', paddingVertical: 6 },
  placesToggleText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: colors.primary },
  rainCard: { backgroundColor: '#fff', borderRadius: 16, padding: 14, marginTop: 12, borderWidth: 1, borderColor: '#FED7AA' },
  rainTitle: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 15, color: colors.text },
  rainLine: { fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: colors.text, marginTop: 3 },
  rainBold: { fontFamily: 'PlusJakartaSans_700Bold' },
  rainNote: { fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: colors.muted, marginTop: 8 },
  rainStale: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#B45309', marginTop: 8 },
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollBody: {
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  tabSwitcher: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 12,
    padding: 3,
    marginBottom: 10,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBtnActive: {
    backgroundColor: colors.navy,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
  },
  tabText: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 13,
    color: '#64748B',
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  mapWrapper: {
    borderRadius: radius.card,
    overflow: 'hidden',
    backgroundColor: '#E2E8F0',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  responseContainer: {
    marginTop: 6,
  },
  routeCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadow,
  },
  kickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  kicker: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    letterSpacing: 1,
    color: colors.muted,
  },
  blockedPill: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  blockedPillText: {
    color: '#991B1B',
    fontSize: 9,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    letterSpacing: 0.5,
  },
  hazardNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderLeftWidth: 4,
    borderLeftColor: colors.HIGH,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    marginBottom: 6,
  },
  warn: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: colors.HIGH,
  },
  blockedListText: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    color: '#475569',
    marginBottom: 8,
  },
  altSection: {
    marginTop: 4,
  },
  altLabel: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: '#64748B',
    letterSpacing: 0.6,
  },
  altName: {
    fontSize: 16,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: colors.route,
    marginVertical: 3,
  },
  stats: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  statBox: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sl: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: 'PlusJakartaSans_600SemiBold',
  },
  sv: {
    fontSize: 16,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: colors.text,
    marginTop: 2,
  },
  reasonText: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    color: '#475569',
    marginTop: 8,
  },
  noAltText: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_500Medium',
    color: colors.muted,
    marginVertical: 6,
  },
  okSection: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    padding: 10,
    borderRadius: 8,
    marginVertical: 4,
  },
  ok: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: colors.LOW,
  },
  noteDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 10,
  },
  note: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 12,
    color: colors.muted,
    fontStyle: 'italic',
  },
});
