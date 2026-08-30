import { createHash, randomBytes } from 'node:crypto';

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

type FetchLike = typeof fetch;

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

interface GmailProfileResponse {
  emailAddress?: string;
  historyId?: string;
}

export interface GmailOAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  scopes: string[];
  tokenType: string;
}

export interface GmailOAuthProfile {
  emailAddress: string;
  historyId: string | null;
}

export interface GmailPkcePair {
  verifier: string;
  challenge: string;
}

export interface GoogleGmailOAuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  gmailApiBaseUrl?: string;
  fetchImpl?: FetchLike;
}

function expiresAt(expiresInSeconds: number | undefined): string {
  const seconds = Number.isFinite(expiresInSeconds) && (expiresInSeconds ?? 0) > 0
    ? Math.trunc(expiresInSeconds!)
    : 3600;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function normalizeScopes(value: string | undefined): string[] {
  return [...new Set((value ?? '')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean))];
}

export function assertGmailReadonlyScope(scopes: string[]): void {
  if (!scopes.includes(GMAIL_READONLY_SCOPE)) {
    throw new Error('Google OAuth credential is missing required Gmail readonly scope');
  }
}

function requireAccessToken(response: GoogleTokenResponse): GmailOAuthTokens {
  const accessToken = response.access_token?.trim();
  if (!accessToken) throw new Error('Google OAuth token response is missing access_token');
  return {
    accessToken,
    refreshToken: response.refresh_token?.trim() || null,
    expiresAt: expiresAt(response.expires_in),
    scopes: normalizeScopes(response.scope),
    tokenType: response.token_type?.trim() || 'Bearer',
  };
}

export function createGmailPkcePair(): GmailPkcePair {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export class GoogleGmailOAuthClient {
  private readonly authorizeUrl: string;
  private readonly tokenUrl: string;
  private readonly gmailApiBaseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly config: GoogleGmailOAuthClientConfig) {
    if (!config.clientId.trim() || !config.clientSecret.trim() || !config.redirectUri.trim()) {
      throw new Error('Google Gmail OAuth client configuration is incomplete');
    }
    this.authorizeUrl = config.authorizeUrl?.trim() || 'https://accounts.google.com/o/oauth2/v2/auth';
    this.tokenUrl = config.tokenUrl?.trim() || 'https://oauth2.googleapis.com/token';
    this.gmailApiBaseUrl = (config.gmailApiBaseUrl?.trim() || 'https://gmail.googleapis.com/gmail/v1').replace(/\/$/, '');
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  buildAuthorizeUrl(input: { state: string; codeChallenge: string }): string {
    if (!input.state.trim() || !input.codeChallenge.trim()) {
      throw new Error('Google Gmail OAuth state and PKCE challenge are required');
    }
    const url = new URL(this.authorizeUrl);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GMAIL_READONLY_SCOPE);
    url.searchParams.set('access_type', 'offline');
    // Do not fold older Google grants into this credential. BuyFlow's direct
    // Gmail lane deliberately requests only gmail.readonly.
    url.searchParams.set('include_granted_scopes', 'false');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', input.state);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async exchangeCode(input: { code: string; codeVerifier: string }): Promise<GmailOAuthTokens> {
    const code = input.code.trim();
    const verifier = input.codeVerifier.trim();
    if (!code || !verifier) throw new Error('Google Gmail OAuth code and PKCE verifier are required');
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: this.config.redirectUri,
    });
    const response = await this.fetchImpl(this.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!response.ok) throw new Error(`Google OAuth code exchange failed with HTTP ${response.status}`);
    const token = requireAccessToken(await response.json() as GoogleTokenResponse);
    assertGmailReadonlyScope(token.scopes);
    return token;
  }

  async refreshAccessToken(refreshToken: string): Promise<GmailOAuthTokens> {
    const token = refreshToken.trim();
    if (!token) throw new Error('Google Gmail refresh token is required');
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: token,
      grant_type: 'refresh_token',
    });
    const response = await this.fetchImpl(this.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!response.ok) throw new Error(`Google OAuth token refresh failed with HTTP ${response.status}`);
    const refreshed = requireAccessToken(await response.json() as GoogleTokenResponse);
    return {
      ...refreshed,
      refreshToken: null,
    };
  }

  async getGmailProfile(accessToken: string): Promise<GmailOAuthProfile> {
    const token = accessToken.trim();
    if (!token) throw new Error('Google Gmail access token is required');
    const response = await this.fetchImpl(`${this.gmailApiBaseUrl}/users/me/profile`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) throw new Error(`Gmail profile lookup failed with HTTP ${response.status}`);
    const profile = await response.json() as GmailProfileResponse;
    const emailAddress = profile.emailAddress?.trim().toLowerCase();
    if (!emailAddress) throw new Error('Gmail profile response is missing emailAddress');
    return {
      emailAddress,
      historyId: profile.historyId?.trim() || null,
    };
  }
}
