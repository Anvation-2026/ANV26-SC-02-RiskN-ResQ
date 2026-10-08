// Geography, route derivation and volunteer-matching helpers (pure functions).

export const USER = { latitude: 12.9716, longitude: 77.5946, label: 'Bengaluru' };

export const ZONES = {
  'Zone A': { latitude: 12.9716, longitude: 77.5946 },
  'Zone B': { latitude: 12.9352, longitude: 77.6245 },
  'Zone C': { latitude: 13.0358, longitude: 77.597 },
};

export function nearestZone(lat, lng) {
  return Object.keys(ZONES).reduce((best, z) => {
    const d = (ZONES[z].latitude - lat) ** 2 + (ZONES[z].longitude - lng) ** 2;
    return !best || d < best.d ? { z, d } : best;
  }, null).z;
}

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function pathKm(coords) {
  let km = 0;
  for (let i = 1; i < coords.length; i++) {
    km += haversineKm(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return km;
}

// Blocked roads + the shortest AVAILABLE road as the recommended alternative.
export function routeInfo(roads) {
  const blocked = roads.filter((r) => r.status === 'BLOCKED');
  const available = roads
    .filter((r) => r.status !== 'BLOCKED')
    .map((r) => ({ road: r, km: pathKm(r.coordinates) }))
    .sort((a, b) => a.km - b.km);
  const best = available[0];
  const alternative =
    blocked.length && best
      ? { road: best.road, km: best.km, minutes: Math.max(1, Math.round((best.km / 25) * 60)) }
      : null;
  return { roads, blocked, alternative };
}

const SKILLS_FOR = {
  MEDICINE: ['MEDICINE'],
  FOOD: ['FOOD'],
  WATER: ['WATER', 'FOOD'],
  FIRST_AID: ['FIRST_AID'],
  EVACUATION: ['EVACUATION', 'FIRST_AID'],
};

export const prettySkill = (s) =>
  (s || '').toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

// Pick the best available volunteer: skill match dominates, proximity breaks ties.
export function matchVolunteer(volunteers, req) {
  const wanted = SKILLS_FOR[req.type] || [req.type];
  let best = null;
  volunteers
    .filter((v) => v.available)
    .forEach((v) => {
      const km = haversineKm(req.latitude, req.longitude, v.latitude, v.longitude);
      const skillOk = wanted.includes(v.skill);
      const score = Math.round((skillOk ? 60 : 20) + Math.max(0, 40 * (1 - km / 5)));
      if (!best || score > best.score) {
        best = {
          volunteerId: v.id,
          volunteer: v.name,
          resource: prettySkill(skillOk ? req.type : v.skill),
          distanceKm: Math.round(km * 10) / 10,
          status: 'Available',
          score: Math.min(99, score),
        };
      }
    });
  return best;
}

export function timeAgo(iso) {
  if (!iso) return 'Just now';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}
