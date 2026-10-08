/**
 * types.ts
 * Clean domain types and integration contracts for the RiskNResQ geospatial disaster response module.
 */

export interface Location {
  latitude: number;
  longitude: number;
}

export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export interface RiskZone {
  id: string;
  type: 'FLOOD' | 'FIRE' | 'LANDSLIDE' | 'STORM';
  name?: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  riskLevel: RiskLevel;
  description?: string;
}

export interface RiskAssessment {
  insideRiskZone: boolean;
  distanceKm: number;
  riskLevel: RiskLevel;
}

export type RoadStatus = 'OPEN' | 'BLOCKED';

export interface Road {
  id: string;
  name: string;
  status: RoadStatus;
  reason: string | null;
  /** Optional 0-100 flood-risk estimate for this road; raises its routing cost but never excludes it (only BLOCKED does). */
  riskScore?: number;
}

export interface RoadNode {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface RoadEdge {
  roadId: string;
  from: string;
  to: string;
  distanceKm: number;
  blocked: boolean;
}

export interface RoadGraph {
  nodes: Record<string, RoadNode>;
  edges: RoadEdge[];
}

export interface RouteBlockedRoadInfo {
  id: string;
  name: string;
}

export interface Route {
  success: boolean;
  routeId: string;
  nodes: string[];
  distanceKm: number;
  etaMinutes: number;
  blockedRoads: RouteBlockedRoadInfo[];
  reason: string;
  safetyNote: string;
  /** Optional geometry coordinates for polyline rendering */
  coordinates?: Location[];
  /** Present when flood-risk estimates were used in the route cost */
  riskInformation?: {
    meanRiskScore: number;
    potentiallyAffectedRoads: string[];
  };
}

export type VolunteerAvailability = 'AVAILABLE' | 'UNAVAILABLE' | 'BUSY';

export interface Volunteer {
  id: string;
  name: string;
  resource: string;
  latitude: number;
  longitude: number;
  availability: VolunteerAvailability;
  phone?: string;
}

export type HelpRequestPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface HelpRequest {
  resource: string;
  priority: HelpRequestPriority;
  latitude: number;
  longitude: number;
}

export interface MatchScoreBreakdown {
  resourceCompatibility: number; // 0 or 50
  availabilityScore: number;     // 0 or 20
  distanceScore: number;         // 0, 10, 15, or 20
  priorityScore: number;         // 0 to 10
  totalScore: number;            // 0 - 100
}

export type MatchResult =
  | {
      matched: true;
      volunteer: {
        id: string;
        name: string;
        latitude?: number;
        longitude?: number;
        phone?: string;
      };
      resource: string;
      distanceKm: number;
      matchScore: number;
      scoreBreakdown?: MatchScoreBreakdown;
    }
  | {
      matched: false;
      message: string;
    };
