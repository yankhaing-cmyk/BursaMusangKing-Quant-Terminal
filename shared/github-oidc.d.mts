export type GitHubOidcPolicy = {
  audience: string;
  repository: string;
  repositoryId: string;
  repositoryOwnerId: string;
  repositoryVisibility: string;
  ref: string;
  workflowRef: string;
  environment: string;
  subject: string;
  eventNames: string[];
  runnerEnvironment: string;
};

export function verifyGitHubActionsToken(
  token: string,
  options?: {
    nowMilliseconds?: number;
    fetcher?: typeof fetch;
    policy?: Partial<GitHubOidcPolicy>;
  },
): Promise<boolean>;

export function clearGitHubOidcCacheForTests(): void;
export const DEFAULT_POLICY: Readonly<GitHubOidcPolicy>;
export const GITHUB_OIDC_ISSUER: string;
export const GITHUB_OIDC_JWKS_URL: string;
