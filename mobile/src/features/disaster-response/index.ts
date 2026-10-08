/**
 * Public barrel export for RiskNResQ Disaster Response Feature Module.
 * Teammates can import components, domain services, or mock datasets directly.
 */

// Screen & UI Components
export { DisasterResponseScreen } from './DisasterResponseScreen';
export { DisasterMapView } from './components/DisasterMapView';
export { FallbackWebMap } from './components/FallbackWebMap';
export { RiskZoneComponent } from './components/RiskZone';
export { BlockedRoadComponent } from './components/BlockedRoad';
export { RouteOverlay } from './components/RouteOverlay';
export { VolunteerMarker } from './components/VolunteerMarker';
export { RouteInfoCard } from './components/RouteInfoCard';
export { MatchResultCard } from './components/MatchResultCard';
export { DemoControlPanel } from './components/DemoControlPanel';

// Core Geospatial & Disaster Services
export { getCurrentUserLocation, DEMO_FALLBACK_LOCATION } from './services/geolocation';
export { isInsideRiskZone, assessMultipleRiskZones, getRiskLevelColor } from './services/geofencing';
export { findRecommendedRoute, blockRoad, unblockRoad } from './services/routing';
export { findBestVolunteerMatch, calculateDistanceScore, calculatePriorityScore } from './services/matching';

// Utilities
export { calculateDistanceKm, formatDistance } from './utils/distance';

// Types and Data Contracts
export * from './types/types';

// Mock Datasets (for standalone preview and testing)
export { MOCK_RISK_ZONES, PRIMARY_DEMO_RISK_ZONE } from './data/mockHazards';
export { INITIAL_MOCK_ROADS, MOCK_ROAD_NODES, INITIAL_MOCK_EDGES, INITIAL_ROAD_GRAPH } from './data/mockRoads';
export { BASELINE_PRIMARY_ROUTE, BASELINE_ALTERNATIVE_ROUTE } from './data/mockRoutes';
export { MOCK_VOLUNTEERS } from './data/mockVolunteers';
