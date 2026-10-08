import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { POLL_MS } from '../config/api';
import { getAlerts, getIncidents, getRisk, getRoute, getSource } from '../services/api';

const DataContext = createContext(null);
export const useData = () => useContext(DataContext);

const EMPTY = { loading: true, risk: null, alerts: [], incidents: [], roads: [], blocked: [], alternative: null, source: 'demo', updatedAt: null };

export function DataProvider({ children }) {
  const [state, setState] = useState(EMPTY);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const [risk, alerts, incidents, route] = await Promise.all([getRisk(), getAlerts(), getIncidents(), getRoute()]);
      setState({
        loading: false, risk, alerts, incidents,
        roads: route.roads, blocked: route.blocked, alternative: route.alternative,
        source: getSource(), updatedAt: Date.now(),
      });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, source: 'demo' }));
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return <DataContext.Provider value={{ ...state, refresh }}>{children}</DataContext.Provider>;
}
