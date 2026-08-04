import { useEffect, useState } from 'react';
import { isAuthConfigured } from './config';
import { startLogin } from './login';
import { isLoggedIn } from './session';

export interface AuthGuardState {
  authError: string | null;
  isCallbackRoute: boolean;
  isRedirecting: boolean;
}

export function useAuthGuard(): AuthGuardState {
  const [authError, setAuthError] = useState<string | null>(null);

  const isCallbackRoute = window.location.pathname === '/callback';
  const needsLogin = isAuthConfigured() && !isCallbackRoute && !isLoggedIn();

  useEffect(() => {
    if (!needsLogin) {
      setAuthError(null);
      return;
    }

    let active = true;

    void startLogin().catch((loginError) => {
      if (!active) return;
      setAuthError(loginError instanceof Error ? loginError.message : String(loginError));
    });

    return () => {
      active = false;
    };
  }, [needsLogin]);

  return {
    authError,
    isCallbackRoute,
    isRedirecting: needsLogin && authError === null,
  };
}
