/**
 * Lambda@Edge Viewer Request Handler for Google OIDC Authentication.
 *
 * Implements the edge authentication architecture specified in docs/aws-architecture.md:
 * - Intercepts viewer requests for SPA static files, data artifacts (/data/*), and API routes (/api/*).
 * - Validates session cookie (TOKEN) containing a Google-signed ID token (JWT).
 * - Handles the OAuth 2.0 callback route (/_callback) by exchanging authorization code with Google,
 *   verifying the JWT signature against Google's JWKS, and issuing the session cookie.
 * - Redirects unauthenticated browser requests to Google's OAuth 2.0 authorization endpoint.
 * - Rejects unauthenticated API requests with 401 Unauthorized.
 * - Fetches and caches configuration from AWS Secrets Manager (us-east-1).
 * - Implemented using Node.js 20+ standard library (crypto, fetch) and runtime-bundled @aws-sdk.
 */

'use strict';

const crypto = require('node:crypto');

let SecretsManagerClient = null;
let GetSecretValueCommand = null;
try {
  const sm = require('@aws-sdk/client-secrets-manager');
  SecretsManagerClient = sm.SecretsManagerClient;
  GetSecretValueCommand = sm.GetSecretValueCommand;
} catch {
  // @aws-sdk is provided by the AWS Lambda runtime; fallback when running in local test environments
}

const SECRET_NAME = process.env.GOOGLE_OIDC_SECRET_NAME || 'GameQaDashboard/GoogleOidcConfig';
const SM_REGION = 'us-east-1';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const COOKIE_NAME = 'TOKEN';
const DEFAULT_COOKIE_TTL = 43200; // 12 hours in seconds

// In-memory cache across Lambda invocations within the same edge location container
let cachedConfig = null;
let cachedJwks = null;
let jwksLastFetchedAt = 0;
let smClient = null;

function getSmClient() {
  if (!smClient && SecretsManagerClient) {
    smClient = new SecretsManagerClient({ region: SM_REGION });
  }
  return smClient;
}


/**
 * Retrieve and cache Google OIDC configuration from Secrets Manager.
 */
async function getConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }

  const client = getSmClient();
  if (!client || !GetSecretValueCommand) {
    return null;
  }

  try {
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: SECRET_NAME })
    );

    if (!response.SecretString) {
      throw new Error(`Secret ${SECRET_NAME} contains no SecretString.`);
    }

    const parsed = JSON.parse(response.SecretString);
    cachedConfig = {
      clientId: parsed.clientId || parsed.GOOGLE_CLIENT_ID || '',
      clientSecret: parsed.clientSecret || parsed.GOOGLE_CLIENT_SECRET || '',
      allowedDomain: parsed.allowedDomain || parsed.ALLOWED_DOMAIN || '',
      allowedEmails: (parsed.allowedEmails || parsed.ALLOWED_EMAILS || '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    };

    return cachedConfig;
  } catch (err) {
    console.error('Failed to load Google OIDC configuration from Secrets Manager:', err);
    return null;
  }
}

/**
 * Fetch and cache Google JWKS public keys.
 */
async function getGoogleJwks(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedJwks && now - jwksLastFetchedAt < 3600 * 1000) {
    return cachedJwks;
  }

  try {
    const res = await fetch(GOOGLE_JWKS_URL);
    if (!res.ok) {
      throw new Error(`JWKS fetch failed with status ${res.status}`);
    }
    const data = await res.json();
    if (data && Array.isArray(data.keys)) {
      cachedJwks = data.keys;
      jwksLastFetchedAt = now;
      return cachedJwks;
    }
  } catch (err) {
    console.error('Failed to fetch Google JWKS:', err);
  }

  return cachedJwks || [];
}

/**
 * Parse cookies from request headers.
 */
function parseCookies(headers) {
  const cookies = {};
  if (!headers.cookie) {
    return cookies;
  }

  for (const cookieHeader of headers.cookie) {
    const pairs = cookieHeader.value.split(';');
    for (const pair of pairs) {
      const idx = pair.indexOf('=');
      if (idx > -1) {
        const key = pair.substring(0, idx).trim();
        const val = pair.substring(idx + 1).trim();
        cookies[key] = decodeURIComponent(val);
      }
    }
  }
  return cookies;
}

