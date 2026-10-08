import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useData } from './DataContext';
import { useAuth } from './AuthContext';
import { computeRoute as apiComputeRoute, requestHelp as apiRequestHelp } from '../services/api';

const ResponseContext = createContext(null);
export const useResponse = () => useContext(ResponseContext);

// The backend stores a volunteer's extra resources as a JSON list text ("[]" when empty). Never show that raw text:
// use the listed resources if there are any, otherwise the volunteer's main skill.
export function cleanResource(v) {
  const raw = v && (v.resources != null ? v.resources : v.resource);
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === 'string' && raw.trim() && raw.trim() !== '[]') {
    try { const parsed = JSON.parse(raw); list = Array.isArray(parsed) ? parsed : [String(parsed)]; } catch (e) { list = [raw]; }
  }
  const names = list.map((x) => String(x).trim()).filter(Boolean);
  const text = names.length ? names.join(', ') : (v && v.skill) || 'Assistance';
  return text.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

export const RESOURCES = [
  'Medical Emergency',
  'Flood Rescue',
  'Evacuation',
  'Elderly Assistance',
  'Child Assistance',
  'Food / Water',
  'Transport',
  'First Aid',
  'Other Emergency',
];

export function ResponseProvider({ children }) {
  const { userLocation, risk, volunteers: liveVolunteers, blocked, refresh } = useData();
  const { user } = useAuth();

  const [resource, setResource] = useState('Medical Emergency');
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
      const none = {
        success: false, distanceKm: 0, etaMinutes: 0, coordinates: [], blockedRoads: [],
        reason: 'No destination is available yet. Request help first, or wait for a nearby responder.',
      };
      setRoute(none);
      return none;
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
          status: res.status || 'CLEAR',
          distanceKm: res.distanceKm,
          etaMinutes: res.etaMinutes,
          coordinates: res.polyline || [],
          blockedRoads: (res.avoidedIncidents || []).map((inc) => ({
            id: String(inc.id),
            name: inc.description || inc.type,
          })),
          reason: (res.avoidedIncidents || []).length > 0
            ? 'Avoids reported hazard / blocked road'
            : 'Optimal street network path',
          safetyNote: res.safetyNote || 'Recommended alternative route based on current environmental and incident data.',
          source: res.source,
          hasAlternate: !!res.hasAlternate,
          primaryRoute: res.primaryRoute,
          alternateRoute: res.alternateRoute,
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
      const failed = {
        success: false, distanceKm: 0, etaMinutes: 0, coordinates: [], blockedRoads: [],
        reason: 'The route service could not be reached. Check your connection and try again.',
      };
      setRoute(failed); // show an error, never a blank screen
      return failed;
    } finally {
      setIsRouting(false);
    }
  }, [userLocation, destinationVolunteer, liveVolunteers]);

  // Request help & match with real volunteer responder
  const requestResource = useCallback(async (options = {}, priorityArg, quantityArg, keyArg) => {
    const opts = typeof options === 'string' ? { type: options, priority: priorityArg, quantity: quantityArg, idempotencyKey: keyArg } : (options || {});
    const reqType = opts.type || resource;
    const priority = opts.priority || 'HIGH';
    const loc = opts.latitude != null && opts.longitude != null
      ? { latitude: opts.latitude, longitude: opts.longitude }
      : userLocation;

    if (!loc) {
      return { matched: false, failed: true, message: 'Your location is required to request help. Turn on location and try again.' };
    }

    try {
      const result = await apiRequestHelp({
        type: reqType,
        priority,
        quantity: opts.quantity || 1,
        idempotencyKey: opts.idempotencyKey,
        latitude: loc.latitude,
        longitude: loc.longitude,
        userId: user ? user.id : undefined,
        destination_lat: opts.destination_lat,
        destination_lng: opts.destination_lng,
        phone: opts.phone,
        notes: opts.notes,
        description: opts.description,
        photo_url: opts.photo_url,
        is_manual_location: !!opts.is_manual_location,
      });

      if (result && result.match && result.match.matched && result.match.volunteer) {
        const vol = { ...result.match.volunteer, resource: cleanResource(result.match.volunteer) };
        setDestinationVolunteer(vol);
        setDestinationLabel(`${vol.name} (${vol.resource || vol.skill})`);
        const cleaned = { ...result.match, volunteer: vol, requestId: result.requestId };
        setMatch(cleaned);

        // Immediately compute live route to matched volunteer
        await requestRoute({ latitude: vol.latitude, longitude: vol.longitude });
        return cleaned;
      } else {
        const noMatch = result.match || { matched: false, message: 'No nearby matching responder found.' };
        const cleaned = { ...noMatch, requestId: result.requestId };
        setMatch(cleaned);
        return cleaned;
      }
    } catch (err) {
      const fallbackFail = { matched: false, failed: true, message: 'Could not reach the server to send your request. Check your connection and try again.' };
      setMatch(fallbackFail);
      return fallbackFail;
    }
  }, [userLocation, resource, requestRoute, user]);

  const reset = useCallback(() => {
    setRoute(null);
    setMatch(null);
    setResource('Medicine');
    setDestinationVolunteer(null);
    setDestinationLabel('Nearest Response Hub');
    refresh();
  }, [refresh]);


  // Adapt volunteers for map rendering
  const mappedVolunteers = useMemo(() => {
    return (liveVolunteers || []).map((v) => ({
      id: String(v.id),
      name: v.name,
      resource: cleanResource(v),
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
    reset,
  };

  return <ResponseContext.Provider value={value}>{children}</ResponseContext.Provider>;
}
