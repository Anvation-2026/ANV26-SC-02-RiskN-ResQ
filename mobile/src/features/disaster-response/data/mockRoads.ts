/**
 * mockRoads.ts
 * Road network and graph topology for Bengaluru demo corridor.
 */

import { Road, RoadGraph, RoadNode, RoadEdge } from '../types/types';

export const INITIAL_MOCK_ROADS: Road[] = [
  {
    id: 'ROAD_A',
    name: '5th Cross',
    status: 'OPEN',
    reason: null,
  },
  {
    id: 'ROAD_B',
    name: 'MG Road',
    status: 'OPEN',
    reason: null,
  },
  {
    id: 'ROAD_C',
    name: 'Church Street',
    status: 'OPEN',
    reason: null,
  },
  {
    id: 'ROAD_D',
    name: 'Brigade Road',
    status: 'OPEN',
    reason: null,
  },
  {
    id: 'ROAD_E',
    name: 'Residency Road',
    status: 'OPEN',
    reason: null,
  },
  {
    id: 'ROAD_F',
    name: 'Richmond Road',
    status: 'OPEN',
    reason: null,
  },
  {
    id: 'ROAD_G',
    name: 'Lavelle Road',
    status: 'OPEN',
    reason: null,
  },
  {
    id: 'ROAD_H',
    name: 'Kasturba Road',
    status: 'OPEN',
    reason: null,
  },
];

export const MOCK_ROAD_NODES: Record<string, RoadNode> = {
  A: {
    id: 'A',
    name: 'Cubbon Central (User Origin)',
    latitude: 12.9716,
    longitude: 77.5946,
  },
  B: {
    id: 'B',
    name: 'MG Road Junction',
    latitude: 12.9735,
    longitude: 77.5980,
  },
  C: {
    id: 'C',
    name: 'Church Street Intersection',
    latitude: 12.9750,
    longitude: 77.6015,
  },
  D: {
    id: 'D',
    name: 'Relief Station Alpha (Destination)',
    latitude: 12.9765,
    longitude: 77.6050,
  },
  E: {
    id: 'E',
    name: 'Brigade South Waypoint',
    latitude: 12.9675,
    longitude: 77.5995,
  },
  F: {
    id: 'F',
    name: 'Richmond Outer Bypass',
    latitude: 12.9700,
    longitude: 77.6065,
  },
};

export const INITIAL_MOCK_EDGES: RoadEdge[] = [
  // Primary Corridor: A -> B -> C -> D (3.5 km total)
  {
    roadId: 'ROAD_B',
    from: 'A',
    to: 'B',
    distanceKm: 1.0,
    blocked: false,
  },
  {
    roadId: 'ROAD_A', // 5th Cross (Road A: Primary Bottleneck Segment)
    from: 'B',
    to: 'C',
    distanceKm: 1.2,
    blocked: false,
  },
  {
    roadId: 'ROAD_C',
    from: 'C',
    to: 'D',
    distanceKm: 1.3,
    blocked: false,
  },
  // Alternative Corridor: B -> E -> F -> D (6.0 km total from A)
  {
    roadId: 'ROAD_D',
    from: 'B',
    to: 'E',
    distanceKm: 1.8,
    blocked: false,
  },
  {
    roadId: 'ROAD_E',
    from: 'E',
    to: 'F',
    distanceKm: 2.0,
    blocked: false,
  },
  {
    roadId: 'ROAD_F',
    from: 'F',
    to: 'D',
    distanceKm: 1.2,
    blocked: false,
  },
  // Additional network branches
  {
    roadId: 'ROAD_G',
    from: 'C',
    to: 'F',
    distanceKm: 4.5,
    blocked: false,
  },
  {
    roadId: 'ROAD_H',
    from: 'E',
    to: 'C',
    distanceKm: 3.2,
    blocked: false,
  },
];

export const INITIAL_ROAD_GRAPH: RoadGraph = {
  nodes: MOCK_ROAD_NODES,
  edges: INITIAL_MOCK_EDGES,
};
