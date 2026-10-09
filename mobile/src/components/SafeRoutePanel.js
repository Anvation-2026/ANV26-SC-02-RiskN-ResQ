import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import LocationPicker from './LocationPicker';
import { planSafeRoute, reassessRoute } from '../services/api';
import { HAZARD_STYLE, planLayers, ROUTE_COLOR } from './geojson';
import { colors, fonts, radius, shadow } from '../theme';

const REASSESS_MS = 2 * 60 * 1000; // while navigating: re-check the route against stored hazards (cheap; never a new satellite run)
const ago = (ts) => {
  if (!ts) return 'unknown';
  const h = (Date.now() - new Date(ts).getTime()) / 3600000;
  if (!Number.isFinite(h)) return 'unknown';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
};

// State and actions for "Navigate Safely": origin (GPS or a searched place), destination (search or a tap on the map),
// the checked routes, the selected one, and reassessment while navigating. The person always chooses before a route changes.
export function useSafeRoute(userLocation) {
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState(null);           // null = my GPS position
  const [destination, setDestination] = useState(null);
  const [pickMode, setPickMode] = useState(null);        // 'destination' while waiting for a tap on the map
  const [plan, setPlan] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [navigating, setNavigating] = useState(false);
  const [alert, setAlert] = useState(null);              // a reassessment that found new hazards on the route
  const [checkedAt, setCheckedAt] = useState(null);
  const [lastCheck, setLastCheck] = useState('');        // a re-check that found nothing new (shown so the tap has a visible result)
  const gps = userLocation && Number.isFinite(userLocation.latitude) ? { latitude: userLocation.latitude, longitude: userLocation.longitude, label: 'My location' } : null;
  const from = origin || gps;

  const calculate = useCallback(async (o = from, d = destination) => {
    if (!o || !d) return;
    setBusy(true); setError(''); setAlert(null);
    try {
      const p = await planSafeRoute(o, d);
      setPlan(p);
      setSelectedId(p.recommended_route_id || p.least_exposed_route_id);
      setCheckedAt(p.generated_at);
      setLastCheck('');
    } catch (e) {
      setError(e && e.detail ? String(e.detail) : 'The route could not be calculated. Check your connection and try again.');
    }
    setBusy(false);
  }, [from && from.latitude, from && from.longitude, destination]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = plan && plan.routes ? plan.routes.find((r) => r.route_id === selectedId) || plan.routes[0] : null;

  const recheck = useCallback(async () => {
    if (!selected) return;
    try {
      const known = (selected.hazard_intersections || []).map((h) => h.hazard_id);
      const r = await reassessRoute({ geometry: selected.geometry, knownHazardIds: known, currentPosition: gps || from, destination });
      setCheckedAt(r.checked_at);
      if (r.affected) { setAlert(r); setLastCheck(''); } else setLastCheck(`${r.message} (checked ${new Date(r.checked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`);
    } catch (e) { setLastCheck(''); setError('Could not re-check the route right now. Check your connection.'); }
  }, [selected && selected.route_id, gps && gps.latitude, gps && gps.longitude]); // eslint-disable-line react-hooks/exhaustive-deps

  const timer = useRef(null);
  useEffect(() => {
    if (!navigating || !selected) return undefined;
    timer.current = setInterval(recheck, REASSESS_MS);
    return () => clearInterval(timer.current);
  }, [navigating, recheck]); // eslint-disable-line react-hooks/exhaustive-deps

  const acceptSuggestion = () => {
    if (!alert || !alert.suggestion) return;
    setPlan(alert.suggestion);
    setLastCheck('');
    setSelectedId(alert.suggestion.recommended_route_id || alert.suggestion.least_exposed_route_id);
    setCheckedAt(alert.suggestion.generated_at);
    setAlert(null);
  };
  const clear = () => { setPlan(null); setSelectedId(null); setNavigating(false); setAlert(null); setError(''); setLastCheck(''); };
  const close = () => { clear(); setOpen(false); setPickMode(null); setDestination(null); setOrigin(null); };
  const pickOnMap = (pt) => { setDestination({ ...pt, label: `Map point ${pt.latitude.toFixed(4)}, ${pt.longitude.toFixed(4)}` }); setPickMode(null); };

  return { open, setOpen, origin, setOrigin, from, gps, destination, setDestination, pickMode, setPickMode, pickOnMap, plan, selected, selectedId, setSelectedId,
    busy, error, calculate, navigating, setNavigating, alert, setAlert, acceptSuggestion, recheck, checkedAt, lastCheck, clear, close };
}

export { planLayers };

const STATUS = {
  RECOMMENDED: { bg: '#ECFDF5', fg: '#065F46', icon: 'check-circle', title: 'Recommended route found' },
  ALL_ROUTES_AFFECTED: { bg: '#FEF2F2', fg: '#991B1B', icon: 'alert-octagon', title: 'Every route crosses a known flood hazard' },
  NOT_CHECKED: { bg: '#FFFBEB', fg: '#92400E', icon: 'help-circle', title: 'Route could not be fully checked for flood risk' },
};

// Setup card: origin and destination, then Calculate. Results card: routes, hazards, directions, freshness, recalculate.
export function SafeRoutePanel({ sr }) {
  const [picker, setPicker] = useState(null); // 'origin' | 'destination'
  const [showSteps, setShowSteps] = useState(false);
  const plan = sr.plan;
  const sel = sr.selected;
  return (
    <View style={s.card} accessibilityLabel="Lower-risk route planner">
      <View style={s.head}>
        <View style={s.headIcon}><Feather name="navigation-2" size={16} color="#fff" /></View>
        <Text style={s.title}>Find a lower-risk route</Text>
        <Pressable onPress={sr.close} accessibilityRole="button" accessibilityLabel="Close route planner" hitSlop={10}><Feather name="x" size={20} color={colors.muted} /></Pressable>
      </View>

      <Text style={s.label}>FROM</Text>
      <Pressable style={s.field} onPress={() => setPicker('origin')} accessibilityRole="button" accessibilityLabel="Choose the start point">
        <Feather name={sr.origin ? 'map-pin' : 'crosshair'} size={15} color={colors.primary} />
        <Text style={[s.fieldText, !sr.from && s.placeholder]} numberOfLines={1}>{sr.from ? sr.from.label : 'Location permission needed: tap to search a start point'}</Text>
        <Text style={s.change}>CHANGE</Text>
      </Pressable>
      <Text style={s.label}>TO</Text>
      <View style={s.destRow}>
        <Pressable style={[s.field, { flex: 1 }]} onPress={() => setPicker('destination')} accessibilityRole="button" accessibilityLabel="Search a destination">
          <Feather name="flag" size={15} color="#7C3AED" />
          <Text style={[s.fieldText, !sr.destination && s.placeholder]} numberOfLines={1}>{sr.destination ? sr.destination.label : 'Search a destination'}</Text>
        </Pressable>
        <Pressable style={[s.mapPick, sr.pickMode && s.mapPickOn]} onPress={() => sr.setPickMode(sr.pickMode ? null : 'destination')} accessibilityRole="button" accessibilityLabel="Choose the destination on the map">
          <Feather name="map" size={15} color={sr.pickMode ? '#fff' : '#7C3AED'} />
          <Text style={[s.mapPickText, sr.pickMode && { color: '#fff' }]}>{sr.pickMode ? 'Tap map…' : 'On map'}</Text>
        </Pressable>
      </View>
      {sr.pickMode ? <Text style={s.hint}>Tap the map above to set the destination.</Text> : null}

      <Pressable style={[s.go, (!sr.from || !sr.destination || sr.busy) && { opacity: 0.5 }]} disabled={!sr.from || !sr.destination || sr.busy}
        onPress={() => { setShowSteps(false); sr.calculate(); }} accessibilityRole="button">
        {sr.busy ? <ActivityIndicator color="#fff" size="small" /> : <Feather name={plan ? 'refresh-cw' : 'search'} size={15} color="#fff" />}
        <Text style={s.goText}>{sr.busy ? 'Checking routes against flood hazards…' : plan ? 'Recalculate route' : 'Calculate route'}</Text>
      </Pressable>
      {sr.error ? <Text style={s.error}>{sr.error}</Text> : null}

      {plan ? (
        <>
          <View style={[s.status, { backgroundColor: STATUS[plan.status].bg }]}>
            <Feather name={STATUS[plan.status].icon} size={16} color={STATUS[plan.status].fg} />
            <View style={{ flex: 1 }}>
              <Text style={[s.statusTitle, { color: STATUS[plan.status].fg }]}>{STATUS[plan.status].title}</Text>
              <Text style={s.statusText}>{plan.selection_reason}</Text>
            </View>
          </View>

          <Text style={s.label}>ROUTES ({plan.routes.length}) · TAP TO COMPARE</Text>
          {plan.routes.map((r) => {
            const on = sel && r.route_id === sel.route_id;
            const col = !r.feasible ? ROUTE_COLOR.affected : r.recommended ? ROUTE_COLOR.recommended : on ? ROUTE_COLOR.selected : ROUTE_COLOR.other;
            return (
              <Pressable key={r.route_id} onPress={() => { sr.setSelectedId(r.route_id); setShowSteps(false); }} accessibilityRole="radio" accessibilityState={{ selected: on }} aria-checked={on}
                style={[s.route, on && { borderColor: col, backgroundColor: '#FAFAFF' }]}>
                <View style={[s.swatch, { backgroundColor: col }, !r.feasible && { opacity: 0.85 }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.routeLabel, { color: col }]}>{r.label}{r.is_fastest ? ' · fastest' : ''}</Text>
                  <Text style={s.routeSub} numberOfLines={1}>{r.summary}</Text>
                  <Text style={s.routeSub}>{r.distance_km} km · {r.eta_minutes} min · {r.hazard_intersections.filter((h) => h.class !== 'CAUTION').length ? `${r.hazard_intersections.filter((h) => h.class !== 'CAUTION').length} known hazard(s) on it` : 'no known hazard on it'}</Text>
                </View>
                <Feather name={on ? 'check-circle' : 'circle'} size={18} color={on ? col : '#CBD5E1'} />
              </Pressable>
            );
          })}

          {sel ? (
            <View style={s.detail}>
              <View style={s.stats}>
                <View style={s.stat}><Text style={s.statVal}>{sel.distance_km} km</Text><Text style={s.statLbl}>DISTANCE</Text></View>
                <View style={s.stat}><Text style={s.statVal}>{sel.eta_minutes} min</Text><Text style={s.statLbl}>EST. TIME</Text></View>
                <View style={s.stat}><Text style={[s.statVal, sel.exposure.excluded_hazard_m + sel.exposure.avoid_hazard_m > 0 && { color: '#B91C1C' }]}>{sel.exposure.excluded_hazard_m + sel.exposure.avoid_hazard_m} m</Text><Text style={s.statLbl}>IN HAZARDS</Text></View>
              </View>
              {sel.hazard_intersections.length ? sel.hazard_intersections.map((h) => (
                <View key={h.hazard_id} style={s.hz}>
                  <View style={[s.hzDot, { backgroundColor: (HAZARD_STYLE[h.kind] || {}).color || '#DC2626' }]} />
                  <Text style={s.hzText}>{h.label}: {h.length_m} m of this route · {h.class === 'EXCLUDE' ? 'avoid' : h.class === 'AVOID' ? 'lower confidence' : 'area-level caution'} · observed {ago(h.observed_at)} · {h.source}</Text>
                </View>
              )) : <Text style={s.line}>No hazard currently known to RiskN ResQ lies on this route. That does not mean the route is safe.</Text>}

              {sel.steps && sel.steps.length ? (
                <>
                  <Pressable onPress={() => setShowSteps((v) => !v)} style={s.stepsToggle} accessibilityRole="button" accessibilityState={{ expanded: showSteps }}>
                    <Feather name={showSteps ? 'chevron-up' : 'list'} size={15} color={colors.primary} />
                    <Text style={s.stepsToggleText}>{showSteps ? 'Hide directions' : `Show directions (${sel.steps.length} steps)`}</Text>
                  </Pressable>
                  {showSteps ? sel.steps.map((st, i) => (
                    <View key={`${i}-${st.instruction}`} style={s.step}>
                      <Text style={s.stepNo}>{i + 1}</Text>
                      <Text style={s.stepText}>{st.instruction}{st.distance_m ? ` · ${st.distance_m >= 1000 ? `${(st.distance_m / 1000).toFixed(1)} km` : `${st.distance_m} m`}` : ''}</Text>
                    </View>
                  )) : null}
                </>
              ) : <Text style={s.line}>Turn-by-turn directions are not available from the routing service for this route.</Text>}

              <View style={s.row}>
                <Pressable style={[s.small, { backgroundColor: sr.navigating ? '#475569' : '#059669' }]} accessibilityRole="button"
                  onPress={() => sr.setNavigating(!sr.navigating)} disabled={!sel.feasible && !sr.navigating}>
                  <Feather name={sr.navigating ? 'pause' : 'play'} size={13} color="#fff" />
                  <Text style={s.smallText}>{sr.navigating ? 'Stop following' : sel.feasible ? 'Follow this route' : 'Not recommended'}</Text>
                </Pressable>
                <Pressable style={[s.small, { backgroundColor: colors.primary }]} onPress={sr.recheck} accessibilityRole="button">
                  <Feather name="shield" size={13} color="#fff" /><Text style={s.smallText}>Check for new hazards</Text>
                </Pressable>
                <Pressable style={[s.small, { backgroundColor: '#E2E8F0' }]} onPress={sr.clear} accessibilityRole="button"><Text style={[s.smallText, { color: colors.text }]}>Clear</Text></Pressable>
              </View>
              {sr.alert ? (
        <View style={s.alert} accessibilityRole="alert">
          <Text style={s.alertTitle}>Your route may be affected</Text>
          {sr.alert.new_intersections.slice(0, 3).map((h) => <Text key={h.hazard_id} style={s.alertLine}>• {h.label} ({h.length_m} m of the route)</Text>)}
          <Text style={s.alertLine}>{sr.alert.suggestion ? (sr.alert.suggestion.status === 'ALL_ROUTES_AFFECTED' ? 'Every new route found also crosses a hazard.' : 'A new route is available. Review it before switching.') : sr.alert.suggestion_error || 'No new route could be calculated.'}</Text>
          <View style={s.row}>
            {sr.alert.suggestion ? <Pressable style={[s.small, { backgroundColor: '#B91C1C' }]} onPress={sr.acceptSuggestion} accessibilityRole="button"><Text style={s.smallText}>View new route</Text></Pressable> : null}
            <Pressable style={[s.small, { backgroundColor: '#475569' }]} onPress={() => sr.setAlert(null)} accessibilityRole="button"><Text style={s.smallText}>Keep current route</Text></Pressable>
          </View>
        </View>
      ) : null}

              {!sr.alert && sr.lastCheck ? <Text style={s.okLine}>✓ {sr.lastCheck}</Text> : null}
              {sr.navigating ? <Text style={s.hint}>Following: the route is re-checked against new reports and closures every 2 minutes. You will be asked before anything changes.</Text> : null}
            </View>
          ) : null}

          <Text style={s.label}>HAZARD DATA USED</Text>
          {Object.entries(plan.data_coverage).map(([k, v]) => (
            <Text key={k} style={s.cov}><Text style={[s.covTag, { color: v.usable ? '#047857' : '#B45309' }]}>{k.replace('_', ' ').toUpperCase()} · {v.status}</Text>{'  '}{v.note}{v.acquired_at ? ` Pass: ${String(v.acquired_at).slice(0, 10)} (${ago(v.acquired_at)}).` : ''}{v.updated_at ? ` Updated ${ago(v.updated_at)}.` : ''}</Text>
          ))}
          <Text style={s.cov}>Hazards last checked {ago(sr.checkedAt || plan.generated_at)}.</Text>
          {plan.warnings.map((w) => <Text key={w} style={s.warn}>⚠ {w}</Text>)}
          <Text style={s.note}>{plan.limitations[0]} Routing: {plan.routing_source || 'n/a'} (road network only; flood checks are RiskN ResQ's own).</Text>
        </>
      ) : null}

      <LocationPicker visible={picker === 'destination'} onClose={() => setPicker(null)} title="Where do you want to go?" actionLabel="Go to"
        note="Search a place (OpenStreetMap) or use 'On map' to tap the destination."
        onPick={(p) => { sr.setDestination(p); setPicker(null); }} />
      <LocationPicker visible={picker === 'origin'} onClose={() => setPicker(null)} title="Start from" actionLabel="Start from" gpsAvailable={!!sr.gps} gpsLabel="Start from my location"
        note="Your GPS position is used only while you plan or follow the route."
        onPick={(p) => { sr.setOrigin(p); setPicker(null); }} onUseGps={() => { sr.setOrigin(null); setPicker(null); }} />
    </View>
  );
}

// legend for the satellite flood layer and route planning colours
export function FloodLegend({ withRoutes }) {
  const items = [
    ['SATELLITE_INUNDATION'], ['VERIFIED_REPORT'], ['USER_REPORT'], ['ROAD_CLOSURE'], ['WEATHER_RISK_AREA'],
  ].map(([k]) => [HAZARD_STYLE[k].color, HAZARD_STYLE[k].label, 'box', HAZARD_STYLE[k].dashed]);
  const routes = withRoutes ? [[ROUTE_COLOR.recommended, 'Recommended route', 'line'], [ROUTE_COLOR.selected, 'Selected alternative', 'line'],
    [ROUTE_COLOR.other, 'Other routes', 'dash'], [ROUTE_COLOR.affected, 'Crosses a hazard', 'dash']] : [];
  return (
    <View style={s.legend}>
      {[...items, ...routes].map(([c, l, t, dashed]) => (
        <View key={l} style={s.legendItem}>
          {t === 'box' ? <View style={[s.legendBox, { backgroundColor: `${c}55`, borderColor: c }, dashed && { borderStyle: 'dashed' }]} />
            : <View style={[s.legendLine, { borderColor: c }, t === 'dash' && { borderStyle: 'dashed' }]} />}
          <Text style={s.legendText}>{l}</Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 14, marginTop: 10, borderWidth: 1, borderColor: '#C4B5FD', ...shadow },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  headIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#059669', alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: fonts.extrabold, fontSize: 16, color: colors.text },
  label: { fontFamily: fonts.extrabold, fontSize: 11, letterSpacing: 0.8, color: colors.muted, marginTop: 12, marginBottom: 6 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F1F5F9', borderRadius: 12, paddingHorizontal: 12, minHeight: 46 },
  fieldText: { flex: 1, fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  placeholder: { color: '#94A3B8' },
  change: { fontFamily: fonts.extrabold, fontSize: 11, color: colors.primary },
  destRow: { flexDirection: 'row', gap: 8 },
  mapPick: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 12, paddingHorizontal: 12, minHeight: 46, borderWidth: 1.5, borderColor: '#7C3AED' },
  mapPickOn: { backgroundColor: '#7C3AED' },
  mapPickText: { fontFamily: fonts.extrabold, fontSize: 12, color: '#7C3AED' },
  okLine: { fontFamily: fonts.semibold, fontSize: 12, color: '#047857', marginTop: 8, lineHeight: 17 },
  hint: { fontFamily: fonts.medium, fontSize: 12, color: '#6D28D9', marginTop: 6, lineHeight: 17 },
  go: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#059669', borderRadius: 14, minHeight: 48, marginTop: 14 },
  goText: { color: '#fff', fontFamily: fonts.extrabold, fontSize: 14 },
  error: { fontFamily: fonts.semibold, fontSize: 13, color: '#B91C1C', marginTop: 8 },
  alert: { backgroundColor: '#FEF2F2', borderRadius: 12, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#FECACA' },
  alertTitle: { fontFamily: fonts.extrabold, fontSize: 14, color: '#991B1B' },
  alertLine: { fontFamily: fonts.medium, fontSize: 12, color: '#7F1D1D', marginTop: 4, lineHeight: 17 },
  status: { flexDirection: 'row', gap: 10, borderRadius: 12, padding: 12, marginTop: 14 },
  statusTitle: { fontFamily: fonts.extrabold, fontSize: 14 },
  statusText: { fontFamily: fonts.medium, fontSize: 12, color: colors.text, marginTop: 3, lineHeight: 17 },
  route: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 12, padding: 10, marginBottom: 6 },
  swatch: { width: 6, alignSelf: 'stretch', borderRadius: 3 },
  routeLabel: { fontFamily: fonts.extrabold, fontSize: 14 },
  routeSub: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted, marginTop: 1 },
  detail: { marginTop: 6 },
  stats: { flexDirection: 'row', gap: 8, marginTop: 4 },
  stat: { flex: 1, backgroundColor: '#F5F3FF', borderRadius: 12, padding: 10 },
  statVal: { fontFamily: fonts.extrabold, fontSize: 16, color: colors.text },
  statLbl: { fontFamily: fonts.bold, fontSize: 10, color: colors.muted, letterSpacing: 0.4, marginTop: 2 },
  hz: { flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'flex-start' },
  hzDot: { width: 10, height: 10, borderRadius: 3, marginTop: 4 },
  hzText: { flex: 1, fontFamily: fonts.medium, fontSize: 12, color: colors.text, lineHeight: 17 },
  line: { fontFamily: fonts.medium, fontSize: 12, color: colors.text, marginTop: 8, lineHeight: 17 },
  stepsToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingVertical: 6, alignSelf: 'flex-start' },
  stepsToggleText: { fontFamily: fonts.extrabold, fontSize: 13, color: colors.primary },
  step: { flexDirection: 'row', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  stepNo: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#EDE9FE', textAlign: 'center', lineHeight: 22, fontFamily: fonts.extrabold, fontSize: 11, color: '#6D28D9', overflow: 'hidden' },
  stepText: { flex: 1, fontFamily: fonts.medium, fontSize: 13, color: colors.text, lineHeight: 19 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  small: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, paddingHorizontal: 12, minHeight: 40 },
  smallText: { color: '#fff', fontFamily: fonts.extrabold, fontSize: 12 },
  cov: { fontFamily: fonts.medium, fontSize: 11, color: colors.muted, marginTop: 4, lineHeight: 16 },
  covTag: { fontFamily: fonts.extrabold, fontSize: 10, letterSpacing: 0.3 },
  warn: { fontFamily: fonts.semibold, fontSize: 12, color: '#B45309', marginTop: 6, lineHeight: 17 },
  note: { fontFamily: fonts.medium, fontSize: 11, color: colors.muted, marginTop: 10, lineHeight: 16 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0' },
  legendBox: { width: 14, height: 12, borderRadius: 3, borderWidth: 1.5 },
  legendLine: { width: 20, height: 0, borderTopWidth: 4 },
  legendText: { fontFamily: fonts.semibold, fontSize: 11, color: colors.text },
});
