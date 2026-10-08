# RiskNResQ — Integration Contracts & Data Schemas

This document defines the strict TypeScript interfaces and JSON payload specifications for the **Geospatial & Disaster Response Module**. Backend and mobile teammates must conform to these contract structures when replacing mock datasets with production API endpoints.

---

## 1. ROUTE RESPONSE

### TypeScript Interface
```typescript
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
  coordinates?: {
    latitude: number;
    longitude: number;
  }[];
}
```

### Example JSON Payload: Standard Corridor (Roads Open)
```json
{
  "success": true,
  "routeId": "ROUTE_A",
  "nodes": ["A", "B", "C", "D"],
  "distanceKm": 3.5,
  "etaMinutes": 8,
  "blockedRoads": [],
  "reason": "Direct primary corridor via shortest path",
  "safetyNote": "Recommended alternative route based on available incident data.",
  "coordinates": [
    { "latitude": 12.9716, "longitude": 77.5946 },
    { "latitude": 12.9735, "longitude": 77.5980 },
    { "latitude": 12.9750, "longitude": 77.6015 },
    { "latitude": 12.9765, "longitude": 77.6050 }
  ]
}
```

### Example JSON Payload: Recalculated Detour (5th Cross Blocked)
```json
{
  "success": true,
  "routeId": "ROUTE_B",
  "nodes": [
    "A",
    "B",
    "E",
    "F",
    "D"
  ],
  "distanceKm": 6.0,
  "etaMinutes": 15,
  "blockedRoads": [
    {
      "id": "ROAD_A",
      "name": "5th Cross"
    }
  ],
  "reason": "Avoids reported blocked road",
  "safetyNote": "Recommended alternative route based on available incident data.",
  "coordinates": [
    { "latitude": 12.9716, "longitude": 77.5946 },
    { "latitude": 12.9735, "longitude": 77.5980 },
    { "latitude": 12.9675, "longitude": 77.5995 },
    { "latitude": 12.9700, "longitude": 77.6065 },
    { "latitude": 12.9765, "longitude": 77.6050 }
  ]
}
```

> **IMPORTANT COMPLIANCE NOTE:**  
> The system must NEVER return phrasing such as *"Guaranteed Safe Route"* or *"100% Safe"*.  
> All responses must use *"Recommended alternative route"* or *"Lower-risk alternative based on available incident data."*

---

## 2. VOLUNTEER & RESOURCE MATCH RESPONSE

### TypeScript Interface
```typescript
export interface MatchScoreBreakdown {
  resourceCompatibility: number; // 0 or 50 points
  availabilityScore: number;     // 0 or 20 points
  distanceScore: number;         // 0 to 20 points
  priorityScore: number;         // 5 to 10 points
  totalScore: number;            // Max 100 points
}

export type MatchResult =
  | {
      matched: true;
      volunteer: {
        id: string;
        name: string;
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
```

### Example JSON Payload: Successful Match
```json
{
  "matched": true,
  "volunteer": {
    "id": "VOL001",
    "name": "Arjun"
  },
  "resource": "Medicine",
  "distanceKm": 0.8,
  "matchScore": 92,
  "scoreBreakdown": {
    "resourceCompatibility": 50,
    "availabilityScore": 20,
    "distanceScore": 12,
    "priorityScore": 10,
    "totalScore": 92
  }
}
```

### Example JSON Payload: No Resource Found
```json
{
  "matched": false,
  "message": "No suitable nearby resource found."
}
```

---

## 3. RISK ASSESSMENT & GEOFENCE RESPONSE

### TypeScript Interface
```typescript
export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export interface RiskAssessment {
  insideRiskZone: boolean;
  distanceKm: number;
  riskLevel: RiskLevel;
}
```

### Example JSON Payload: User Inside Risk Zone
```json
{
  "insideRiskZone": true,
  "distanceKm": 0.8,
  "riskLevel": "HIGH"
}
```

### Example JSON Payload: User Outside Risk Zone
```json
{
  "insideRiskZone": false,
  "distanceKm": 3.2,
  "riskLevel": "LOW"
}
```

---

## 4. USER LOCATION RESPONSE

### TypeScript Interface
```typescript
export interface Location {
  latitude: number;
  longitude: number;
}
```

### Example JSON Payload
```json
{
  "latitude": 12.9716,
  "longitude": 77.5946
}
```

### Fallback Guarantee
If the mobile client cannot access hardware GPS permissions, the location service automatically returns the fallback coordinate object:
```json
{
  "latitude": 12.9716,
  "longitude": 77.5946
}
```
This guarantees that API endpoints expecting coordinates never receive `null` or `undefined`.
