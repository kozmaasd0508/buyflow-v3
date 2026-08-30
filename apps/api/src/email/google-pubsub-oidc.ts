import { createPublicKey, verify } from 'node:crypto';

const DEFAULT_GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ACCEPTED_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const CLOCK_SKEW_SECONDS = 60;
const MAX_JWT_BYTES = 16 * 1024;

type FetchLike = typeof fetch;

interface GoogleJwk extends JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
}

interface GoogleJwksResponse {
  keys?: GoogleJwk[];
}

interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface JwtClaims {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  exp?: number;
  iat?: number;
  nbf?: number;
}

export interface VerifiedGooglePushIdentity {
  issuer: string;
  subject: string | null;
  email: string;
  audience: string;
  expiresAt: string;
}

export interface GooglePubSubOidcVerifierConfig {
  audience: string;
  serviceAccountEmail: string;
  jwksUrl?: string;
  fetchImpl?: FetchLike;
  now?: () => number;
}

function decodeJsonSegment<T>(segment: string, label: string): T {
  try {
    const raw = Buffer.from(segment, 'base64url').toString('utf8');
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Google Pub/Sub OIDC ${label} is malformed`);
  }
}

function maxAgeMs(cacheControl: string | null): number {
  const match = cacheControl?.match(/(?:^|,)\s*max-age=(\d+)/i);
  if (!match?.[1]) return 5 * 60_000;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return 5 * 60_000;
  return Math.min(seconds * 1000, 24 * 60 * 60_000);
}

function audienceContains(value: string | string[] | undefined, expected: string): boolean {
  if (typeof value === 'string') return value === expected;
  return Array.isArray(value) && value.includes(expected);
}

function verifiedEmail(value: boolean | string | undefined): boolean {
  return value === true || value === 'true';
}

export class GooglePubSubOidcVerifier {
  private readonly audience: string;
  private readonly serviceAccountEmail: string;
  private readonly jwksUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private cache: { expiresAtMs: number; keys: Map<string, GoogleJwk> } | null = null;

  constructor(config: GooglePubSubOidcVerifierConfig) {
    this.audience = config.audience.trim();
    this.serviceAccountEmail = config.serviceAccountEmail.trim().toLowerCase();
    if (!this.audience || !this.serviceAccountEmail) {
      throw new Error('Google Pub/Sub OIDC audience and service account email are required');
    }
    this.jwksUrl = config.jwksUrl?.trim() || DEFAULT_GOOGLE_JWKS_URL;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.now = config.now ?? Date.now;
  }

  private async refreshKeys(): Promise<Map<string, GoogleJwk>> {
    const response = await this.fetchImpl(this.jwksUrl, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Google OIDC key fetch failed with HTTP ${response.status}`);
    }
    const payload = await response.json() as GoogleJwksResponse;
    const keys = new Map<string, GoogleJwk>();
    for (const key of payload.keys ?? []) {
      if (
        typeof key.kid === 'string'
        && key.kid
        && key.kty === 'RSA'
        && (!key.alg || key.alg === 'RS256')
        && (!key.use || key.use === 'sig')
      ) {
        keys.set(key.kid, key);
      }
    }
    if (keys.size === 0) throw new Error('Google OIDC key set contained no usable RSA signing keys');
    this.cache = {
      expiresAtMs: this.now() + maxAgeMs(response.headers.get('cache-control')),
      keys,
    };
    return keys;
  }

  private async signingKey(kid: string): Promise<GoogleJwk> {
    const now = this.now();
    let keys = this.cache && this.cache.expiresAtMs > now
      ? this.cache.keys
      : await this.refreshKeys();
    let key = keys.get(kid);
    if (!key && this.cache?.expiresAtMs > now) {
      // Google may rotate before our cached max-age expires. Refresh once when a
      // signed token references an unknown key id.
      keys = await this.refreshKeys();
      key = keys.get(kid);
    }
    if (!key) throw new Error('Google Pub/Sub OIDC signing key is unknown');
    return key;
  }

  async verifyAuthorizationHeader(authorization: string | undefined): Promise<VerifiedGooglePushIdentity> {
    const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
    if (!match?.[1]) throw new Error('Google Pub/Sub OIDC bearer token is missing');
    const token = match[1];
    if (Buffer.byteLength(token, 'utf8') > MAX_JWT_BYTES) {
      throw new Error('Google Pub/Sub OIDC bearer token is too large');
    }
    const segments = token.split('.');
    if (segments.length !== 3 || !segments[0] || !segments[1] || !segments[2]) {
      throw new Error('Google Pub/Sub OIDC bearer token is malformed');
    }

    const header = decodeJsonSegment<JwtHeader>(segments[0], 'header');
    const claims = decodeJsonSegment<JwtClaims>(segments[1], 'claims');
    if (header.alg !== 'RS256' || !header.kid) {
      throw new Error('Google Pub/Sub OIDC signing algorithm is not allowed');
    }

    const key = await this.signingKey(header.kid);
    let publicKey;
    try {
      publicKey = createPublicKey({ key, format: 'jwk' });
    } catch {
      throw new Error('Google Pub/Sub OIDC signing key is invalid');
    }
    const signingInput = Buffer.from(`${segments[0]}.${segments[1]}`, 'ascii');
    const signature = Buffer.from(segments[2], 'base64url');
    if (!verify('RSA-SHA256', signingInput, publicKey, signature)) {
      throw new Error('Google Pub/Sub OIDC signature is invalid');
    }

    const nowSeconds = Math.floor(this.now() / 1000);
    if (!claims.iss || !ACCEPTED_ISSUERS.has(claims.iss)) {
      throw new Error('Google Pub/Sub OIDC issuer is invalid');
    }
    if (!audienceContains(claims.aud, this.audience)) {
      throw new Error('Google Pub/Sub OIDC audience is invalid');
    }
    if (typeof claims.exp !== 'number' || claims.exp < nowSeconds - CLOCK_SKEW_SECONDS) {
      throw new Error('Google Pub/Sub OIDC token is expired');
    }
    if (typeof claims.iat === 'number' && claims.iat > nowSeconds + CLOCK_SKEW_SECONDS) {
      throw new Error('Google Pub/Sub OIDC issued-at time is invalid');
    }
    if (typeof claims.nbf === 'number' && claims.nbf > nowSeconds + CLOCK_SKEW_SECONDS) {
      throw new Error('Google Pub/Sub OIDC token is not active yet');
    }
    const email = claims.email?.trim().toLowerCase();
    if (email !== this.serviceAccountEmail || !verifiedEmail(claims.email_verified)) {
      throw new Error('Google Pub/Sub OIDC service account identity is invalid');
    }

    return {
      issuer: claims.iss,
      subject: claims.sub?.trim() || null,
      email,
      audience: this.audience,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
    };
  }
}
