export interface AuthConfig {
  domain: string | null;
  clientId: string | null;
  redirectUri: string;
  logoutUri: string;
  scopes: string;
  authorizationEndpoint: string | null;
  tokenEndpoint: string | null;
  logoutEndpoint: string | null;
}

function normalizeDomain(domain?: string): string | null {
  const trimmed = domain?.trim();
  return trimmed ? trimmed.replace(/\/+$/, '') : null;
}

const domain = normalizeDomain(import.meta.env.VITE_COGNITO_DOMAIN);
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID?.trim() || null;

export const authConfig: AuthConfig = {
  domain,
  clientId,
  redirectUri:
    import.meta.env.VITE_COGNITO_REDIRECT_URI?.trim() || `${window.location.origin}/callback`,
  logoutUri: import.meta.env.VITE_COGNITO_LOGOUT_URI?.trim() || `${window.location.origin}/`,
  scopes: 'openid email profile',
  authorizationEndpoint: domain ? `${domain}/oauth2/authorize` : null,
  tokenEndpoint: domain ? `${domain}/oauth2/token` : null,
  logoutEndpoint: domain ? `${domain}/logout` : null,
};

export function isAuthConfigured(): boolean {
  return Boolean(authConfig.domain && authConfig.clientId);
}
