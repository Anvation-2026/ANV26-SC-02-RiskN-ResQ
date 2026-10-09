import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { POLL_MS, USE_DEVICE_LOCATION } from '../config/api';
import { getIntelligenceOverview, getPlaces, getRoadStatus, getWeatherMonitoring, getZoneAlerts, syncTelemetry } from '../services/api';
import { saveMyLocation } from '../services/accountApi';
import { loadJSON, saveJSON } from '../services/storage';
import {
  requestLocationPermission,
  getLiveCurrentPosition,
  getLocationState,
  openLocationSettings,
  subscribeToLiveLocation,
  reverseGeocodeLocation,
  formatCoordinates,
  setManualLocation,
} from '../services/locationService';
import { haversineKm } from '../services/geo';

const CACHE_KEY = 'risknresq_cache_v1';
const DataContext = createContext(null);
export const useData = () => useContext(DataContext);

export function DataProvider({ children }) {
  const [userLocation, setUserLocation] = useState(null);
  const [locationLabel, setLocationLabel] = useState('Acquiring GPS...');
  // 'checking' | 'granted' | 'undetermined' | 'denied' | 'blocked' | 'services_off' | 'error' | 'manual'
  const [locationStatus, setLocationStatus] = useState('checking');
  const [locationMeta, setLocationMeta] = useState(null); // { accuracy (m), timestamp, source: 'gps' | 'last_known' | 'manual' }
  const [gateDismissed, setGateDismissed] = useState(false);
  const [locBusy, setLocBusy] = useState(false);
  const locRef = useRef(null);       // the latest position, read by refresh() without re-creating it on every GPS update
  const labelAt = useRef(null);      // where the place name was last looked up (re-geocode only after moving ~200 m)
  const [loading, setLoading] = useState(true);
  const [risk, setRisk] = useState(null);
  const [weather, setWeather] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [zoneAlerts, setZoneAlerts] = useState([]); // admin/engine alerts from GET /alerts
  const [roadStatus, setRoadStatus] = useState([]); // admin-managed road state from GET /roads
  const [weatherMonitor, setWeatherMonitor] = useState(null); // rainfall grid from GET /weather/monitoring
  const [source, setSource] = useState('live');
  const [activeAssistance, setActiveAssistance] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [backendError, setBackendError] = useState(null);
  const [places, setPlaces] = useState([]); // hospitals and shelters
  const [intel, setIntel] = useState(null); // flood-intelligence overview: risk cells, hotspots, satellite water change, road risk, provider status
  const [cachedAt, setCachedAt] = useState(null); // set only while showing saved data because the server is unreachable
  const lastPosted = useRef(0);
  const slowFetchedAt = useRef(0);
  const roadStatusRef = useRef([]);
  const monitorRef = useRef(null);
  const intelRef = useRef(null);
  const riskRef = useRef(null); // lets the failure path know whether live data was ever shown, without re-creating refresh()
  useEffect(() => { riskRef.current = risk; }, [risk]);

  const busyRef = useRef(false);

  // 1. Device location. Nothing is asked silently: if permission is not decided yet, LocationGate explains why and asks.
  const applyFix = useCallback(async (loc) => {
    locRef.current = loc;
    setUserLocation(loc);
    setLocationMeta({ accuracy: loc.accuracy, timestamp: loc.timestamp || Date.now(), source: loc.source || 'gps' });
    if (!labelAt.current || haversineKm(labelAt.current.latitude, labelAt.current.longitude, loc.latitude, loc.longitude) > 0.2) {
      labelAt.current = loc;
      setLocationLabel(await reverseGeocodeLocation(loc.latitude, loc.longitude));
    }
  }, []);

  const startGps = useCallback(async () => {
    setLocationStatus('granted');
    setLocationLabel('Finding your location…');
    try {
      await applyFix(await getLiveCurrentPosition());
    } catch (e) {
      setLocationStatus('error');
      setLocationLabel(e && e.message === 'LOCATION_TIMEOUT' ? 'GPS signal not found yet' : 'Location unavailable');
      setLoading(false);
    }
  }, [applyFix]);

  const initLocation = useCallback(async () => {
    const state = await getLocationState();
    setLocationStatus(state);
    if (state === 'granted') return startGps();
    setLocationLabel(state === 'services_off' ? 'Location Services are off' : 'Location not shared');
    setLoading(false);
  }, [startGps]);

  useEffect(() => {
    if (USE_DEVICE_LOCATION) {
      initLocation();
    }
  }, [initLocation]);

  // "Allow location": the system dialog appears now, after the explanation
  const askLocation = useCallback(async () => {
    setLocBusy(true);
    try {
      await requestLocationPermission();
      let state = await getLocationState();
      if (state === 'denied' && Platform.OS === 'web') state = 'blocked'; // a browser that refused will not show its prompt again
      if (state === 'blocked') setGateDismissed(false);                    // explain how to turn it back on
      if (state === 'granted') await startGps();
      else { setLocationStatus(state === 'undetermined' ? 'denied' : state); setLocationLabel('Location not shared'); setLoading(false); }
    } finally {
      setLocBusy(false);
    }
  }, [startGps]);

  // after the person changed Settings or turned Location Services on
  const retryLocation = useCallback(async () => {
    setLocBusy(true);
    try { await initLocation(); } finally { setLocBusy(false); }
  }, [initLocation]);

  const dismissLocationGate = useCallback(() => {
    setGateDismissed(true);
    setLocationStatus((st) => (st === 'undetermined' ? 'denied' : st));
  }, []);

  // 2. Follow the device while the app is open (high accuracy, every ~10 m / 4 s)
  useEffect(() => {
    if (locationStatus === 'granted') {
      const unsub = subscribeToLiveLocation((loc) => { applyFix(loc); });
      return unsub;
    }
  }, [locationStatus, applyFix]);

  // 3. Sync telemetry with backend
  const refresh = useCallback(async () => {
    const userLocation = locRef.current;
    if (!userLocation) return;
    if (busyRef.current) return;
    busyRef.current = true;

    try {
      // Risk, weather and alerts every cycle; the larger, slower-changing sets (roads, the weather grid, the intelligence overview)
      // at most every 30 s. The backend already caches all of them, this just keeps phones from re-downloading ~80 KB every poll.
      const slowDue = Date.now() - slowFetchedAt.current > 30000;
      const [bundle, alertsRes, roadsRes, monitorRes, intelRes] = await Promise.all([
        syncTelemetry(userLocation.latitude, userLocation.longitude),
        getZoneAlerts().catch(() => null), // a failure here must not hide the rest of the telemetry
        slowDue ? getRoadStatus().catch(() => null) : null,
        slowDue ? getWeatherMonitoring().catch(() => null) : null,
        slowDue ? getIntelligenceOverview(userLocation.latitude, userLocation.longitude).catch(() => null) : null, // optional: the app works without it
      ]);
      if (slowDue) slowFetchedAt.current = Date.now();
      if (monitorRes) { setWeatherMonitor(monitorRes); monitorRef.current = monitorRes; }
      if (intelRes) { setIntel(intelRes); intelRef.current = intelRes; }
      if (alertsRes) setZoneAlerts(alertsRes);
      if (roadsRes) { setRoadStatus(roadsRes); roadStatusRef.current = roadsRes; }
      const rawRisk = bundle.risk;
      const normalizedRisk = rawRisk ? {
        ...rawRisk,
        score: rawRisk.risk_score != null ? rawRisk.risk_score : (rawRisk.score || 0),
        level: rawRisk.risk_level || rawRisk.level || 'LOW',
        rainfall: rawRisk.rainfall_24h_mm != null ? rawRisk.rainfall_24h_mm : (rawRisk.rainfall || 0),
        rainfall_24h_mm: rawRisk.rainfall_24h_mm != null ? rawRisk.rainfall_24h_mm : (rawRisk.rainfall || 0),
      } : null;

      setRisk(normalizedRisk);
      setWeather(bundle.weather || null);
      setIncidents(bundle.incidents || []);
      setVolunteers(bundle.volunteers || []);
      setActiveAssistance(bundle.active_assistance || null);
      setSource('live');
      setLastUpdated(Date.now());
      setBackendError(null);
      setCachedAt(null);
      saveJSON(CACHE_KEY, { savedAt: Date.now(), risk: normalizedRisk, weather: bundle.weather || null, incidents: bundle.incidents || [],
        volunteers: bundle.volunteers || [], zoneAlerts: alertsRes || [], roadStatus: roadsRes || roadStatusRef.current, weatherMonitor: monitorRes || monitorRef.current, intel: intelRes || intelRef.current });
    } catch (err) {
      setSource('offline');
      setBackendError('Unable to connect to the server.');
      const saved = await loadJSON(CACHE_KEY); // the last real data we received, clearly labelled as saved, never invented
      if (saved && !riskRef.current) {
        setRisk(saved.risk); setWeather(saved.weather); setIncidents(saved.incidents); setVolunteers(saved.volunteers);
        setZoneAlerts(saved.zoneAlerts); setRoadStatus(saved.roadStatus); setWeatherMonitor(saved.weatherMonitor); setIntel(saved.intel || null);
      }
      if (saved) setCachedAt(saved.savedAt);
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }, []);

  // Tell the backend where this user last was (used only to decide who receives an area alert), at most every 5 minutes.
  useEffect(() => {
    if (userLocation && Date.now() - lastPosted.current > 300000) {
      lastPosted.current = Date.now();
      saveMyLocation(userLocation.latitude, userLocation.longitude).catch(() => {});
    }
  }, [userLocation]);

  // Hospitals and shelters change rarely: load them on start and every 10 minutes.
  useEffect(() => {
    if (!userLocation) return undefined;
    const load = () => getPlaces(userLocation.latitude, userLocation.longitude).then(setPlaces).catch(() => {});
    load();
    const id = setInterval(load, 600000);
    return () => clearInterval(id);
  }, [userLocation && Math.round(userLocation.latitude * 20), userLocation && Math.round(userLocation.longitude * 20)]); // eslint-disable-line react-hooks/exhaustive-deps

  // poll every POLL_MS; moving ~100 m (3rd decimal of a degree) refreshes straight away, smaller GPS jitter does not
  const coarse = userLocation ? `${userLocation.latitude.toFixed(3)},${userLocation.longitude.toFixed(3)}` : null;
  useEffect(() => {
    if (coarse) {
      refresh();
      const interval = setInterval(refresh, POLL_MS);
      return () => clearInterval(interval);
    }
  }, [coarse, refresh]);

  // 4. Manual location fallback if permission denied
  const applyManualLocation = useCallback(async (lat, lng, customLabel = null) => {
    const loc = { latitude: lat, longitude: lng, accuracy: null, timestamp: Date.now(), source: 'manual' };
    setManualLocation(loc);
    locRef.current = loc;
    setUserLocation(loc);
    setLocationMeta({ accuracy: null, timestamp: loc.timestamp, source: 'manual' });
    setLocationStatus('manual');
    const label = customLabel || (await reverseGeocodeLocation(lat, lng)) || formatCoordinates(lat, lng);
    setLocationLabel(label);
  }, []);

  // the "Enable location" buttons on Home, Report and Help: ask, or send the person to Settings when the system will not ask again
  const requestPermission = useCallback(async () => {
    const state = await getLocationState();
    if (state === 'blocked' || state === 'services_off') {
      setGateDismissed(false);
      setLocationStatus(state);
      return;
    }
    await askLocation();
  }, [askLocation]);

  const SEVERITY_RANK = { LOW: 1, MEDIUM: 2, MODERATE: 2, HIGH: 3, CRITICAL: 4 };
  const rank = (lvl) => SEVERITY_RANK[lvl] || 0;

  // Blocked roads: reported incidents plus roads an admin has closed (shown as full road lines on the map).
  const blocked = useMemo(() => {
    const fromIncidents = incidents
      .filter((inc) => (inc.type === 'BLOCKED_ROAD' || inc.type === 'FLOODED_ROAD') && inc.status !== 'RESOLVED')
      .map((inc) => ({
        id: `incident-${inc.id}`, // own namespace: an incident id must never equal a road id
        name: inc.description || `${inc.type.replace('_', ' ')} #${inc.id}`,
        latitude: inc.latitude,
        longitude: inc.longitude,
        status: 'BLOCKED',
      }));
    const fromAdmin = roadStatus
      .filter((r) => r.status === 'BLOCKED' || r.risk_state === 'VERIFIED_BLOCKED' || r.risk_state === 'REPORTED_BLOCKED')
      .map((r) => ({ id: `road-${r.id}`, name: r.name, coordinates: r.coordinates, status: 'BLOCKED', closedByAdmin: r.status === 'BLOCKED', riskState: r.risk_state }));
    return [...fromAdmin, ...fromIncidents];
  }, [incidents, roadStatus]);

  // Alerts: only backend-generated alerts (engine, satellite, admin broadcasts, drills). Community incident reports are
  // listed separately as report notices, so a single unverified report never looks like an official alert.
  const alerts = useMemo(() => {
    const fromBackend = zoneAlerts.map((a) => ({
      id: `zone-${a.id}`,
      severity: a.severity,
      message: a.message,
      reason: a.reason,
      affected_zone: a.affected_zone,
      affected_road: a.affected_road,
      risk_score: a.risk_score,
      created_at: a.updated_at || a.created_at,
      drill: !!a.simulated || /^SIMULATED DRILL/i.test(a.message || ''),
      sources: a.sources || [],
      recommended_action: a.recommended_action,
      probability: a.probability,
    }));
    return fromBackend.sort(
      (a, b) =>
        rank(b.severity) - rank(a.severity) ||
        String(a.affected_zone || '').localeCompare(String(b.affected_zone || '')) || // steady order between equal alerts
        String(b.created_at).localeCompare(String(a.created_at))
    );
  }, [zoneAlerts]);

  // Significant community reports (flooded / blocked roads, severity 3+): shown under "Community reports", never as alerts.
  const reportNotices = useMemo(() => incidents
    .filter((inc) => inc.status !== 'RESOLVED' && (inc.severity >= 3 || inc.type === 'FLOODED_ROAD' || inc.type === 'BLOCKED_ROAD'))
    .map((inc) => ({ id: inc.id, type: inc.type, status: inc.status, description: inc.description, trustScore: inc.trustScore, confidence: inc.confidence,
      latitude: inc.latitude, longitude: inc.longitude, created_at: inc.timestamp || inc.created_at }))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), [incidents]);

  // Effective risk: the position-based reading, raised to the strongest active zone alert if that is higher.
  const effectiveRisk = useMemo(() => {
    if (!risk) return risk;
    // a zone alert covers a circle around its zone centre: it raises the risk only for people inside it (alerts without an
    // area, e.g. an admin broadcast to everyone, apply everywhere). The exit route uses the same area.
    const covers = (al) => {
      if (al.zone_latitude == null || al.zone_longitude == null || !al.area_radius_km || !userLocation) return true;
      const k = Math.cos((userLocation.latitude * Math.PI) / 180);
      const dkm = Math.hypot((userLocation.latitude - al.zone_latitude) * 110.54, (userLocation.longitude - al.zone_longitude) * 111.32 * k);
      return dkm <= al.area_radius_km;
    };
    const top = zoneAlerts.filter(covers).reduce((best, a) => (rank(a.severity) > rank(best?.severity) ? a : best), null);
    if (top && rank(top.severity) > rank(risk.level)) {
      return {
        ...risk,
        level: top.severity,
        risk_level: top.severity,
        score: Math.max(risk.score || 0, top.risk_score || 0),
        risk_score: Math.max(risk.score || 0, top.risk_score || 0),
        reason: top.reason || top.message,
        // the explanation must match the raised level: the position-based signals, evidence tier and action described the
        // lower reading and would contradict the alert ("NORMAL ... no action needed" under CRITICAL)
        signals: [],
        evidence_tier: undefined,
        evidence_tier_note: undefined,
        recommended_action: top.recommended_action || (rank(top.severity) >= rank('HIGH')
          ? 'Leave the flagged flood area by the lower-risk route shown in the app, or move to higher ground. Follow official instructions.'
          : risk.recommended_action),
        zoneAlert: true,
        drill: /^SIMULATED DRILL/i.test(top.message || ''),
      };
    }
    return risk;
  }, [risk, zoneAlerts, userLocation && userLocation.latitude, userLocation && userLocation.longitude]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = {
    loading,
    userLocation,
    locationLabel,
    locationStatus,
    locationMeta,
    locBusy,
    showLocationGate: !gateDismissed && ['undetermined', 'blocked', 'services_off'].includes(locationStatus),
    askLocation,
    retryLocation,
    dismissLocationGate,
    openLocationSettings,
    risk: effectiveRisk,
    gpsRisk: risk,
    weather,
    weatherMonitor,
    places,
    intel,
    cachedAt,
    incidents,
    volunteers,
    blocked,
    roads: roadStatus,
    alerts,
    reportNotices,
    activeAssistance,
    source,
    lastUpdated,
    backendError,
    refresh,
    requestPermission,
    applyManualLocation,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
