// State for the geospatial disaster-response flow (route + road state + resource matching).
// All logic comes from src/features/disaster-response; this context only holds state.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { USE_DEVICE_LOCATION } from '../config/api';
import { useData } from './DataContext';
import { syncRoadA } from '../services/api';
import { getCurrentUserLocation, DEMO_FALLBACK_LOCATION } from '../features/disaster-response/services/geolocation';
import { isInsideRiskZone } from '../features/disaster-response/services/geofencing';
import { findRecommendedRoute, blockRoad, unblockRoad } from '../features/disaster-response/services/routing';
import { findBestVolunteerMatch } from '../features/disaster-response/services/matching';
import { INITIAL_MOCK_ROADS, INITIAL_ROAD_GRAPH } from '../features/disaster-response/data/mockRoads';
import { MOCK_RISK_ZONES, PRIMARY_DEMO_RISK_ZONE } from '../features/disaster-response/data/mockHazards';
import { MOCK_VOLUNTEERS } from '../features/disaster-response/data/mockVolunteers';

const ResponseContext = createContext(null);
export const useResponse = () => useContext(ResponseContext);

export const ORIGIN_NODE = 'A';
export const DESTINATION_NODE = 'D';
export const DEMO_ROAD_ID = 'ROAD_A';
export const RESOURCES = ['Medicine', 'Food', 'Water', 'First Aid', 'Evacuation'];

export function ResponseProvider({ children }) {
  const { refresh, roads: backendRoads, source } = useData();
  const [userLocation, setUserLocation] = useState(DEMO_FALLBACK_LOCATION);
  const [roads, setRoads] = useState(INITIAL_MOCK_ROADS);
  const [route, setRoute] = useState(null);
  const [resource, setResource] = useState('Medicine');
  const [match, setMatch] = useState(null);
  const [destinationNode, setDestinationNode] = useState(DESTINATION_NODE);
  const [destinationVolunteer, setDestinationVolunteer] = useState(null);

  useEffect(() => {
    if (USE_DEVICE_LOCATION) getCurrentUserLocation().then(setUserLocation);
  }, []);

  // When the backend is live, its road state is the truth: an admin blocking Road A there must show up here
  // (and in every user's route) without anyone touching local controls.
  useEffect(() => {
    if (source !== 'live' || !backendRoads || !backendRoads.length) return;
    const blockedUpstream = backendRoads[0].status === 'BLOCKED'; // backend "Road A" <-> module ROAD_A
    setRoads((prev) => {
      const blockedNow = prev.find((r) => r.id === DEMO_ROAD_ID)?.status === 'BLOCKED';
      if (blockedNow === blockedUpstream) return prev;
      return blockedUpstream ? blockRoad(DEMO_ROAD_ID, prev) : unblockRoad(DEMO_ROAD_ID, prev);
    });
  }, [source, backendRoads]);

  const assessment = useMemo(() => isInsideRiskZone(userLocation, PRIMARY_DEMO_RISK_ZONE), [userLocation]);

  const compute = useCallback(
    (currentRoads, targetNode = destinationNode, volunteer = destinationVolunteer) => {
      const res = findRecommendedRoute(ORIGIN_NODE, targetNode, currentRoads, INITIAL_ROAD_GRAPH);
      if (res && res.success && volunteer && res.coordinates.length > 0) {
        // Ensure terminal coordinate strictly connects to volunteer pin
        const coords = [...res.coordinates];
        coords[coords.length - 1] = {
          latitude: volunteer.latitude,
          longitude: volunteer.longitude,
        };
        return { ...res, coordinates: coords };
      }
      return res;
    },
    [destinationNode, destinationVolunteer]
  );

  const requestRoute = useCallback(() => {
    setRoute(compute(roads, destinationNode, destinationVolunteer));
  }, [roads, destinationNode, destinationVolunteer, compute]);

  // Keep an already-requested route in sync whenever road state changes.
  const applyRoads = useCallback(
    (next) => {
      setRoads(next);
      if (route) {
        setRoute(compute(next, destinationNode, destinationVolunteer));
      }
    },
    [route, destinationNode, destinationVolunteer, compute]
  );

  const block = useCallback(() => {
    applyRoads(blockRoad(DEMO_ROAD_ID, roads));
    syncRoadA(true).then(refresh);
  }, [roads, applyRoads, refresh]);

  const unblock = useCallback(() => {
    applyRoads(unblockRoad(DEMO_ROAD_ID, roads));
    syncRoadA(false).then(refresh);
  }, [roads, applyRoads, refresh]);

  const requestResource = useCallback(
    (name = resource, priority = 'HIGH') => {
      const matchResult = findBestVolunteerMatch(
        { resource: name, priority, latitude: userLocation.latitude, longitude: userLocation.longitude },
        MOCK_VOLUNTEERS
      );
      setMatch(matchResult);
      if (matchResult && matchResult.matched && matchResult.volunteer) {
        const vol = matchResult.volunteer;
        setDestinationVolunteer(vol);
        const target = vol.id === 'VOL001' ? 'D' :
                       vol.id === 'VOL002' ? 'C' :
                       vol.id === 'VOL003' ? 'E' :
                       vol.id === 'VOL005' ? 'F' : 'D';
        setDestinationNode(target);
        setRoute(compute(roads, target, vol));
      }
      return matchResult;
    },
    [resource, userLocation, roads, compute]
  );

  const reset = useCallback(() => {
    setRoads(INITIAL_MOCK_ROADS);
    setRoute(null);
    setMatch(null);
    setResource('Medicine');
    setDestinationNode(DESTINATION_NODE);
    setDestinationVolunteer(null);
    syncRoadA(false).then(refresh);
  }, [refresh]);

  const value = {
    userLocation, roads, route, match, resource, setResource, assessment,
    zones: MOCK_RISK_ZONES, graph: INITIAL_ROAD_GRAPH, volunteers: MOCK_VOLUNTEERS,
    roadDemo: roads.find((r) => r.id === DEMO_ROAD_ID),
    destinationNode, destinationVolunteer,
    destinationLabel: destinationVolunteer ? `${destinationVolunteer.name} (${destinationVolunteer.resource})` : 'Relief Station Alpha',
    requestRoute, block, unblock, requestResource, reset,
  };
  return <ResponseContext.Provider value={value}>{children}</ResponseContext.Provider>;
}
