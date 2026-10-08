# RiskNResQ — Geospatial Disaster Response Module

> **Feature Package:** `src/features/disaster-response`  
> **Target App:** RiskNResQ (ResilientUrban — Hyper-Local Disaster Early Warning & Community Action Network)  
> **Tech Stack:** React Native, Expo, TypeScript, `react-native-maps`, `expo-location`

---

## 1. What This Module Does

This module is a completely self-contained, independent geospatial and triage feature engineered for **RiskNResQ**. It provides hyper-local situational awareness during municipal emergencies (such as urban flooding in Bengaluru) through:

1. **Interactive Disaster Map:** Visualizes real-time user positioning, hazard geofences, road networks, calculated routes, and community responder pins.
2. **Device Geolocation with Graceful Fallback:** Obtains precise user coordinates via Expo Location or provides deterministic demo coordinates without ever crashing.
3. **Circular Hazard Geofencing:** Computes whether a citizen is inside an active flood threat zone and assigns dynamic risk classifications (LOW, MODERATE, HIGH, CRITICAL).
4. **Resilient Graph Routing & Obstacle Recalculation:** Implements Dijkstra's algorithm to compute the shortest viable corridor between checkpoints. Automatically detects blocked road segments and calculates lower-risk detours.
5. **Dynamic Road Incident State Management:** Allows instant blocking and unblocking of road segments (e.g. 5th Cross) with real-time route re-computation.
6. **Community Volunteer & Resource Matching Engine:** Evaluates multi-criteria requests (Resource match, Availability, Haversine Distance, and Emergency Priority) using a transparent 100-point scoring model.
7. **Developer Demo Control Panel:** Provides immediate manual overrides to test scenarios for hackathon judges (`[BLOCK ROAD]`, `[UNBLOCK ROAD]`, `[RECALCULATE ROUTE]`, `[REQUEST MEDICINE]`, `[RESET DEMO]`).

---

## 2. Directory Structure & Files Created

```
RiskNResQ/
├── __tests__/
│   └── disaster-response.test.ts          # Automated test suite (9 verification tests)
├── src/
│   └── features/
│       └── disaster-response/
│           ├── components/
│           │   ├── BlockedRoad.tsx        # Road segment renderer with incident badge
│           │   ├── DemoControlPanel.tsx   # Interactive testing controls
│           │   ├── DisasterMapView.tsx    # Native react-native-maps implementation
│           │   ├── FallbackWebMap.tsx     # Resilient vector canvas for Web/Headless
│           │   ├── MatchResultCard.tsx    # Volunteer triage result card
│           │   ├── RiskZone.tsx           # Geofenced hazard circle overlay
│           │   ├── RouteInfoCard.tsx      # Navigation status & safety note card
│           │   ├── RouteOverlay.tsx       # Computed corridor polyline
│           │   └── VolunteerMarker.tsx    # Responder marker with callout
│           ├── data/
│           │   ├── mockHazards.ts         # Flood zone coordinates & metadata
│           │   ├── mockRoads.ts           # Bengaluru corridor road graph & edges
│           │   ├── mockRoutes.ts          # Baseline navigation checkpoints
│           │   └── mockVolunteers.ts      # Community responder roster
│           ├── services/
│           │   ├── geofencing.ts          # Boundary detection & color taxonomy
│           │   ├── geolocation.ts         # Expo location with fallback
│           │   ├── matching.ts            # 100-pt explainable volunteer matcher
│           │   └── routing.ts             # Dijkstra routing & dynamic rerouting
│           ├── types/
│           │   └── types.ts               # Shared domain interfaces & contracts
│           ├── utils/
│           │   └── distance.ts            # Haversine distance formula & formatters
│           ├── DisasterResponseScreen.tsx # Complete standalone orchestrator screen
│           └── index.ts                   # Public barrel export
├── App.tsx                                # Root demo container
├── app.json                               # Expo project manifest
├── jest.config.js                         # Jest test configuration
├── package.json                           # Dependencies & scripts
├── tsconfig.json                          # TypeScript configuration
├── INTEGRATION_CONTRACT.md                # Schema definitions for backend integration
└── MY_MODULE_README.md                    # Module documentation
```

---

## 3. How to Run the Module

