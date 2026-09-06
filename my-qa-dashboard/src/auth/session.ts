const SESSION_KEYS = {
  idToken: 'auth.id_token',
  accessToken: 'auth.access_token',
  refreshToken: 'auth.refresh_token',
  expiresAt: 'auth.expires_at',
} as const;

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  id_token: string;
  refresh_token?: string;
  token_type?: string;
}

function getExpiresAt(): number | null {
  const rawValue = sessionStorage.getItem(SESSION_KEYS.expiresAt);
  if (!rawValue) return null;

  const expiresAt = Number.parseInt(rawValue, 10);
  return Number.isFinite(expiresAt) ? expiresAt : null;
}

function hasExpired(): boolean {
  const expiresAt = getExpiresAt();
  return expiresAt !== null && Date.now() >= expiresAt;
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEYS.idToken);
  sessionStorage.removeItem(SESSION_KEYS.accessToken);
  sessionStorage.removeItem(SESSION_KEYS.refreshToken);
  sessionStorage.removeItem(SESSION_KEYS.expiresAt);
}

export function saveTokens(tokenResponse: TokenResponse): void {
  sessionStorage.setItem(SESSION_KEYS.idToken, tokenResponse.id_token);
  sessionStorage.setItem(SESSION_KEYS.accessToken, tokenResponse.access_token);

  if (tokenResponse.refresh_token) {
    sessionStorage.setItem(SESSION_KEYS.refreshToken, tokenResponse.refresh_token);
  } else {
    sessionStorage.removeItem(SESSION_KEYS.refreshToken);
  }

  sessionStorage.setItem(
    SESSION_KEYS.expiresAt,
    String(Date.now() + tokenResponse.expires_in * 1000),
  );
}

export function getIdToken(): string | null {
  if (hasExpired()) {
    clearSession();
    return null;
  }

  return sessionStorage.getItem(SESSION_KEYS.idToken);
}

export function getAccessToken(): string | null {
  if (hasExpired()) {
    clearSession();
    return null;
  }

  return sessionStorage.getItem(SESSION_KEYS.accessToken);
}

export function isLoggedIn(): boolean {
  return getIdToken() !== null && getAccessToken() !== null;
}
