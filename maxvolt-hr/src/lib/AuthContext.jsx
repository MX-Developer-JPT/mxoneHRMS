import React, { createContext, useState, useContext, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

const TOKEN_KEY = 'base44_access_token';
const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser]                               = useState(null);
  const [isAuthenticated, setIsAuthenticated]         = useState(false);
  const [isLoadingAuth, setIsLoadingAuth]             = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(false);
  const [authError, setAuthError]                     = useState(null);
  const [appPublicSettings]                           = useState({ id: 'local', public_settings: { auth_required: true } });

  useEffect(() => { checkAppState(); }, []);

  const checkAppState = async () => {
    setAuthError(null);
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setIsLoadingAuth(false);
      setIsAuthenticated(false);
      return;
    }
    await checkUserAuth();
  };

  // Non-auth failures (network drop, Railway cold-start/502, a brief DB
  // blip surfaced as 503 — see the matching comment on the backend's /auth/me)
  // get several retries with backoff before this ever becomes something the
  // user sees, since a single 2s wait isn't long enough for a real cold
  // start. Only a genuine 401/403 (the token itself is invalid/expired)
  // skips retrying and ends the session — everything else must eventually
  // resolve to either success or "can't reach the server", NEVER a logout.
  const AUTH_RETRY_DELAYS_MS = [2000, 4000, 6000];

  const checkUserAuth = async (attempt = 0) => {
    setIsLoadingAuth(true);
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
      setAuthError(null);
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        // Genuine auth failure — the token really is invalid/expired.
        localStorage.removeItem(TOKEN_KEY);
        setIsAuthenticated(false);
        setAuthError({ type: 'auth_required', message: 'Session expired, please log in again.' });
      } else if (attempt < AUTH_RETRY_DELAYS_MS.length) {
        // Anything else (network drop, Railway cold-start/502, timeout) is
        // NOT proof the session is invalid — the token in localStorage is
        // still fine. A Capacitor WebView reload (backgrounding, brief
        // connectivity blip on resume) hits this path routinely; without
        // this retry, every one of those blips used to flip isAuthenticated
        // to false and bounce a still-logged-in user to the login screen.
        setIsLoadingAuth(false);
        await new Promise((r) => setTimeout(r, AUTH_RETRY_DELAYS_MS[attempt]));
        return checkUserAuth(attempt + 1);
      } else {
        // Still failing after every retry — genuinely can't reach the
        // server. Don't touch the token or claim the session expired; show
        // a "check your connection" prompt instead of silently logging the
        // user out.
        setAuthError({ type: 'network_error', message: 'Could not reach the server. Check your internet connection and try again.' });
      }
    } finally {
      setIsLoadingAuth(false);
    }
  };

  const logout = () => {
    base44.auth.logout();
  };

  const navigateToLogin = () => {
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      logout,
      navigateToLogin,
      checkAppState,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
