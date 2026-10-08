import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiLogin, apiLogout, apiMe, apiRegister } from '../services/accountApi';
import { clearToken, loadToken, saveToken, setUnauthorizedHandler } from '../services/session';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

// Friendly text for any failed call. HTTP errors carry the server's message; no status = server unreachable.
export const errorText = (e) => (e && e.status ? e.detail || e.message : 'Cannot reach the server. Check your connection and try again.');

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null, notice: null });

  const signOutLocally = useCallback(async (notice = null) => {
    await clearToken();
    setState({ status: 'out', user: null, notice });
  }, []);

  // On start: restore the saved session and let the backend confirm it (and the role) before showing anything.
  useEffect(() => {
    setUnauthorizedHandler(() => signOutLocally('Your session has ended. Please log in again.'));
    (async () => {
      const token = await loadToken();
      if (!token) return setState({ status: 'out', user: null, notice: null });
      try {
        setState({ status: 'in', user: await apiMe(), notice: null });
      } catch (e) {
        if (e && e.status) await clearToken();
        setState({ status: 'out', user: null, notice: e && e.status ? null : errorText(e) });
      }
    })();
  }, [signOutLocally]);

  const login = useCallback(async (email, password) => {
    const data = await apiLogin(email.trim(), password); // throws with a readable message on failure
    await saveToken(data.token);
    setState({ status: 'in', user: data.user, notice: null });
  }, []);

  const register = useCallback(async (form) => {
    await apiRegister(form); // the role is decided by the server; the client cannot send one
    await login(form.email, form.password);
  }, [login]);

  const logout = useCallback(async () => {
    try { await apiLogout(); } catch (e) { /* token may already be invalid */ }
    await signOutLocally();
  }, [signOutLocally]);

  return <AuthContext.Provider value={{ ...state, login, register, logout }}>{children}</AuthContext.Provider>;
}
