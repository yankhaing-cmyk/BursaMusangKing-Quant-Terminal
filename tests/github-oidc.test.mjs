import assert from "node:assert/strict";
import test from "node:test";

import {
  GITHUB_OIDC_ISSUER,
  clearGitHubOidcCacheForTests,
  verifyGitHubActionsToken,
} from "../shared/github-oidc.mjs";

const nowMilliseconds = Date.UTC(2026, 7, 19, 12, 0, 0);
const nowSeconds = Math.floor(nowMilliseconds / 1000);

function base64Url(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function signer() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  Object.assign(publicJwk, { kid: "test-key", alg: "RS256", use: "sig" });

  return {
    publicJwk,
    async token(overrides = {}) {
      const header = base64Url(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" }));
      const claims = base64Url(
        JSON.stringify({
          iss: GITHUB_OIDC_ISSUER,
          aud: "bursa-musangking-quant-terminal",
          sub: "repo:yankhaing-cmyk@299701268/BursaMusangKing-Quant-Terminal@1337859074:environment:quant-production",
          repository: "yankhaing-cmyk/BursaMusangKing-Quant-Terminal",
          repository_id: "1337859074",
          repository_owner_id: "299701268",
          repository_visibility: "public",
          ref: "refs/heads/main",
          workflow_ref:
            "yankhaing-cmyk/BursaMusangKing-Quant-Terminal/.github/workflows/quant-daily.yml@refs/heads/main",
          environment: "quant-production",
          event_name: "workflow_dispatch",
          runner_environment: "github-hosted",
          iat: nowSeconds - 5,
          nbf: nowSeconds - 5,
          exp: nowSeconds + 300,
          ...overrides,
        }),
      );
      const signed = new TextEncoder().encode(`${header}.${claims}`);
      const signature = new Uint8Array(
        await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, signed),
      );
      return `${header}.${claims}.${base64Url(signature)}`;
    },
  };
}

function jwksFetcher(publicJwk) {
  return async () => Response.json({ keys: [publicJwk] });
}

test("accepts only a signed token from the approved GitHub workflow identity", async () => {
  clearGitHubOidcCacheForTests();
  const identity = await signer();
  assert.equal(
    await verifyGitHubActionsToken(await identity.token(), {
      fetcher: jwksFetcher(identity.publicJwk),
      nowMilliseconds,
    }),
    true,
  );
});

test("rejects wrong repository, audience, branch, workflow, environment, and event claims", async () => {
  const cases = [
    { repository: "attacker/repository" },
    { repository_id: "9999999999" },
    { repository_owner_id: "999999999" },
    { repository_visibility: "private" },
    { aud: "another-service" },
    { ref: "refs/heads/feature" },
    { workflow_ref: "yankhaing-cmyk/BursaMusangKing-Quant-Terminal/.github/workflows/other.yml@refs/heads/main" },
    { environment: "development" },
    { event_name: "pull_request" },
  ];
  const identity = await signer();
  for (const claims of cases) {
    clearGitHubOidcCacheForTests();
    assert.equal(
      await verifyGitHubActionsToken(await identity.token(claims), {
        fetcher: jwksFetcher(identity.publicJwk),
        nowMilliseconds,
      }),
      false,
    );
  }
});

test("rejects expired and tampered tokens", async () => {
  const identity = await signer();
  clearGitHubOidcCacheForTests();
  assert.equal(
    await verifyGitHubActionsToken(
      await identity.token({ iat: nowSeconds - 600, exp: nowSeconds - 300 }),
      { fetcher: jwksFetcher(identity.publicJwk), nowMilliseconds },
    ),
    false,
  );

  clearGitHubOidcCacheForTests();
  const valid = await identity.token();
  const [header, claims, signature] = valid.split(".");
  const tamperedClaims = `${claims.slice(0, -1)}${claims.endsWith("A") ? "B" : "A"}`;
  assert.equal(
    await verifyGitHubActionsToken(`${header}.${tamperedClaims}.${signature}`, {
      fetcher: jwksFetcher(identity.publicJwk),
      nowMilliseconds,
    }),
    false,
  );
});
