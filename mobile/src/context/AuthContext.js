import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiLogin, apiLogout, apiMe, apiRegister, verifyLoginCode } from '../services/accountApi';
import { clearToken, loadToken, saveToken, setUnauthorizedHandler } from '../services/session';
import { registerForPush, unregisterPush } from '../services/push';
import { useLang } from '../i18n';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

// Friendly text for any failed call. HTTP errors carry the server's message; no status = server unreachable.
export const errorText = (e) => (e && e.status ? e.detail || e.message : 'Cannot reach the server. Check your connection and try again.');

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null, notice: null });
  const { setLang } = useLang();
  // after sign-in: use the language saved on the account and register this phone for alerts (both best effort)
  const onSignedIn = useCallback((user) => { if (user && user.language) setLang(user.language); registerForPush(); }, [setLang]);

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
        const me = await apiMe();
        setState({ status: 'in', user: me, notice: null });
        onSignedIn(me);
      } catch (e) {
        if (e && e.status) await clearToken();
        setState({ status: 'out', user: null, notice: e && e.status ? null : errorText(e) });
      }
    })();
  }, [signOutLocally, onSignedIn]);

  // `entering` marks a sign-in that just happened (not a restored session), so the app plays the welcome transition once
  const signedIn = useCallback(async (data) => {
    await saveToken(data.token);
    setState({ status: 'in', user: data.user, notice: null, entering: true });
    onSignedIn(data.user);
  }, [onSignedIn]);

  const login = useCallback(async (email, password) => {
    const data = await apiLogin(email.trim(), password); // throws with a readable message on failure
    await signedIn(data);
  }, [signedIn]);

  const loginWithCode = useCallback(async (email, code) => {
    const data = await verifyLoginCode(email.trim(), code.trim()); // user accounts only; the server refuses everyone else
    await signedIn(data);
  }, [signedIn]);

  const entered = useCallback(() => setState((s) => (s.entering ? { ...s, entering: false } : s)), []);

  const register = useCallback(async (form) => {
    await apiRegister(form); // the role is decided by the server; the client cannot send one
    await login(form.email, form.password);
  }, [login]);

  const logout = useCallback(async () => {
    await unregisterPush();
    try { await apiLogout(); } catch (e) { /* token may already be invalid */ }
    await signOutLocally();
  }, [signOutLocally]);

  const updateUser = useCallback((patch) => setState((s) => (s.user ? { ...s, user: { ...s.user, ...patch } } : s)), []);

  return <AuthContext.Provider value={{ ...state, login, loginWithCode, entered, register, logout, updateUser }}>{children}</AuthContext.Provider>;
}
