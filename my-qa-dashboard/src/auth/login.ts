import { authConfig, isAuthConfigured } from './config';
import { generateCodeChallenge, generateCodeVerifier } from './pkce';
import type { TokenResponse } from './session';
import { clearSession, saveTokens } from './session';

const TEMP_KEYS = {
  codeVerifier: 'auth.pkce_code_verifier',
  state: 'auth.oauth_state',
} as const;

let callbackPromise: Promise<void> | null = null;
let loginRedirectPromise: Promise<void> | null = null;

function requireAuthConfig(): void {
  if (
    !isAuthConfigured() ||
    !authConfig.clientId ||
    !authConfig.authorizationEndpoint ||
    !authConfig.tokenEndpoint
  ) {
    throw new Error('Cognito 設定が不足しています。');
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function generateState(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

function clearLoginAttempt(): void {
  sessionStorage.removeItem(TEMP_KEYS.codeVerifier);
  sessionStorage.removeItem(TEMP_KEYS.state);
}

function appHomeUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).toString();
}

async function beginLoginRedirect(): Promise<void> {
  requireAuthConfig();
  const clientId = authConfig.clientId!;
  const authorizationEndpoint = authConfig.authorizationEndpoint!;

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateState();

  sessionStorage.setItem(TEMP_KEYS.codeVerifier, codeVerifier);
  sessionStorage.setItem(TEMP_KEYS.state, state);

  const authorizeUrl = new URL(authorizationEndpoint);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', authConfig.redirectUri);
  authorizeUrl.searchParams.set('scope', authConfig.scopes);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('state', state);

  window.location.assign(authorizeUrl.toString());
}

export function startLogin(): Promise<void> {
  loginRedirectPromise ??= beginLoginRedirect().finally(() => {
    loginRedirectPromise = null;
  });
  return loginRedirectPromise;
}

async function exchangeCodeForTokens(): Promise<void> {
  requireAuthConfig();
  const clientId = authConfig.clientId!;
  const tokenEndpoint = authConfig.tokenEndpoint!;

  const currentUrl = new URL(window.location.href);
  const code = currentUrl.searchParams.get('code');
  const returnedState = currentUrl.searchParams.get('state');
  const authError = currentUrl.searchParams.get('error');
  const authErrorDescription = currentUrl.searchParams.get('error_description');

  if (authError) {
    clearLoginAttempt();
    throw new Error(authErrorDescription ?? authError);
  }

  const expectedState = sessionStorage.getItem(TEMP_KEYS.state);
  const codeVerifier = sessionStorage.getItem(TEMP_KEYS.codeVerifier);

  if (!code || !returnedState) {
    clearLoginAttempt();
    throw new Error('Cognito コールバックに code/state がありません。');
  }
  if (!expectedState || returnedState !== expectedState) {
    clearLoginAttempt();
    throw new Error('Cognito state の検証に失敗しました。');
  }
  if (!codeVerifier) {
    clearLoginAttempt();
    throw new Error('PKCE code_verifier が見つかりません。');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: authConfig.redirectUri,
    code_verifier: codeVerifier,
  });

  try {
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`トークン交換に失敗しました: ${response.status} ${errorText}`);
    }

    const tokenResponse = (await response.json()) as TokenResponse;
    saveTokens(tokenResponse);

    try {
      const signedCookieResponse = await fetch(`${import.meta.env.BASE_URL}api/auth/cookie`, {
        headers: {
          Authorization: `Bearer ${tokenResponse.id_token}`,
        },
        credentials: 'include',
      });

      if (!signedCookieResponse.ok) {
        console.warn(
          `CloudFront signed cookie fetch failed: ${signedCookieResponse.status}`,
        );
      }
    } catch (cookieError) {
      console.warn('CloudFront signed cookie fetch failed:', cookieError);
    }
    // TODO: consider periodic refresh before expiry.
  } finally {
    clearLoginAttempt();
  }

  window.location.replace(appHomeUrl());
}

export function handleCallback(): Promise<void> {
  callbackPromise ??= exchangeCodeForTokens().finally(() => {
    callbackPromise = null;
  });
  return callbackPromise;
}

export function logout(): void {
  clearLoginAttempt();
  clearSession();

  if (!isAuthConfigured() || !authConfig.clientId || !authConfig.logoutEndpoint) {
    window.location.replace(appHomeUrl());
    return;
  }

  const logoutUrl = new URL(authConfig.logoutEndpoint);
  logoutUrl.searchParams.set('client_id', authConfig.clientId);
  logoutUrl.searchParams.set('logout_uri', authConfig.logoutUri);
  window.location.assign(logoutUrl.toString());
}