/**
 * Verify a Google-signed JWT (ID token).
 */
async function verifyGoogleIdToken(token, config) {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf-8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }

  // Verify expiration
  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < nowSec) {
    return null;
  }

  // Verify issuer
  const validIssuers = ['https://accounts.google.com', 'accounts.google.com'];
  if (!validIssuers.includes(payload.iss)) {
    return null;
  }

  // Verify audience matches our configured Google Client ID (if configured)
  if (config.clientId && payload.aud !== config.clientId) {
    return null;
  }

  // Verify cryptographic signature against Google's public keys
  let jwks = await getGoogleJwks(false);
  let key = jwks.find((k) => k.kid === header.kid);

  if (!key) {
    // Retry once with forced refresh in case of key rotation
    jwks = await getGoogleJwks(true);
    key = jwks.find((k) => k.kid === header.kid);
  }

  if (!key) {
    console.warn('Google JWKS key not found for kid:', header.kid);
    return null;
  }

  try {
    const publicKey = crypto.createPublicKey({
      key: {
        kty: 'RSA',
        n: key.n,
        e: key.e,
      },
      format: 'jwk',
    });

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    const isValid = verifier.verify(publicKey, Buffer.from(signatureB64, 'base64url'));

    if (!isValid) {
      return null;
    }
  } catch (err) {
    console.error('JWT signature verification error:', err);
    return null;
  }

  // Check domain restrictions if configured
  if (config.allowedDomain) {
    if (payload.hd !== config.allowedDomain) {
      console.warn(`Access denied: Google Workspace domain '${payload.hd}' does not match '${config.allowedDomain}'`);
      return { authorized: false, payload };
    }
  }

  // Check email allowlist if configured
  if (config.allowedEmails && config.allowedEmails.length > 0) {
    const userEmail = (payload.email || '').toLowerCase();
    if (!config.allowedEmails.includes(userEmail)) {
      console.warn(`Access denied: Email '${userEmail}' is not in allowedEmails list`);
      return { authorized: false, payload };
    }
  }

  return { authorized: true, payload };
}

/**
 * Handle the OAuth 2.0 redirect callback (/_callback).
 */
async function handleCallback(request, config) {
  const params = new URLSearchParams(request.querystring || '');
  const code = params.get('code');
  const state = params.get('state');

  if (!code) {
    return {
      status: '400',
      statusDescription: 'Bad Request',
      headers: {
        'content-type': [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }],
      },
      body: '<h1>400 Bad Request</h1><p>Missing authorization code in Google callback.</p>',
    };
  }

  const hostHeader = request.headers.host?.[0]?.value || '';
  const redirectUri = `https://${hostHeader}/_callback`;

  // Exchange authorization code for tokens
  const tokenBody = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  }).toString();

  let tokenData;
  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenBody,
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Google token exchange failed:', tokenRes.status, errText);
      return {
        status: '401',
        statusDescription: 'Unauthorized',
        headers: {
          'content-type': [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }],
        },
        body: `<h1>Authentication Failed</h1><p>Failed to exchange authorization code with Google: ${tokenRes.status}</p>`,
      };
    }

    tokenData = await tokenRes.json();
  } catch (err) {
    console.error('Network error during Google token exchange:', err);
    return {
      status: '502',
      statusDescription: 'Bad Gateway',
      headers: {
        'content-type': [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }],
      },
      body: '<h1>502 Bad Gateway</h1><p>Could not connect to Google OAuth service.</p>',
    };
  }

  const idToken = tokenData.id_token;
  if (!idToken) {
    return {
      status: '401',
      statusDescription: 'Unauthorized',
      headers: {
        'content-type': [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }],
      },
      body: '<h1>Authentication Failed</h1><p>No ID token received from Google.</p>',
    };
  }

  // Verify ID token
  const verification = await verifyGoogleIdToken(idToken, config);
  if (!verification || !verification.authorized) {
    const userEmail = verification?.payload?.email || 'Unknown';
    return {
      status: '403',
      statusDescription: 'Forbidden',
      headers: {
        'content-type': [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }],
      },
      body: `<h1>403 Forbidden</h1><p>Access denied for account <strong>${userEmail}</strong>. You are not authorized to view this dashboard.</p>`,
    };
  }

  // Determine return URL from state parameter
  let targetUrl = '/';
  if (state && state.startsWith('/') && !state.startsWith('/_callback')) {
    targetUrl = state;
  }

  const ttl = DEFAULT_COOKIE_TTL;
  const cookieValue = `${COOKIE_NAME}=${encodeURIComponent(idToken)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${ttl}`;

  return {
    status: '302',
    statusDescription: 'Found',
    headers: {
      location: [{ key: 'Location', value: targetUrl }],
      'set-cookie': [{ key: 'Set-Cookie', value: cookieValue }],
    },
  };
}

