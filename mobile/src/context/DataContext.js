import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { POLL_MS, USE_DEVICE_LOCATION } from '../config/api';
import { syncTelemetry } from '../services/api';
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
      const bundle = await syncTelemetry(userLocation.latitude, userLocation.longitude);
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
      setBackendError('Backend sync offline. Displaying cached telemetry.');
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

  // Filter blocked roads from active incidents
  const blocked = useMemo(() => {
    return incidents.filter(
      (inc) => (inc.type === 'BLOCKED_ROAD' || inc.type === 'FLOODED_ROAD') && inc.status !== 'RESOLVED'
    ).map((inc) => ({
      id: inc.id,
      name: inc.description || `${inc.type.replace('_', ' ')} #${inc.id}`,
      latitude: inc.latitude,
      longitude: inc.longitude,
      status: 'BLOCKED',
    }));
  }, [incidents]);

  // Map active incidents to alerts
  const alerts = useMemo(() => {
    return incidents
      .filter((inc) => inc.status !== 'RESOLVED' && (inc.severity >= 3 || inc.type === 'FLOODED_ROAD' || inc.type === 'BLOCKED_ROAD'))
      .map((inc) => ({
        id: inc.id,
        severity: inc.severity >= 4 ? 'HIGH' : inc.severity === 3 ? 'MODERATE' : 'LOW',
        message: inc.description || `${inc.type.replace('_', ' ')} verified in monitored sector`,
        affected_zone: locationLabel,
        created_at: inc.timestamp || inc.created_at,
      }));
  }, [incidents, locationLabel]);

  const value = {
    loading,
    userLocation,
    locationLabel,
    locationStatus,
    risk,
    weather,
    incidents,
    volunteers,
    blocked,
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
