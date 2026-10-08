import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../context/AuthContext';

// Loads data now and every `ms`. Returns {data, error, loading, reload}. Errors are shown, never swallowed.
export default function usePolling(fn, ms = 6000) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const alive = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const reload = useCallback(async () => {
    try {
      const data = await fnRef.current();
      if (alive.current) setState({ data, error: null, loading: false });
    } catch (e) {
      if (alive.current) setState((s) => ({ ...s, error: errorText(e), loading: false }));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    reload();
    const t = setInterval(reload, ms);
    return () => { alive.current = false; clearInterval(t); };
  }, [reload, ms]);

  return { ...state, reload };
}
