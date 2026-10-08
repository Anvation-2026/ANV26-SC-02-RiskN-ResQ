import { matchBackendVolunteers, toModuleVolunteers } from '../src/integration/volunteerAdapter';

const backend = [
  { id: 1, name: 'Arjun', skill: 'MEDICINE', latitude: 12.969, longitude: 77.587, available: true },
  { id: 2, name: 'Meera', skill: 'FOOD', latitude: 12.94, longitude: 77.62, available: true },
  { id: 3, name: 'Kiran', skill: 'FIRST_AID', latitude: 13.03, longitude: 77.595, available: false },
];
const here = { latitude: 12.9716, longitude: 77.5946 };

describe('backend <-> module volunteer adapter', () => {
  test('maps backend volunteers to module format', () => {
    const v = toModuleVolunteers(backend);
    expect(v[2]).toMatchObject({ id: '3', resource: 'First Aid', availability: 'UNAVAILABLE' });
  });
  test('matches an available backend volunteer through the module engine', () => {
    const r = matchBackendVolunteers(backend, { type: 'MEDICINE', priority: 'HIGH', ...here });
    expect(r.matched).toBe(true);
    if (r.matched) expect(r.volunteer.name).toBe('Arjun');
  });
  test('unavailable volunteer or unknown resource -> no match', () => {
    expect(matchBackendVolunteers(backend, { type: 'FIRST_AID', priority: 'HIGH', ...here }).matched).toBe(false);
    expect(matchBackendVolunteers(backend, { type: 'EVACUATION', priority: 'HIGH', ...here }).matched).toBe(false);
  });
});
