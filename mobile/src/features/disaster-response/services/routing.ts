/**
 * routing.ts
 * Graph-based routing engine using Dijkstra algorithm with dynamic hazard avoidance.
 */

import { Road, RoadGraph, Route, RouteBlockedRoadInfo, Location } from '../types/types';

const AVERAGE_EMERGENCY_SPEED_KMH = 24; // 24 km/h ~= 0.4 km/min, yielding 15 min for 6 km

/**
 * Returns a new list of roads with the specified road marked as BLOCKED.
 */
export function blockRoad(roadId: string, roads: Road[], reason: string = 'Severe waterlogging / tree fall'): Road[] {
  return roads.map((road) =>
    road.id === roadId ? { ...road, status: 'BLOCKED', reason } : road
  );
}

/**
 * Returns a new list of roads with the specified road marked as OPEN.
 */
export function unblockRoad(roadId: string, roads: Road[]): Road[] {
  return roads.map((road) =>
    road.id === roadId ? { ...road, status: 'OPEN', reason: null } : road
  );
}

interface GraphAdjacencyItem {
  neighbor: string;
  distanceKm: number;
  roadId: string;
}

/**
 * Computes the recommended route between two graph nodes using Dijkstra's algorithm.
 * Automatically avoids any roads marked as BLOCKED.
 *
 * @param startNode - Origin node ID (e.g. "A")
 * @param destinationNode - Destination node ID (e.g. "D")
 * @param roads - Current road statuses
 * @param graph - Graph topology containing nodes and edges
 * @returns Route object matching the RiskNResQ integration contract
 */
export function findRecommendedRoute(
  startNode: string,
  destinationNode: string,
  roads: Road[],
  graph: RoadGraph
): Route {
  const roadStatusMap = new Map<string, Road>();
  const blockedRoadsCatalog: RouteBlockedRoadInfo[] = [];

  for (const road of roads) {
    roadStatusMap.set(road.id, road);
    if (road.status === 'BLOCKED') {
      blockedRoadsCatalog.push({ id: road.id, name: road.name });
    }
  }

  // Build adjacency list excluding edges whose road is BLOCKED
  const adjacency = new Map<string, GraphAdjacencyItem[]>();
  for (const nodeId of Object.keys(graph.nodes)) {
    adjacency.set(nodeId, []);
  }

  for (const edge of graph.edges) {
    const road = roadStatusMap.get(edge.roadId);
    const isBlocked = edge.blocked || (road && road.status === 'BLOCKED');

    if (!isBlocked) {
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
      if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);

      adjacency.get(edge.from)!.push({
        neighbor: edge.to,
        distanceKm: edge.distanceKm,
        roadId: edge.roadId,
      });

      // Bi-directional connectivity
      adjacency.get(edge.to)!.push({
        neighbor: edge.from,
        distanceKm: edge.distanceKm,
        roadId: edge.roadId,
      });
    }
  }

  // Dijkstra's algorithm
  const distances = new Map<string, number>();
  const previous = new Map<string, string | null>();
  const unvisited = new Set<string>();

  for (const nodeId of Object.keys(graph.nodes)) {
    distances.set(nodeId, Number.POSITIVE_INFINITY);
    previous.set(nodeId, null);
    unvisited.add(nodeId);
  }

  distances.set(startNode, 0);

  while (unvisited.size > 0) {
    let current: string | null = null;
    let shortestDist = Number.POSITIVE_INFINITY;

    for (const node of unvisited) {
      const dist = distances.get(node) ?? Number.POSITIVE_INFINITY;
      if (dist < shortestDist) {
        shortestDist = dist;
        current = node;
      }
    }

    if (!current || shortestDist === Number.POSITIVE_INFINITY) {
      break; // All remaining nodes are unreachable
    }

    if (current === destinationNode) {
      break; // Found shortest path to destination
    }

    unvisited.delete(current);

    const neighbors = adjacency.get(current) || [];
    for (const { neighbor, distanceKm } of neighbors) {
      if (unvisited.has(neighbor)) {
        const alt = shortestDist + distanceKm;
        if (alt < (distances.get(neighbor) ?? Number.POSITIVE_INFINITY)) {
          distances.set(neighbor, alt);
          previous.set(neighbor, current);
        }
      }
    }
  }

  const destinationDistance = distances.get(destinationNode) ?? Number.POSITIVE_INFINITY;

  if (destinationDistance === Number.POSITIVE_INFINITY) {
    return {
      success: false,
      routeId: 'ROUTE_UNAVAILABLE',
      nodes: [],
      distanceKm: 0,
      etaMinutes: 0,
      blockedRoads: blockedRoadsCatalog,
      reason: 'No traversable path found avoiding blocked roads',
      safetyNote: 'Recommended alternative route based on available incident data.',
      coordinates: [],
    };
  }

  // Reconstruct path
  const path: string[] = [];
  let curr: string | null = destinationNode;
  while (curr) {
    path.unshift(curr);
    curr = previous.get(curr) ?? null;
  }

  const roundedDistance = Math.round(destinationDistance * 10) / 10;
  const etaMinutes = Math.max(1, Math.round((roundedDistance / AVERAGE_EMERGENCY_SPEED_KMH) * 60));

  // Determine if this route is a detour avoiding blocked roads
  const hasAvoidedBlocks = blockedRoadsCatalog.length > 0;
  const routeId = hasAvoidedBlocks ? 'ROUTE_B' : 'ROUTE_A';
  const reason = hasAvoidedBlocks
    ? 'Avoids reported blocked road'
    : 'Direct primary corridor via shortest path';

  // Construct coordinate polyline for map display
  const coordinates: Location[] = path
    .map((nodeId) => graph.nodes[nodeId])
    .filter(Boolean)
    .map((node) => ({ latitude: node.latitude, longitude: node.longitude }));

  return {
    success: true,
    routeId,
    nodes: path,
    distanceKm: roundedDistance,
    etaMinutes,
    blockedRoads: blockedRoadsCatalog,
    reason,
    safetyNote: 'Recommended alternative route based on available incident data.',
    coordinates,
  };
}
