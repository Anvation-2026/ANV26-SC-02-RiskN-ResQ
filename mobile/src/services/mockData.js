// Centralised demo data. Mirrors the backend's response shapes so the app can
// swap between live and mock transparently (see services/api.js).
import { ZONES, nearestZone } from './geo';

const iso = () => new Date().toISOString();

const world = {
  rainfall: 5,
  alertAt: null,
  nextId: 100,
  roads: [
    { id: 1, name: 'Road A', status: 'AVAILABLE', coordinates: [[12.9716, 77.5946], [12.965, 77.605], [12.958, 77.615]] },
    { id: 2, name: 'Road B', status: 'AVAILABLE', coordinates: [[12.9716, 77.5946], [12.98, 77.61], [12.99, 77.62]] },
    { id: 3, name: 'Road C', status: 'AVAILABLE', coordinates: [[12.9352, 77.6245], [12.95, 77.61], [12.9716, 77.5946]] },
  ],
  incidents: [
    { id: 1, type: 'FLOOD', latitude: 12.9725, longitude: 77.5955, description: 'Water logging near market', severity: 3, trust_score: 65, status: 'REPORTED', zone: 'Zone A', timestamp: iso() },
    { id: 2, type: 'BLOCKED_ROAD', latitude: 12.9662, longitude: 77.6032, description: 'Fallen tree on the road', severity: 3, trust_score: 65, status: 'REPORTED', zone: 'Zone A', timestamp: iso() },
  ],
  volunteers: [
    { id: 1, name: 'Arjun', skill: 'MEDICINE', latitude: 12.969, longitude: 77.587, available: true },
    { id: 2, name: 'Meera', skill: 'FOOD', latitude: 12.94, longitude: 77.62, available: true },
    { id: 3, name: 'Kiran', skill: 'FIRST_AID', latitude: 13.03, longitude: 77.595, available: true },
    { id: 4, name: 'Farah', skill: 'WATER', latitude: 12.975, longitude: 77.6, available: true },
  ],
};

const rainScore = (r) =>
  r < 20 ? (r / 20) * 24 : r < 60 ? 25 + ((r - 20) / 40) * 24 : r <= 100 ? 50 + ((r - 60) / 40) * 24 : Math.min(100, 75 + ((r - 100) / 50) * 25);
const levelFor = (s) => (s < 25 ? 'LOW' : s < 50 ? 'MEDIUM' : s < 75 ? 'HIGH' : 'CRITICAL');

function zoneRisk(zone) {
  const rain = world.rainfall;
  const reports = world.incidents.filter(
    (i) => i.zone === zone && ['REPORTED', 'VERIFIED'].includes(i.status) && ['FLOOD', 'BLOCKED_ROAD'].includes(i.type)
  );
  const score = Math.round(Math.min(100, rainScore(rain) + Math.min(25, reports.length * 5)));
  let reason = `${rain >= 60 ? 'Heavy' : rain >= 20 ? 'Moderate' : 'Light'} rainfall (${rain} mm)`;
  if (reports.length > 1) reason += ` + ${reports.length} flood reports`;
  return { location: zone, risk_score: score, risk_level: levelFor(score), rainfall: rain, reason };
}

export function mockRisk() {
  const zones = Object.keys(ZONES).map(zoneRisk);
  return { overall: zones.reduce((a, b) => (b.risk_score > a.risk_score ? b : a)), zones };
}

export function mockAlerts() {
  const { overall } = mockRisk();
  if (overall.risk_level !== 'HIGH' && overall.risk_level !== 'CRITICAL') {
    world.alertAt = null;
    return [];
  }
  if (!world.alertAt) world.alertAt = iso();
  return [
    {
      id: 1,
      severity: overall.risk_level,
      message: 'Heavy rainfall and multiple incident reports indicate high flood risk in your area.',
      affected_zone: overall.location,
      active: true,
      created_at: world.alertAt,
    },
  ];
}

export const mockRoads = () => world.roads.map((r) => ({ ...r }));
export const mockIncidents = () => [...world.incidents].reverse();
export const mockVolunteers = () => world.volunteers.map((v) => ({ ...v }));

export function mockSubmitIncident(body) {
  const inc = {
    id: world.nextId++,
    ...body,
    severity: body.severity || 3,
    trust_score: 50,
    status: 'REPORTED',
    zone: nearestZone(body.latitude, body.longitude),
    timestamp: iso(),
  };
  world.incidents.push(inc);
  return inc;
}

export function mockHelp(body) {
  return { request_id: world.nextId++, ...body, status: 'OPEN', created_at: iso() };
}

export function mockSetScenario(scenario, rainfall) {
  world.rainfall = rainfall;
  world.roads.forEach((r) => {
    r.status = scenario === 'flood' && r.id === 1 ? 'BLOCKED' : 'AVAILABLE';
  });
  if (scenario === 'normal') world.incidents = world.incidents.filter((i) => i.id <= 2);
}