### Prerequisites
- Node.js >= 18
- npm or yarn

### Installation & Execution
```bash
# Navigate to project directory
cd RiskNResQ

# Install dependencies
npm install

# Run automated test suite (verifies all 9 mandatory criteria)
npm test

# Verify TypeScript compilation
npx tsc --noEmit

# Start the Expo application
npm start
# or
npx expo start
```

Press `i` for iOS simulator, `a` for Android emulator, or `w` for Web preview.

---

## 4. How the Map Works

- **Native Mobile:** Uses `react-native-maps` (`PROVIDER_DEFAULT` on Apple Maps for iOS and Google Maps for Android). No mandatory external API keys are required for basic local simulation.
- **Web / Headless Fallback:** If executed in a browser or test sandbox where native map binaries are absent, `FallbackWebMap.tsx` automatically renders an interactive coordinate canvas mapping Bengaluru central coordinates to screen percentages.
- **Layers Rendered:**
  1. Base tiles / Canvas grid
  2. Flood risk zone circles (stroke & fill colored by severity)
  3. Road segments (grey = open, bold red dashed = blocked with badge)
  4. Active recommended route polyline (emerald = primary, royal blue = detour)
  5. Volunteer markers with interactive info callouts
  6. Citizen device location pin ("YOU" pulse)
  7. Relief center destination pin ("RELIEF CTR")

---

## 5. How Geolocation Works (`geolocation.ts`)

Function: `getCurrentUserLocation(): Promise<Location>`

1. Requests foreground location permissions via `expo-location`.
2. If granted, retrieves current coordinates with `Accuracy.Balanced`.
3. If permission is denied, location services are disabled, or running in non-native simulators:
   - Returns fallback Bengaluru central coordinates:
     ```json
     { "latitude": 12.9716, "longitude": 77.5946 }
     ```
4. **Crash-Resilience Guarantee:** Wrapped in safe `try/catch` guards. Never throws unhandled rejections.

---

## 6. How Geofencing Works (`geofencing.ts`)

Function: `isInsideRiskZone(userLocation, riskZone): RiskAssessment`

1. Uses the Haversine formula to compute geodesic distance between the user and the risk zone epicenter.
2. Evaluates `distanceKm <= riskZone.radiusKm`.
3. Returns:
   - If inside: `{ insideRiskZone: true, distanceKm: 0.8, riskLevel: "HIGH" }`
   - If outside: `{ insideRiskZone: false, distanceKm: 3.2, riskLevel: "LOW" }`
4. Provides standard color tokens (`getRiskLevelColor`):
   - **LOW:** `#16A34A` (Green)
   - **MODERATE:** `#CA8A04` (Yellow)
   - **HIGH:** `#EA580C` (Orange)
   - **CRITICAL:** `#DC2626` (Red)

---

## 7. How Routing Works (`routing.ts`)

Function: `findRecommendedRoute(startNode, destinationNode, roads, graph): Route`

1. Constructs an in-memory adjacency list from `RoadGraph.edges`.
2. Filters out any edge whose associated `roadId` has `status === 'BLOCKED'` or `edge.blocked === true`.
3. Executes **Dijkstra's Shortest Path Algorithm** from `startNode` (`A`) to `destinationNode` (`D`).
4. Reconstructs the node sequence, accumulates total distance, and computes ETA based on emergency transit speeds (`24 km/h`).
5. Generates geographical coordinates for polyline rendering.
6. Returns safety notes and incident avoidance rationale.

---

## 8. How Blocked Roads Work (`blockRoad` / `unblockRoad`)

- `blockRoad(roadId, roads, reason)`: Pure function returning an updated array where the specified road has `status: 'BLOCKED'`.
- `unblockRoad(roadId, roads)`: Pure function returning an updated array where the specified road has `status: 'OPEN'` and `reason: null`.
- **Dynamic Recalculation:**
  - Initial state: Road A (5th Cross) is OPEN $\rightarrow$ Shortest path: `A → B → C → D` (3.5 km, 8 min).
  - When Road A is BLOCKED $\rightarrow$ Dijkstra excludes edge B-C, immediately finding detour: `A → B → E → F → D` (6.0 km, 15 min).
  - No app restart or cache purge is required.