/**
 * Main Lambda@Edge Viewer Request entrypoint.
 */
exports.handler = async (event) => {
  const request = event.Records[0].cf.request;
  const uri = request.uri;

  const config = await getConfig();

  // If configuration in Secrets Manager is missing or incomplete, return 503 guidance
  if (!config || !config.clientId || !config.clientSecret) {
    console.warn('Google OIDC configuration is incomplete in Secrets Manager.');
    // Let API calls get a JSON error; browser calls get HTML guidance
    if (uri.startsWith('/api/')) {
      return {
        status: '503',
        statusDescription: 'Service Unavailable',
        headers: {
          'content-type': [{ key: 'Content-Type', value: 'application/json' }],
        },
        body: JSON.stringify({
          error: 'Authentication service not configured. Please populate Google OAuth credentials in AWS Secrets Manager.',
        }),
      };
    }

    return {
      status: '503',
      statusDescription: 'Service Unavailable',
      headers: {
        'content-type': [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }],
      },
      body: `<!DOCTYPE html>
<html>
<head><title>Configuration Required - Game QA Dashboard</title></head>
<body style="font-family: sans-serif; max-width: 600px; margin: 40px auto; padding: 20px;">
  <h2>Game QA Dashboard — 認証設定が必要です</h2>
  <p>Google OAuth 2.0 認証情報が Secrets Manager に未設定です。</p>
  <p>AWS マネジメントコンソールの <code>us-east-1</code> (バージニア北部) リージョンにて、シークレット <code>${SECRET_NAME}</code> に以下の JSON キーを設定してください：</p>
  <pre style="background: #f4f4f5; padding: 12px; border-radius: 6px;">{
  "clientId": "your-web-client-id.apps.googleusercontent.com",
  "clientSecret": "your-web-client-secret",
  "allowedDomain": "example.com"
}</pre>
</body>
</html>`,
    };
  }

  // 1. Handle OAuth 2.0 callback
  if (uri === '/_callback') {
    return await handleCallback(request, config);
  }

  // 2. Check existing session cookie
  const cookies = parseCookies(request.headers);
  const sessionToken = cookies[COOKIE_NAME];

  if (sessionToken) {
    const verification = await verifyGoogleIdToken(sessionToken, config);
    if (verification && verification.authorized) {
      // Authenticated and authorized: pass request through to CloudFront origin
      return request;
    }
  }

  // 3. Unauthenticated / expired session handling
  // For API endpoints, return 401 Unauthorized JSON instead of redirecting
  if (uri.startsWith('/api/')) {
    return {
      status: '401',
      statusDescription: 'Unauthorized',
      headers: {
        'content-type': [{ key: 'Content-Type', value: 'application/json' }],
      },
      body: JSON.stringify({ error: 'Unauthorized: Google authentication required.' }),
    };
  }

  // For browser requests, redirect to Google OAuth 2.0 authorization endpoint
  const hostHeader = request.headers.host?.[0]?.value || '';
  const returnPath = uri + (request.querystring ? `?${request.querystring}` : '');
  const redirectUri = `https://${hostHeader}/_callback`;

  const authParams = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: returnPath,
    prompt: 'select_account',
  });

  if (config.allowedDomain) {
    authParams.set('hd', config.allowedDomain);
  }

  const googleLoginUrl = `${GOOGLE_AUTH_URL}?${authParams.toString()}`;

  return {
    status: '302',
    statusDescription: 'Found',
    headers: {
      location: [{ key: 'Location', value: googleLoginUrl }],
    },
  };
};

// Exported for testing
exports._setCachedConfig = (config) => {
  cachedConfig = config;
};

exports._setCachedJwks = (jwks) => {
  cachedJwks = jwks;
  jwksLastFetchedAt = Date.now();
};

