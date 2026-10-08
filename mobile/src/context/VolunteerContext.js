// State for the volunteer portal. Everything comes from the backend (FastAPI + PostgreSQL); nothing is kept locally
// except which assignments the volunteer has already looked at (used only for the "new request" indicator).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { errorText } from './AuthContext';
import {
  claimRequest,
  acceptMatch,
  completeMatch,
  getMyRequests,
  getMyVolunteer,
  patchMyVolunteer,
  enRouteRequest,
  arrivedRequest,
  rejectHelpRequest,
  cancelHelpRequest,
} from '../services/accountApi';
import { checkLocationPermission, getLiveCurrentPosition, requestLocationPermission } from '../services/locationService';

const VolunteerContext = createContext(null);
export const useVolunteer = () => useContext(VolunteerContext);

const POLL_MS = 6000;
const EMPTY = { assigned: [], nearby_open: [], completed: [], stats: { assigned: 0, nearby: 0, completed: 0 } };

export function VolunteerProvider({ children }) {
  const [me, setMe] = useState(null);
  const [reqs, setReqs] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newIds, setNewIds] = useState([]); // assignments that appeared since the volunteer last looked
  const seen = useRef(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [m, r] = await Promise.all([getMyVolunteer(), getMyRequests()]);
      if (!alive.current) return;
      setMe(m);
      setReqs({ ...EMPTY, ...r });
      setError('');
      const ids = (r.assigned || []).map((a) => a.match_id);
      if (seen.current === null) seen.current = new Set(ids); // first load: everything already there counts as seen
      else {
        const fresh = ids.filter((id) => !seen.current.has(id));
        if (fresh.length) setNewIds((cur) => [...new Set([...cur, ...fresh])]);
      }
    } catch (e) {
      if (alive.current) setError(errorText(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => { alive.current = false; clearInterval(t); };
  }, [refresh]);

  const markSeen = useCallback(() => {
    if (seen.current) reqs.assigned.forEach((a) => seen.current.add(a.match_id));
    setNewIds([]);
  }, [reqs.assigned]);

  // Every action goes to the server first and the screen reloads from the server afterwards: never a local-only change.
  const act = useCallback(async (fn) => {
    try {
      await fn();
      await refresh();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e && e.status && e.detail ? e.detail : errorText(e) };
    }
  }, [refresh]);

  const value = useMemo(() => ({
    me, volunteer: me && me.volunteer, reqs, loading, error, newIds, refresh, markSeen,
    available: !!(me && me.volunteer && me.volunteer.available),
    setAvailable: (available) => act(() => patchMyVolunteer({ available })),
    accept: (matchId) => act(() => acceptMatch(matchId)),
    complete: (matchId) => act(() => completeMatch(matchId)),
    claim: (requestId) => act(() => claimRequest(requestId)),
    enRoute: (requestId) => act(() => enRouteRequest(requestId)),
    arrived: (requestId) => act(() => arrivedRequest(requestId)),
    reject: (requestId) => act(() => rejectHelpRequest(requestId)),
    cancel: (requestId, reason) => act(() => cancelHelpRequest(requestId, reason)),
    // Location comes from the phone's GPS when permission is given; otherwise the saved location is kept.
    updateLocationFromGps: async () => {
      try {
        let status = await checkLocationPermission();
        if (status !== 'granted') status = await requestLocationPermission();
        if (status !== 'granted') return { ok: false, message: 'Location unavailable: permission was not granted.' };
        const loc = await getLiveCurrentPosition();
        if (!loc || typeof loc.latitude !== 'number') return { ok: false, message: 'Location unavailable.' };
        return act(() => patchMyVolunteer({ latitude: loc.latitude, longitude: loc.longitude }));
      } catch (e) {
        return { ok: false, message: 'Location unavailable.' };
      }
    },
  }), [me, reqs, loading, error, newIds, refresh, markSeen, act]);

  return <VolunteerContext.Provider value={value}>{children}</VolunteerContext.Provider>;
}
