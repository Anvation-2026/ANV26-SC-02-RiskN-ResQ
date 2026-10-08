import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useData } from './DataContext';
import { computeRoute as apiComputeRoute, requestHelp as apiRequestHelp } from '../services/api';

const ResponseContext = createContext(null);
export const useResponse = () => useContext(ResponseContext);

export const RESOURCES = ['Medicine', 'Food', 'Water', 'First Aid', 'Evacuation'];

export function ResponseProvider({ children }) {
  const { userLocation, risk, volunteers: liveVolunteers, blocked, refresh } = useData();

  const [resource, setResource] = useState('Medicine');
  const [match, setMatch] = useState(null);
  const [route, setRoute] = useState(null);
  const [destinationVolunteer, setDestinationVolunteer] = useState(null);
  const [destinationLabel, setDestinationLabel] = useState('Nearest Response Hub');
  const [isRouting, setIsRouting] = useState(false);

  // Assess risk zone based on real environmental telemetry
  const assessment = useMemo(() => {
    if (!risk) {
      return { insideRiskZone: false, riskLevel: 'LOW', distanceKm: 0 };
    }
    const isInside = risk.risk_level === 'HIGH' || risk.risk_level === 'CRITICAL';
    return {
      insideRiskZone: isInside,
      riskLevel: risk.risk_level || 'LOW',
      distanceKm: 0,
      reason: risk.reason,
    };
  }, [risk]);

  // Request Route to target destination using backend incident-aware router
  const requestRoute = useCallback(async (targetDest = null) => {
    if (!userLocation) return null;
    const dest = targetDest || (destinationVolunteer ? {
      latitude: destinationVolunteer.latitude,
      longitude: destinationVolunteer.longitude,
    } : null);

    if (!dest) {
      // If no destination specified, route to first nearby volunteer or 1km north
      if (liveVolunteers && liveVolunteers.length > 0) {
        const firstVol = liveVolunteers[0];
        return requestRoute({ latitude: firstVol.latitude, longitude: firstVol.longitude });
      }
      return null;
    }

    setIsRouting(true);
    try {
      const res = await apiComputeRoute(
        { latitude: userLocation.latitude, longitude: userLocation.longitude },
        dest
      );

      if (res && res.success) {
        const transformedRoute = {
          success: true,
          distanceKm: res.distanceKm,
          etaMinutes: res.etaMinutes,
          coordinates: res.polyline || [],
          blockedRoads: (res.avoidedIncidents || []).map((inc) => ({
            id: String(inc.id),
            name: inc.description || inc.type,
          })),
          reason: (res.avoidedIncidents || []).length > 0
            ? 'Avoids reported blocked road'
            : 'Optimal street network path',
          safetyNote: res.safetyNote || 'Recommended alternative route based on available route and incident data.',
          source: res.source,
        };
        setRoute(transformedRoute);
        return transformedRoute;
      } else {
        const failedRoute = {
          success: false,
          distanceKm: 0,
          etaMinutes: 0,
          coordinates: [],
          blockedRoads: [],
          reason: res?.message || 'No traversable route found',
          safetyNote: res?.safetyNote || 'All known corridors may be blocked by active hazards.',
        };
        setRoute(failedRoute);
        return failedRoute;
      }
    } catch (err) {
      console.warn('Route computation error:', err);
      return null;
    } finally {
      setIsRouting(false);
    }
  }, [userLocation, destinationVolunteer, liveVolunteers]);

  // Request help & match with real volunteer responder
  const requestResource = useCallback(async (name = resource, priority = 'HIGH') => {
    if (!userLocation) {
      return { matched: false, message: 'Device location required for emergency request.' };
    }

    try {
      const result = await apiRequestHelp({
        type: name,
        priority,
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
      });

      if (result && result.match && result.match.matched && result.match.volunteer) {
        const vol = result.match.volunteer;
        setDestinationVolunteer(vol);
        setDestinationLabel(`${vol.name} (${vol.resource || vol.skill})`);
        setMatch(result.match);

        // Immediately compute live route to matched volunteer
        await requestRoute({ latitude: vol.latitude, longitude: vol.longitude });
        return result.match;
      } else {
        setMatch(result.match || { matched: false, message: 'No nearby matching responder found.' });
        return result.match;
      }
    } catch (err) {
      const fallbackFail = { matched: false, message: 'Emergency dispatch request timed out.' };
      setMatch(fallbackFail);
      return fallbackFail;
    }
  }, [userLocation, resource, requestRoute]);

  const reset = useCallback(() => {
    setRoute(null);
    setMatch(null);
    setResource('Medicine');
    setDestinationVolunteer(null);
    setDestinationLabel('Nearest Response Hub');
    refresh();
  }, [refresh]);

  // Block/unblock stubs for backward-compatibility with UI
  const block = useCallback(() => {}, []);
  const unblock = useCallback(() => {}, []);

  // Adapt volunteers for map rendering
  const mappedVolunteers = useMemo(() => {
    return (liveVolunteers || []).map((v) => ({
      id: String(v.id),
      name: v.name,
      resource: v.resources || v.skill || 'Assistance',
      latitude: v.latitude,
      longitude: v.longitude,
      availability: v.available ? 'AVAILABLE' : 'UNAVAILABLE',
    }));
  }, [liveVolunteers]);

  const value = {
    userLocation,
    assessment,
    route,
    match,
    resource,
    setResource,
    volunteers: mappedVolunteers,
    destinationVolunteer,
    destinationLabel,
    isRouting,
    roads: [],
    zones: [],
    graph: null,
    roadDemo: blocked && blocked.length > 0 ? blocked[0] : null,
    requestRoute,
    requestResource,
    block,
    unblock,
    reset,
  };

  return <ResponseContext.Provider value={value}>{children}</ResponseContext.Provider>;
}
