import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import { createLocalJWKSet, exportJWK, SignJWT } from "jose";
import {
  AuthenticationError,
  getCloudflareAccessConfig,
  normalizeIdentityEmail,
  resolveDevelopmentIdentity,
  verifyCloudflareAccessJwt,
} from "./identity";

const issuer = "https://hiiiive.cloudflareaccess.com";
const audience = "invoice-entry-test-audience";

describe("authentication identity", () => {
  it("normalizes explicit development email and rejects missing or production development identities", () => {
    assert.deepEqual(resolveDevelopmentIdentity("  Dev.User@Example.COM  ", "development"), {
      email: "dev.user@example.com",
      subject: "development:dev.user@example.com",
      source: "development",
    });
    assert.throws(() => resolveDevelopmentIdentity(undefined, "development"), /DEV_AUTH_EMAIL/);
    assert.throws(() => resolveDevelopmentIdentity("dev@example.com", "production"), AuthenticationError);
    assert.throws(() => normalizeIdentityEmail("not-an-email"), AuthenticationError);
  });

  it("accepts only a configured HTTPS Cloudflare Access team origin", () => {
    assert.deepEqual(getCloudflareAccessConfig(issuer, audience), {
      issuer,
      audience,
      jwksUrl: new URL(`${issuer}/cdn-cgi/access/certs`),
    });
    assert.throws(() => getCloudflareAccessConfig("http://hiiiive.cloudflareaccess.com", audience), AuthenticationError);
    assert.throws(() => getCloudflareAccessConfig("https://example.com", audience), AuthenticationError);
    assert.throws(() => getCloudflareAccessConfig(issuer, " "), AuthenticationError);
  });

  it("verifies signatures, issuer, audience, expiry, not-before, required claims, and normalized email offline", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = await exportJWK(publicKey);
    jwk.kid = "local-test-key";
    jwk.use = "sig";
    jwk.alg = "RS256";
    const localKeys = createLocalJWKSet({ keys: [jwk] });
    const config = getCloudflareAccessConfig(issuer, audience);

    const sign = async (claims: Record<string, unknown> = {}, options: {
      tokenIssuer?: string; tokenAudience?: string; expires?: string; notBefore?: string; subject?: string;
    } = {}) => {
      let jwt = new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "local-test-key" })
        .setIssuer(options.tokenIssuer ?? issuer)
        .setAudience(options.tokenAudience ?? audience)
        .setSubject(options.subject ?? "access-subject-123")
        .setIssuedAt();
      if (options.expires !== "missing") jwt = jwt.setExpirationTime(options.expires ?? "5m");
      if (options.notBefore) jwt = jwt.setNotBefore(options.notBefore);
      return jwt.sign(privateKey);
    };

    const valid = await verifyCloudflareAccessJwt(
      await sign({ email: "  BILLING@Example.COM " }), config, localKeys,
    );
    assert.deepEqual(valid, {
      email: "billing@example.com",
      subject: "access-subject-123",
      source: "cloudflare-access",
    });
    await assert.rejects(verifyCloudflareAccessJwt(await sign({ email: "user@example.com" }, { tokenIssuer: "https://wrong.example" }), config, localKeys), AuthenticationError);
    await assert.rejects(verifyCloudflareAccessJwt(await sign({ email: "user@example.com" }, { tokenAudience: "wrong" }), config, localKeys), AuthenticationError);
    await assert.rejects(verifyCloudflareAccessJwt(await sign({ email: "user@example.com" }, { expires: "-1m" }), config, localKeys), AuthenticationError);
    await assert.rejects(verifyCloudflareAccessJwt(await sign({ email: "user@example.com" }, { notBefore: "2m" }), config, localKeys), AuthenticationError);
    await assert.rejects(verifyCloudflareAccessJwt(await sign({ email: "user@example.com" }, { expires: "missing" }), config, localKeys), AuthenticationError);
    await assert.rejects(verifyCloudflareAccessJwt(await sign({}), config, localKeys), AuthenticationError);
    await assert.rejects(verifyCloudflareAccessJwt(await sign({ email: "bad-email" }), config, localKeys), AuthenticationError);
    await assert.rejects(verifyCloudflareAccessJwt("not-a-jwt", config, localKeys), AuthenticationError);
    await assert.rejects(verifyCloudflareAccessJwt("", config, localKeys), AuthenticationError);

    const otherPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const badSignature = await new SignJWT({ email: "user@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "local-test-key" })
      .setIssuer(issuer).setAudience(audience).setSubject("bad-signer").setIssuedAt().setExpirationTime("5m")
      .sign(otherPair.privateKey);
    await assert.rejects(verifyCloudflareAccessJwt(badSignature, config, localKeys), AuthenticationError);
  });
});
