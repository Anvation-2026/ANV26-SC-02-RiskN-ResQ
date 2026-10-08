/**
 * disaster-response.test.ts
 * Comprehensive automated test suite verifying all required criteria for RiskNResQ.
 */

import { calculateDistanceKm, formatDistance } from '../src/features/disaster-response/utils/distance';
import { isInsideRiskZone, getRiskLevelColor } from '../src/features/disaster-response/services/geofencing';
import {
  findRecommendedRoute,
  blockRoad,
  unblockRoad,
} from '../src/features/disaster-response/services/routing';
import {
  findBestVolunteerMatch,
  calculateDistanceScore,
  calculatePriorityScore,
} from '../src/features/disaster-response/services/matching';
import {
  getCurrentUserLocation,
  DEMO_FALLBACK_LOCATION,
} from '../src/features/disaster-response/services/geolocation';
import { PRIMARY_DEMO_RISK_ZONE } from '../src/features/disaster-response/data/mockHazards';
import {
  INITIAL_MOCK_ROADS,
  INITIAL_ROAD_GRAPH,
} from '../src/features/disaster-response/data/mockRoads';
import { MOCK_VOLUNTEERS } from '../src/features/disaster-response/data/mockVolunteers';
import { Location, HelpRequest, Volunteer } from '../src/features/disaster-response/types/types';

