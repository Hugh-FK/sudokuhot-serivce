import type { AppDb } from '../db';
import { createAuthSession, getUserById, resolveUserForGoogleSignIn } from '../db/repos';
import { normalizeAuthEmail } from '../lib/email';
import type { Env } from '../env';
import { getEnv } from '../env';

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function getGoogleOAuthRedirectUri(env: Env): string | null {
  if (env.GOOGLE_OAUTH_REDIRECT_URI) {
    return env.GOOGLE_OAUTH_REDIRECT_URI.replace(/\/$/, '');
  }
  const apiOrigin = getEnv(env, 'API_PUBLIC_URL', '').replace(/\/$/, '');
  if (!apiOrigin) return null;
  return `${apiOrigin}/v1/auth/callback`;
}

export function getGoogleOAuthConfig(env: Env): GoogleOAuthConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const redirectUri = getGoogleOAuthRedirectUri(env);
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function getOAuthStateSecret(env: Env): string {
  return env.API_SECRET_KEY ?? env.JWT_SECRET ?? '';
}

export function getFrontendOrigin(env: Env): string {
  const explicit = getEnv(env, 'FRONTEND_URL', '');
  if (explicit) return explicit.replace(/\/$/, '');
  const origins = getEnv(env, 'ALLOWED_ORIGINS', '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return origins[0]?.replace(/\/$/, '') ?? 'http://localhost:4321';
}

export function buildGoogleAuthUrl(config: GoogleOAuthConfig, state: string): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('access_type', 'online');
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  id_token?: string;
};

type GoogleUserInfo = {
  id: string;
  email: string;
  verified_email?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  locale?: string;
};

export async function exchangeGoogleCode(
  config: GoogleOAuthConfig,
  code: string,
  redirectUri: string,
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`GOOGLE_TOKEN_EXCHANGE_FAILED:${res.status}:${detail}`);
  }

  return (await res.json()) as GoogleTokenResponse;
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`GOOGLE_USERINFO_FAILED:${res.status}:${detail}`);
  }

  return (await res.json()) as GoogleUserInfo;
}

export async function completeGoogleSignIn(
  db: AppDb,
  config: GoogleOAuthConfig,
  code: string,
  redirectUri?: string,
) {
  const effectiveRedirect = redirectUri ?? config.redirectUri;
  const tokens = await exchangeGoogleCode(config, code, effectiveRedirect);
  const info = await fetchGoogleUserInfo(tokens.access_token);

  if (!info.email) {
    throw new Error('GOOGLE_EMAIL_MISSING');
  }

  const displayName =
    info.name?.trim() ||
    [info.given_name, info.family_name].filter(Boolean).join(' ').trim() ||
    info.email.split('@')[0]?.replace(/[._]/g, ' ') ||
    'Sudoku Player';

  const avatarUrl = info.picture?.trim() || null;
  const locale = info.locale?.trim() || null;
  const googleId = info.id;

  const user = await resolveUserForGoogleSignIn(db, {
    googleId,
    email: normalizeAuthEmail(info.email),
    displayName,
    avatarUrl,
    locale,
  });

  const full = (await getUserById(db, user.id))!;
  const { token, expiresAt } = await createAuthSession(db, user.id);

  return {
    token,
    expiresAt,
    user: {
      id: full.id,
      googleId: full.googleId,
      email: full.email,
      name: full.displayName,
      displayName: full.displayName,
      picture: full.avatarUrl,
      avatarUrl: full.avatarUrl,
      locale: full.locale,
      provider: full.provider,
    },
  };
}

export function requireGoogleOAuthConfig(env: Env): GoogleOAuthConfig {
  const config = getGoogleOAuthConfig(env);
  if (!config) {
    throw new Error('GOOGLE_OAUTH_NOT_CONFIGURED');
  }
  return config;
}

export function requireOAuthStateSecret(env: Env): string {
  const secret = getOAuthStateSecret(env);
  if (!secret) {
    throw new Error('OAUTH_STATE_SECRET_MISSING');
  }
  return secret;
}

export function getRequiredFrontendOrigin(env: Env): string {
  return getFrontendOrigin(env);
}