---

## 9. How Volunteer Matching Works (`matching.ts`)

Function: `findBestVolunteerMatch(helpRequest, volunteers): MatchResult`

### Algorithm Pipeline:
- **Step 1 (Resource Filter):** Matches `volunteer.resource.toLowerCase() === helpRequest.resource.toLowerCase()`.
- **Step 2 (Availability Filter):** Enforces `volunteer.availability === 'AVAILABLE'`.
- **Step 3 (Haversine Distance):** Computes geodesic distance to civilian in km.
- **Step 4 (Explainable 100-Point Composite Score):**
  - **Resource Compatibility:** 50 points
  - **Availability:** 20 points
  - **Proximity:** Up to 20 points
    - $0 - 1\text{ km}$: 10 to 20 points (e.g. at 0.8 km = 12 points)
    - $1 - 2\text{ km}$: 10 to 15 points
    - $2 - 5\text{ km}$: 2 to 10 points
    - $> 5\text{ km}$: 0 points
  - **Priority Suitability:** Up to 10 points
    - CRITICAL / HIGH: 10 points
    - MEDIUM: 7 points
    - LOW: 5 points
- **Step 5 (Ranking):** Sorts candidates by `matchScore` descending (distance as tiebreaker).
- **Step 6 (No Match Guard):** If no matching volunteers are available, returns `{ matched: false, message: "No suitable nearby resource found." }`. Never hallucinates matches.

---

## 10. Mock Data Structure

All mock data is isolated under `src/features/disaster-response/data/`:
- `mockHazards.ts`: Active flood polygons and radii in Bengaluru.
- `mockRoads.ts`: Road metadata, graph nodes (A through F), and edge distances.
- `mockRoutes.ts`: Baseline navigational route checkpoints.
- `mockVolunteers.ts`: Volunteer roster with skills, coordinates, and real-time availability.

---

## 11. Functions Available

Import from `@/features/disaster-response`:

| Function | Signature | Description |
|---|---|---|
| `getCurrentUserLocation()` | `() => Promise<Location>` | Device location with safe fallback |
| `calculateDistanceKm()` | `(lat1, lon1, lat2, lon2) => number` | Haversine distance in km |
| `formatDistance()` | `(km: number) => string` | Human-readable ("800 m", "1.5 km") |
| `isInsideRiskZone()` | `(location, zone) => RiskAssessment` | Geofence containment detection |
| `assessMultipleRiskZones()` | `(location, zones[]) => RiskAssessment` | Evaluates worst-case risk across multiple zones |
| `getRiskLevelColor()` | `(riskLevel) => RiskColors` | UI design tokens for badges/overlays |
| `findRecommendedRoute()` | `(from, to, roads, graph) => Route` | Dijkstra shortest path avoiding hazards |
| `blockRoad()` | `(roadId, roads, reason?) => Road[]` | Marks road blocked |
| `unblockRoad()` | `(roadId, roads) => Road[]` | Clears road blockage |
| `findBestVolunteerMatch()` | `(request, volunteers) => MatchResult` | Ranks and selects best community responder |

---

## 12. Integration Instructions for Teammates

### Integrating into the Main Mobile App
The module is designed as an isolated package. A teammate can mount the entire screen or consume individual services:

```tsx
// Option A: Render the complete feature screen
import { DisasterResponseScreen } from './src/features/disaster-response';

export default function App() {
  return <DisasterResponseScreen />;
}
```

```tsx
// Option B: Embed individual components or algorithms
import {
  DisasterMapView,
  findRecommendedRoute,
  findBestVolunteerMatch,
  isInsideRiskZone
} from './src/features/disaster-response';
```

### Swapping Mock Data with Backend APIs
When the backend teammate finishes their FastAPI / PostgreSQL service:
1. Replace `MOCK_VOLUNTEERS` in `matching.ts` with `GET /api/v1/volunteers`.
2. Replace `INITIAL_MOCK_ROADS` with `GET /api/v1/roads/status`.
3. Replace `PRIMARY_DEMO_RISK_ZONE` with `GET /api/v1/hazards/active`.
4. All UI components, map overlays, and routing algorithms will continue to work without code changes because they strictly code against domain interfaces in `types.ts`.
