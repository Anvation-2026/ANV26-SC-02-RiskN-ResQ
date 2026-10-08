/**
 * mockRoutes.ts
 * Baseline route definitions and reference coordinates for disaster navigation.
 */

import { Route } from '../types/types';

export const BASELINE_PRIMARY_ROUTE: Route = {
  success: true,
  routeId: 'ROUTE_A',
  nodes: ['A', 'B', 'C', 'D'],
  distanceKm: 3.5,
  etaMinutes: 8,
  blockedRoads: [],
  reason: 'Direct primary corridor via 5th Cross',
  safetyNote: 'Recommended alternative route based on available incident data.',
};

export const BASELINE_ALTERNATIVE_ROUTE: Route = {
  success: true,
  routeId: 'ROUTE_B',
  nodes: ['A', 'B', 'E', 'F', 'D'],
  distanceKm: 6.0,
  etaMinutes: 15,
  blockedRoads: [
    {
      id: 'ROAD_A',
      name: '5th Cross',
    },
  ],
  reason: 'Avoids reported blocked road',
  safetyNote: 'Recommended alternative route based on available incident data.',
};
