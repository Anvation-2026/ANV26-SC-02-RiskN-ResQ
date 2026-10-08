import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { POLL_MS, USE_DEVICE_LOCATION } from '../config/api';
import { getRoadStatus, getZoneAlerts, syncTelemetry } from '../services/api';
import {
  checkLocationPermission,
  requestLocationPermission,
  getLiveCurrentPosition,
  subscribeToLiveLocation,
  reverseGeocodeLocation,
  formatCoordinates,
  setManualLocation,
} from '../services/locationService';

const DataContext = createContext(null);
export const useData = () => useContext(DataContext);

export function DataProvider({ children }) {
  const [userLocation, setUserLocation] = useState(null);
  const [locationLabel, setLocationLabel] = useState('Acquiring GPS...');
  const [locationStatus, setLocationStatus] = useState('undetermined');
  const [loading, setLoading] = useState(true);
  const [risk, setRisk] = useState(null);
  const [weather, setWeather] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [zoneAlerts, setZoneAlerts] = useState([]); // admin/engine alerts from GET /alerts
  const [roadStatus, setRoadStatus] = useState([]); // admin-managed road state from GET /roads
  const [source, setSource] = useState('live');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [backendError, setBackendError] = useState(null);

  const busyRef = useRef(false);

  // 1. Initialise device location
  const initLocation = useCallback(async () => {
    try {
      const status = await checkLocationPermission();
      setLocationStatus(status);
      if (status === 'granted') {
        const loc = await getLiveCurrentPosition();
        setUserLocation(loc);
        const label = await reverseGeocodeLocation(loc.latitude, loc.longitude);
        setLocationLabel(label);
      } else {
        const reqStatus = await requestLocationPermission();
        setLocationStatus(reqStatus);
        if (reqStatus === 'granted') {
          const loc = await getLiveCurrentPosition();
          setUserLocation(loc);
          const label = await reverseGeocodeLocation(loc.latitude, loc.longitude);
          setLocationLabel(label);
        } else {
          setLocationStatus('denied');
          setLocationLabel('Location Permission Required');
          setLoading(false);
        }
      }
    } catch (e) {
      setLocationStatus('denied');
      setLocationLabel('Location Permission Required');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (USE_DEVICE_LOCATION) {
      initLocation();
    }
  }, [initLocation]);

  // 2. Subscribe to live position updates
  useEffect(() => {
    if (locationStatus === 'granted') {
      const unsub = subscribeToLiveLocation(async (loc) => {
        setUserLocation(loc);
        const label = await reverseGeocodeLocation(loc.latitude, loc.longitude);
        setLocationLabel(label);
      });
      return unsub;
    }
  }, [locationStatus]);

  // 3. Sync telemetry with backend
  const refresh = useCallback(async () => {
    if (!userLocation) return;
    if (busyRef.current) return;
    busyRef.current = true;

    try {
      const [bundle, alertsRes, roadsRes] = await Promise.all([
        syncTelemetry(userLocation.latitude, userLocation.longitude),
        getZoneAlerts().catch(() => null), // a failure here must not hide the rest of the telemetry
        getRoadStatus().catch(() => null),
      ]);
      if (alertsRes) setZoneAlerts(alertsRes);
      if (roadsRes) setRoadStatus(roadsRes);
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
      setSource('live');
      setLastUpdated(Date.now());
      setBackendError(null);
    } catch (err) {
      setSource('offline');
      setBackendError('Unable to connect to the server.');
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }, [userLocation]);

  useEffect(() => {
    if (userLocation) {
      refresh();
      const interval = setInterval(refresh, POLL_MS);
      return () => clearInterval(interval);
    }
  }, [userLocation, refresh]);

  // 4. Manual location fallback if permission denied
  const applyManualLocation = useCallback(async (lat, lng, customLabel = null) => {
    const loc = { latitude: lat, longitude: lng, accuracy: 10, timestamp: Date.now() };
    setManualLocation(loc);
    setUserLocation(loc);
    setLocationStatus('manual');
    const label = customLabel || (await reverseGeocodeLocation(lat, lng)) || formatCoordinates(lat, lng);
    setLocationLabel(label);
  }, []);

  const requestPermission = useCallback(async () => {
    const status = await requestLocationPermission();
    setLocationStatus(status);
    if (status === 'granted') {
      const loc = await getLiveCurrentPosition();
      setUserLocation(loc);
      const label = await reverseGeocodeLocation(loc.latitude, loc.longitude);
      setLocationLabel(label);
    }
  }, []);

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
      .filter((r) => r.status === 'BLOCKED')
      .map((r) => ({ id: `road-${r.id}`, name: r.name, coordinates: r.coordinates, status: 'BLOCKED', closedByAdmin: true }));
    return [...fromAdmin, ...fromIncidents];
  }, [incidents, roadStatus]);

  // Alerts: zone alerts from the backend (with reason and affected road) plus incident-based notices.
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
      drill: /^SIMULATED DRILL/i.test(a.message || ''),
    }));
    const fromIncidents = incidents
      .filter((inc) => inc.status !== 'RESOLVED' && (inc.severity >= 3 || inc.type === 'FLOODED_ROAD' || inc.type === 'BLOCKED_ROAD'))
      .map((inc) => ({
        id: `inc-${inc.id}`,
        severity: inc.severity >= 4 ? 'HIGH' : inc.severity === 3 ? 'MODERATE' : 'LOW',
        message: inc.description || `${inc.type.replace('_', ' ')} reported in monitored sector`,
        affected_zone: locationLabel,
        created_at: inc.timestamp || inc.created_at,
      }));
    return [...fromBackend, ...fromIncidents].sort(
      (a, b) =>
        rank(b.severity) - rank(a.severity) ||
        String(a.affected_zone || '').localeCompare(String(b.affected_zone || '')) || // steady order between equal alerts
        String(b.created_at).localeCompare(String(a.created_at))
    );
  }, [zoneAlerts, incidents, locationLabel]);

  // Effective risk: the position-based reading, raised to the strongest active zone alert if that is higher.
  const effectiveRisk = useMemo(() => {
    if (!risk) return risk;
    const top = zoneAlerts.reduce((best, a) => (rank(a.severity) > rank(best?.severity) ? a : best), null);
    if (top && rank(top.severity) > rank(risk.level)) {
      return {
        ...risk,
        level: top.severity,
        risk_level: top.severity,
        score: Math.max(risk.score || 0, top.risk_score || 0),
        risk_score: Math.max(risk.score || 0, top.risk_score || 0),
        reason: top.reason || top.message,
        zoneAlert: true,
        drill: /^SIMULATED DRILL/i.test(top.message || ''),
      };
    }
    return risk;
  }, [risk, zoneAlerts]);

  const value = {
    loading,
    userLocation,
    locationLabel,
    locationStatus,
    risk: effectiveRisk,
    gpsRisk: risk,
    weather,
    incidents,
    volunteers,
    blocked,
    roads: roadStatus,
    alerts,
    source,
    lastUpdated,
    backendError,
    refresh,
    requestPermission,
    applyManualLocation,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