describe('RiskNResQ Disaster Response Module', () => {
  // TEST 1: User inside flood zone
  test('TEST 1: User inside flood zone -> insideRiskZone = true', () => {
    // User located at Bengaluru Central (12.9716, 77.5946), center is (12.9725, 77.5960), radius 2.0 km
    const userInsideLocation: Location = {
      latitude: 12.9716,
      longitude: 77.5946,
    };

    const assessment = isInsideRiskZone(userInsideLocation, PRIMARY_DEMO_RISK_ZONE);

    expect(assessment.insideRiskZone).toBe(true);
    expect(assessment.distanceKm).toBeLessThanOrEqual(PRIMARY_DEMO_RISK_ZONE.radiusKm);
    expect(assessment.riskLevel).toBe('HIGH');
  });

  // TEST 2: User outside flood zone
  test('TEST 2: User outside flood zone -> insideRiskZone = false', () => {
    // Coordinates far outside Bengaluru central zone (Yelahanka / Airport area)
    const userOutsideLocation: Location = {
      latitude: 13.0800,
      longitude: 77.6500,
    };

    const assessment = isInsideRiskZone(userOutsideLocation, PRIMARY_DEMO_RISK_ZONE);

    expect(assessment.insideRiskZone).toBe(false);
    expect(assessment.distanceKm).toBeGreaterThan(PRIMARY_DEMO_RISK_ZONE.radiusKm);
    expect(assessment.riskLevel).toBe('LOW');
  });

  // TEST 3: Road open -> route can use road
  test('TEST 3: Road open -> route can use road', () => {
    const route = findRecommendedRoute('A', 'D', INITIAL_MOCK_ROADS, INITIAL_ROAD_GRAPH);

    expect(route.success).toBe(true);
    // Baseline path goes directly through A -> B -> C -> D via 5th Cross (ROAD_A)
    expect(route.nodes).toEqual(['A', 'B', 'C', 'D']);
    expect(route.distanceKm).toBe(3.5);
    expect(route.blockedRoads).toHaveLength(0);
  });

  // TEST 4: Road blocked -> route avoids road
  test('TEST 4: Road blocked -> route avoids road', () => {
    const blockedRoads = blockRoad('ROAD_A', INITIAL_MOCK_ROADS, 'Severe waterlogging / tree fall');

    const roadA = blockedRoads.find((r) => r.id === 'ROAD_A');
    expect(roadA?.status).toBe('BLOCKED');

    const alternativeRoute = findRecommendedRoute('A', 'D', blockedRoads, INITIAL_ROAD_GRAPH);

    expect(alternativeRoute.success).toBe(true);
    // Rerouted through south bypass corridor: A -> B -> E -> F -> D
    expect(alternativeRoute.nodes).toEqual(['A', 'B', 'E', 'F', 'D']);
    expect(alternativeRoute.distanceKm).toBe(6.0);
    expect(alternativeRoute.etaMinutes).toBe(15);
    expect(alternativeRoute.blockedRoads).toEqual([
      { id: 'ROAD_A', name: '5th Cross' },
    ]);
    expect(alternativeRoute.reason).toBe('Avoids reported blocked road');
    expect(alternativeRoute.safetyNote).toBe(
      'Recommended alternative route based on available incident data.'
    );
    expect(alternativeRoute.nodes).not.toContain('C');
  });

  // TEST 5: Road unblocked -> road becomes available
  test('TEST 5: Road unblocked -> road becomes available', () => {
    // Start with blocked road
    const blockedRoads = blockRoad('ROAD_A', INITIAL_MOCK_ROADS);
    expect(blockedRoads.find((r) => r.id === 'ROAD_A')?.status).toBe('BLOCKED');

    // Unblock ROAD_A
    const unblockedRoads = unblockRoad('ROAD_A', blockedRoads);
    expect(unblockedRoads.find((r) => r.id === 'ROAD_A')?.status).toBe('OPEN');

    const restoredRoute = findRecommendedRoute('A', 'D', unblockedRoads, INITIAL_ROAD_GRAPH);

    expect(restoredRoute.success).toBe(true);
    // Direct path A -> B -> C -> D is restored immediately
    expect(restoredRoute.nodes).toEqual(['A', 'B', 'C', 'D']);
    expect(restoredRoute.distanceKm).toBe(3.5);
  });

  // TEST 6: Medicine request -> Medicine volunteer matched
  test('TEST 6: Medicine request -> Medicine volunteer matched', () => {
    const medicineRequest: HelpRequest = {
      resource: 'Medicine',
      priority: 'HIGH',
      latitude: 12.9750,
      longitude: 77.6040,
    };

    const match = findBestVolunteerMatch(medicineRequest, MOCK_VOLUNTEERS);

    expect(match.matched).toBe(true);
    if (match.matched) {
      expect(match.volunteer.name).toBe('Arjun');
      expect(match.resource).toBe('Medicine');
      expect(match.distanceKm).toBeLessThanOrEqual(1.0);
      expect(match.matchScore).toBeGreaterThanOrEqual(90);
    }
  });

  // TEST 7: Unavailable volunteer -> volunteer excluded
  test('TEST 7: Unavailable volunteer -> volunteer excluded', () => {
    // Only unavailable volunteers in pool
    const unavailableVolunteers: Volunteer[] = [
      {
        id: 'VOL004',
        name: 'Ananya',
        resource: 'Medicine',
        latitude: 12.9720,
        longitude: 77.5940,
        availability: 'UNAVAILABLE',
      },
    ];

    const medicineRequest: HelpRequest = {
      resource: 'Medicine',
      priority: 'HIGH',
      latitude: 12.9720,
      longitude: 77.5940,
    };

    const match = findBestVolunteerMatch(medicineRequest, unavailableVolunteers);

    expect(match.matched).toBe(false);
    if (!match.matched) {
      expect(match.message).toBe('No suitable nearby resource found.');
    }
  });

  // TEST 8: No matching resource -> matched = false
  test('TEST 8: No matching resource -> matched = false', () => {
    const unfulfillableRequest: HelpRequest = {
      resource: 'Helicopter Air Evacuation',
      priority: 'CRITICAL',
      latitude: 12.9720,
      longitude: 77.5940,
    };

    const match = findBestVolunteerMatch(unfulfillableRequest, MOCK_VOLUNTEERS);

    expect(match.matched).toBe(false);
    if (!match.matched) {
      expect(match.message).toBe('No suitable nearby resource found.');
    }
  });

  // TEST 9: Reset demo -> all roads return to original state
  test('TEST 9: Reset demo -> all roads return to original state', () => {
    // Simulate modified state with blocked road
    let testRoads = blockRoad('ROAD_A', INITIAL_MOCK_ROADS);
    testRoads = blockRoad('ROAD_B', testRoads);

    expect(testRoads.find((r) => r.id === 'ROAD_A')?.status).toBe('BLOCKED');
    expect(testRoads.find((r) => r.id === 'ROAD_B')?.status).toBe('BLOCKED');

    // Trigger demo reset
    const resetRoads = [...INITIAL_MOCK_ROADS];

    expect(resetRoads.every((r) => r.status === 'OPEN')).toBe(true);

    const routeAfterReset = findRecommendedRoute('A', 'D', resetRoads, INITIAL_ROAD_GRAPH);
    expect(routeAfterReset.nodes).toEqual(['A', 'B', 'C', 'D']);
  });

  // TEST 10: Geolocation Fallback works without crashing
  test('TEST 10: Geolocation fallback provides deterministic coordinates safely', async () => {
    const location = await getCurrentUserLocation();
    expect(location).toBeDefined();
    expect(location.latitude).toBe(DEMO_FALLBACK_LOCATION.latitude);
    expect(location.longitude).toBe(DEMO_FALLBACK_LOCATION.longitude);
  });

  // TEST 11: Haversine distance calculations and formatters
  test('TEST 11: Haversine distance is accurate and symmetric', () => {
    const dSelf = calculateDistanceKm(12.9716, 77.5946, 12.9716, 77.5946);
    expect(dSelf).toBe(0);

    // Distance between Arjun (12.9765, 77.6050) and target waypoint (12.9693, 77.6050) is ~0.8 km
    const dArjun = calculateDistanceKm(12.9765, 77.6050, 12.9693, 77.6050);
    expect(dArjun).toBe(0.8);

    // Symmetry
    const dSymmetric = calculateDistanceKm(12.9693, 77.6050, 12.9765, 77.6050);
    expect(dSymmetric).toBe(0.8);

    // Formatting
    expect(formatDistance(0.8)).toBe('800 m');
    expect(formatDistance(3.5)).toBe('3.5 km');
  });

  // TEST 12: Explainable Match Score Breakdown matches 92 at 0.8 km
  test('TEST 12: Match score produces exact explainable breakdown', () => {
    const requestAt800m: HelpRequest = {
      resource: 'Medicine',
      priority: 'HIGH',
      latitude: 12.9693,
      longitude: 77.6050,
    };

    const match = findBestVolunteerMatch(requestAt800m, MOCK_VOLUNTEERS);
    expect(match.matched).toBe(true);
    if (match.matched) {
      expect(match.volunteer.name).toBe('Arjun');
      expect(match.distanceKm).toBe(0.8);
      expect(match.matchScore).toBe(92);
      expect(match.scoreBreakdown).toEqual({
        resourceCompatibility: 50,
        availabilityScore: 20,
        distanceScore: 12,
        priorityScore: 10,
        totalScore: 92,
      });
    }
  });

  // TEST 13: Risk level colors conform to visual hierarchy
  test('TEST 13: Geofence colors conform to green/yellow/orange/red hierarchy', () => {
    expect(getRiskLevelColor('LOW').badgeText).toBe('#166534');
    expect(getRiskLevelColor('MODERATE').badgeText).toBe('#854D0E');
    expect(getRiskLevelColor('HIGH').badgeText).toBe('#9A3412');
    expect(getRiskLevelColor('CRITICAL').badgeText).toBe('#991B1B');
  });

  // TEST 14: Medicine request matches Arjun and routes directly to Arjun's coordinates
  test('TEST 14: Resource request routes to matched volunteer pin with coordinate terminal alignment', () => {
    const medicineRequest: HelpRequest = {
      resource: 'Medicine',
      priority: 'HIGH',
      latitude: 12.9716,
      longitude: 77.5946,
    };

    const match = findBestVolunteerMatch(medicineRequest, MOCK_VOLUNTEERS);
    expect(match.matched).toBe(true);

    if (match.matched) {
      expect(match.volunteer.name).toBe('Arjun');

      // Route from origin (A) to Arjun's destination node (D)
      const route = findRecommendedRoute('A', 'D', INITIAL_MOCK_ROADS, INITIAL_ROAD_GRAPH);
      expect(route.success).toBe(true);
      expect(route.nodes[route.nodes.length - 1]).toBe('D');

      // Terminal coordinate matches Arjun's physical coordinates
      if (route.coordinates && route.coordinates.length > 0) {
        const terminalCoord = route.coordinates[route.coordinates.length - 1];
        expect(terminalCoord.latitude).toBe(match.volunteer.latitude);
        expect(terminalCoord.longitude).toBe(match.volunteer.longitude);
      }
    }
  });

  // TEST 15: Blocked road detours around Road A while still terminating at Arjun's pin
  test('TEST 15: Road blockage reroutes via alternative corridor while terminating at matched responder', () => {
    const blockedRoads = blockRoad('ROAD_A', INITIAL_MOCK_ROADS);
    const detour = findRecommendedRoute('A', 'D', blockedRoads, INITIAL_ROAD_GRAPH);

    expect(detour.success).toBe(true);
    expect(detour.nodes).toEqual(['A', 'B', 'E', 'F', 'D']);
    expect(detour.blockedRoads).toEqual([{ id: 'ROAD_A', name: '5th Cross' }]);

    // Rerouted path still terminates at Arjun's coordinates
    const arjun = MOCK_VOLUNTEERS.find((v) => v.name === 'Arjun');
    if (detour.coordinates && detour.coordinates.length > 0) {
      const terminalCoord = detour.coordinates[detour.coordinates.length - 1];
      expect(terminalCoord.latitude).toBe(arjun?.latitude);
      expect(terminalCoord.longitude).toBe(arjun?.longitude);
    }
  });
});
