const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS_URL = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;

const DEFAULT_POLICY = Object.freeze({
  audience: "bursa-musangking-quant-terminal",
  repository: "yankhaing-cmyk/BursaMusangKing-Quant-Terminal",
  repositoryId: "1337859074",
  repositoryOwnerId: "299701268",
  repositoryVisibility: "public",
  ref: "refs/heads/main",
  workflowRef:
    "yankhaing-cmyk/BursaMusangKing-Quant-Terminal/.github/workflows/quant-daily.yml@refs/heads/main",
  environment: "quant-production",
  subject:
    "repo:yankhaing-cmyk@299701268/BursaMusangKing-Quant-Terminal@1337859074:environment:quant-production",
  eventNames: ["workflow_dispatch", "schedule"],
  runnerEnvironment: "github-hosted",
});

let jwksCache = null;

function decodeBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("invalid_base64url");
  }
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function decodeJsonSegment(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function includesAudience(audience, expected) {
  return typeof audience === "string"
    ? audience === expected
    : Array.isArray(audience) && audience.includes(expected);
}

function exactString(value, expected) {
  return typeof value === "string" && value === expected;
}

function validateClaims(claims, policy, nowSeconds) {
  const clockSkewSeconds = 60;
  const issuedAt = Number(claims.iat);
  const notBefore = claims.nbf === undefined ? issuedAt : Number(claims.nbf);
  const expiresAt = Number(claims.exp);
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(notBefore) ||
    !Number.isFinite(expiresAt) ||
    issuedAt > nowSeconds + clockSkewSeconds ||
    notBefore > nowSeconds + clockSkewSeconds ||
    expiresAt <= nowSeconds - clockSkewSeconds ||
    expiresAt - issuedAt > 900
  ) {
    return false;
  }

  return (
    exactString(claims.iss, GITHUB_OIDC_ISSUER) &&
    includesAudience(claims.aud, policy.audience) &&
    exactString(claims.repository, policy.repository) &&
    exactString(claims.repository_id, policy.repositoryId) &&
    exactString(claims.repository_owner_id, policy.repositoryOwnerId) &&
    exactString(claims.repository_visibility, policy.repositoryVisibility) &&
    exactString(claims.ref, policy.ref) &&
    exactString(claims.workflow_ref, policy.workflowRef) &&
    exactString(claims.environment, policy.environment) &&
    exactString(claims.sub, policy.subject) &&
    policy.eventNames.includes(claims.event_name) &&
    exactString(claims.runner_environment, policy.runnerEnvironment)
  );
}

async function signingKeys(fetcher, nowMilliseconds) {
  if (jwksCache && jwksCache.expiresAt > nowMilliseconds) {
    return jwksCache.keys;
  }
  const response = await fetcher(GITHUB_OIDC_JWKS_URL, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("github_oidc_jwks_unavailable");
  const body = await response.json();
  if (!body || !Array.isArray(body.keys) || body.keys.length === 0) {
    throw new Error("github_oidc_jwks_invalid");
  }
  const keys = body.keys.filter(
    (key) =>
      key &&
      key.kty === "RSA" &&
      typeof key.kid === "string" &&
      (key.use === undefined || key.use === "sig") &&
      (key.alg === undefined || key.alg === "RS256"),
  );
  if (keys.length === 0) throw new Error("github_oidc_jwks_missing_signing_key");
  jwksCache = { keys, expiresAt: nowMilliseconds + 300_000 };
  return keys;
}

export async function verifyGitHubActionsToken(token, options = {}) {
  if (typeof token !== "string" || token.length < 100 || token.length > 20_000) {
    return false;
  }
  try {
    const segments = token.split(".");
    if (segments.length !== 3) return false;
    const [encodedHeader, encodedClaims, encodedSignature] = segments;
    const header = decodeJsonSegment(encodedHeader);
    const claims = decodeJsonSegment(encodedClaims);
    if (
      !header ||
      header.alg !== "RS256" ||
      typeof header.kid !== "string" ||
      header.kid.length === 0 ||
      !claims ||
      typeof claims !== "object"
    ) {
      return false;
    }

    const nowMilliseconds = options.nowMilliseconds ?? Date.now();
    const policy = { ...DEFAULT_POLICY, ...(options.policy ?? {}) };
    if (!validateClaims(claims, policy, Math.floor(nowMilliseconds / 1000))) {
      return false;
    }

    const keys = await signingKeys(options.fetcher ?? fetch, nowMilliseconds);
    const jwk = keys.find((candidate) => candidate.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signed = new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`);
    return crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      decodeBase64Url(encodedSignature),
      signed,
    );
  } catch {
    return false;
  }
}

export function clearGitHubOidcCacheForTests() {
  jwksCache = null;
}

export { DEFAULT_POLICY, GITHUB_OIDC_ISSUER, GITHUB_OIDC_JWKS_URL };
