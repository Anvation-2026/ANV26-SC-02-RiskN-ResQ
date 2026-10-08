/**
 * routing.ts
 * Graph-based routing engine using Dijkstra algorithm with dynamic hazard avoidance.
 */

import { Road, RoadGraph, Route, RouteBlockedRoadInfo, Location } from '../types/types';

const AVERAGE_EMERGENCY_SPEED_KMH = 24; // 24 km/h ~= 0.4 km/min, yielding 15 min for 6 km
const RISK_COST_FACTOR = 0.6; // a road with risk score 100 costs 1.6x its length; BLOCKED roads are still excluded outright
const POTENTIAL_RISK_SCORE = 50; // roads at or above this are reported as potentially affected

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

/** Route cost of an edge: its length, scaled up by the road's flood-risk estimate when there is one. */
function edgeCost(distanceKm: number, road?: Road): number {
  const risk = road?.riskScore ?? 0;
  return distanceKm * (1 + (RISK_COST_FACTOR * Math.min(100, Math.max(0, risk))) / 100);
}

interface GraphAdjacencyItem {
  neighbor: string;
  distanceKm: number;
  roadId: string;
  /** distance weighted by the road's flood-risk estimate: what Dijkstra minimises */
  cost: number;
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
        cost: edgeCost(edge.distanceKm, road),
      });

      // Bi-directional connectivity
      adjacency.get(edge.to)!.push({
        neighbor: edge.from,
        distanceKm: edge.distanceKm,
        roadId: edge.roadId,
        cost: edgeCost(edge.distanceKm, road),
      });
    }
  }

  // Dijkstra's algorithm
  const distances = new Map<string, number>(); // risk-weighted cost
  const km = new Map<string, number>(); // real distance along the cheapest path
  const viaRoad = new Map<string, string>(); // road used to reach each node
  const previous = new Map<string, string | null>();
  const unvisited = new Set<string>();

  for (const nodeId of Object.keys(graph.nodes)) {
    distances.set(nodeId, Number.POSITIVE_INFINITY);
    km.set(nodeId, 0);
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
    for (const { neighbor, distanceKm, cost, roadId } of neighbors) {
      if (unvisited.has(neighbor)) {
        const alt = shortestDist + cost;
        if (alt < (distances.get(neighbor) ?? Number.POSITIVE_INFINITY)) {
          distances.set(neighbor, alt);
          km.set(neighbor, (km.get(current) ?? 0) + distanceKm);
          viaRoad.set(neighbor, roadId);
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

  const roundedDistance = Math.round((km.get(destinationNode) ?? destinationDistance) * 10) / 10;
  const etaMinutes = Math.max(1, Math.round((roundedDistance / AVERAGE_EMERGENCY_SPEED_KMH) * 60));

  // Determine if this route is a detour avoiding blocked roads
  const hasAvoidedBlocks = blockedRoadsCatalog.length > 0;
  const routeId = hasAvoidedBlocks ? 'ROUTE_B' : 'ROUTE_A';
  const reason = hasAvoidedBlocks
    ? 'Avoids reported blocked road'
    : 'Direct primary corridor via shortest path';

  // Flood-risk estimates along the chosen path (only present when the caller supplied riskScore on roads)
  const usedRoads: Road[] = [];
  for (const nodeId of path.slice(1)) {
    const road = roadStatusMap.get(viaRoad.get(nodeId) ?? '');
    if (road) usedRoads.push(road);
  }
  const scored = usedRoads.filter((r) => typeof r.riskScore === 'number');
  const riskInformation = scored.length
    ? {
        meanRiskScore: Math.round((scored.reduce((a, r) => a + (r.riskScore ?? 0), 0) / scored.length) * 10) / 10,
        potentiallyAffectedRoads: scored.filter((r) => (r.riskScore ?? 0) >= POTENTIAL_RISK_SCORE).map((r) => r.name),
      }
    : undefined;

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
    safetyNote: riskInformation
      ? 'Recommended alternative route based on current environmental and incident data.'
      : 'Recommended alternative route based on available incident data.',
    coordinates,
    ...(riskInformation ? { riskInformation } : {}),
  };
}
