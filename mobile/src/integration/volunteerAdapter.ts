// Adapter: RiskN ResQ backend volunteer/help-request shapes <-> the disaster-response
// module's matching engine. No matching logic lives here; it only translates formats.
import { HelpRequest, HelpRequestPriority, MatchResult, Volunteer } from '../features/disaster-response/types/types';
import { findBestVolunteerMatch } from '../features/disaster-response/services/matching';

export interface BackendVolunteer {
  id: number | string;
  name: string;
  skill: string; // e.g. "FIRST_AID"
  latitude: number;
  longitude: number;
  available: boolean;
}

export interface BackendHelpRequest {
  type: string; // e.g. "FIRST_AID"
  priority: string;
  latitude: number;
  longitude: number;
}

// "FIRST_AID" -> "First Aid" (module compares resource names case-insensitively)
export const prettyResource = (s: string): string =>
  (s || '')
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

export function toModuleVolunteers(list: BackendVolunteer[]): Volunteer[] {
  return list.map((v) => ({
    id: String(v.id),
    name: v.name,
    resource: prettyResource(v.skill),
    latitude: v.latitude,
    longitude: v.longitude,
    availability: v.available ? 'AVAILABLE' : 'UNAVAILABLE',
  }));
}

export function toModuleRequest(req: BackendHelpRequest): HelpRequest {
  const priority = (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(req.priority) ? req.priority : 'MEDIUM') as HelpRequestPriority;
  return { resource: prettyResource(req.type), priority, latitude: req.latitude, longitude: req.longitude };
}

export function matchBackendVolunteers(list: BackendVolunteer[], req: BackendHelpRequest): MatchResult {
  return findBestVolunteerMatch(toModuleRequest(req), toModuleVolunteers(list));
}
