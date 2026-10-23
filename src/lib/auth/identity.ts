import "server-only";

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { headers } from "next/headers";

export type RequestIdentity = {
  email: string;
  subject: string;
  source: "cloudflare-access" | "development";
};

export class AuthenticationError extends Error {
  constructor(message = "Authentication is required.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export function normalizeIdentityEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new AuthenticationError("The authenticated identity has an invalid email address.");
  }
  return normalized;
}

export function resolveDevelopmentIdentity(
  email: string | undefined,
  nodeEnv = process.env.NODE_ENV,
): RequestIdentity {
  if (nodeEnv === "production") {
    throw new AuthenticationError();
  }
  if (!email?.trim()) {
    throw new AuthenticationError("Set DEV_AUTH_EMAIL to use a local development identity.");
  }
  return {
    email: normalizeIdentityEmail(email),
    subject: `development:${normalizeIdentityEmail(email)}`,
    source: "development",
  };
}

export type CloudflareAccessConfig = {
  issuer: string;
  audience: string;
  jwksUrl: URL;
};

export function getCloudflareAccessConfig(
  teamDomain = process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN,
  audience = process.env.CLOUDFLARE_ACCESS_AUD,
): CloudflareAccessConfig {
  if (!teamDomain?.trim() || !audience?.trim()) {
    throw new AuthenticationError("Cloudflare Access authentication is not configured.");
  }

  let domain: URL;
  try {
    domain = new URL(teamDomain.trim());
  } catch {
    throw new AuthenticationError("Cloudflare Access authentication is not configured.");
  }
  if (
    domain.protocol !== "https:" ||
    !domain.hostname.endsWith(".cloudflareaccess.com") ||
    domain.username || domain.password || domain.pathname !== "/" || domain.search || domain.hash
  ) {
    throw new AuthenticationError("Cloudflare Access authentication is not configured.");
  }

  return {
    issuer: domain.origin,
    audience: audience.trim(),
    jwksUrl: new URL("/cdn-cgi/access/certs", domain.origin),
  };
}

/** Verifies a Cloudflare Access JWT. A key resolver can be supplied for deterministic tests. */
export async function verifyCloudflareAccessJwt(
  token: string,
  config: CloudflareAccessConfig,
  keyResolver: JWTVerifyGetKey = createRemoteJWKSet(config.jwksUrl),
): Promise<RequestIdentity> {
  if (!token || token.length > 16_384 || token.split(".").length !== 3) {
    throw new AuthenticationError();
  }

  try {
    const { payload } = await jwtVerify(token, keyResolver, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "sub", "email"],
    });
    if (typeof payload.sub !== "string" || !payload.sub.trim() || typeof payload.email !== "string") {
      throw new AuthenticationError();
    }
    return {
      email: normalizeIdentityEmail(payload.email),
      subject: payload.sub,
      source: "cloudflare-access",
    };
  } catch (error) {
    if (error instanceof AuthenticationError) throw error;
    throw new AuthenticationError();
  }
}

export async function getRequestIdentity(): Promise<RequestIdentity> {
  if (process.env.NODE_ENV !== "production") {
    return resolveDevelopmentIdentity(process.env.DEV_AUTH_EMAIL);
  }

  const token = (await headers()).get("Cf-Access-Jwt-Assertion");
  if (!token) throw new AuthenticationError();
  return verifyCloudflareAccessJwt(token, getCloudflareAccessConfig());
}
