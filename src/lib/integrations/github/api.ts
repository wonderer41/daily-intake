import { HttpError } from "@/lib/api/http";

// Shared GET helper for the read-only GitHub calls (card meta line, push review). The token and
// fetch come in as arguments so tests never touch the network.

export const GITHUB_API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 10_000;
const NAME_PART = /^[A-Za-z0-9._-]+$/;

export type FetchLike = typeof fetch;

/** `owner/repo` → its two parts, or null when the text could not name a GitHub repository. */
export function parseRepoFullName(value: string): { owner: string; repo: string } | null {
  const parts = value.trim().split("/");
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  const valid = (part: string) => NAME_PART.test(part) && part !== "." && part !== "..";
  return valid(owner) && valid(repo) ? { owner, repo } : null;
}

/** `https://api.github.com/repos/<owner>/<repo>`; throws VALIDATION_ERROR for a bad name. */
export function repoApiPath(repoFullName: string): string {
  const name = parseRepoFullName(repoFullName);
  if (!name) throw new HttpError("VALIDATION_ERROR", `"${repoFullName}" is not an owner/repo name`);
  return `${GITHUB_API}/repos/${encodeURIComponent(name.owner)}/${encodeURIComponent(name.repo)}`;
}

export interface GithubReply {
  status: number;
  body: unknown;
  /** URL from the Link header's rel="next", when GitHub has another page. */
  next: URL | null;
}

function nextLink(header: string | null): URL | null {
  const match = header ? /<([^>]+)>\s*;\s*rel="next"/.exec(header) : null;
  if (!match) return null;
  try {
    const url = new URL(match[1]);
    // The token only ever goes to GitHub's API host, whatever a header says.
    return url.origin === GITHUB_API ? url : null;
  } catch {
    return null;
  }
}

function failureFor(repo: string, response: Response): HttpError {
  const { status } = response;
  const rateLimited = status === 429 || (status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")));
  if (rateLimited) return new HttpError("RATE_LIMITED", `GitHub rate limit exceeded while reading ${repo}`);
  if (status === 404) return new HttpError("NOT_FOUND", `${repo} was not found, or GITHUB_TOKEN can't read it`);
  if (status === 401) return new HttpError("UPSTREAM_ERROR", "GitHub rejected GITHUB_TOKEN (401)");
  if (status === 403) return new HttpError("UPSTREAM_ERROR", `GitHub denied access to ${repo} (403); check the token's repository access and permissions`);
  return new HttpError("UPSTREAM_ERROR", `GitHub returned HTTP ${status} for ${repo}`);
}

/**
 * One GET to GitHub's API. A status in `okStatuses` comes back with a null body instead of
 * throwing (e.g. 404 for a branch that doesn't exist, 409 for an empty repository).
 */
export async function githubGet(url: URL, repo: string, token: string, fetchImpl: FetchLike, okStatuses: readonly number[] = []): Promise<GithubReply> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new HttpError("UPSTREAM_ERROR", timedOut ? `GitHub did not answer within ${REQUEST_TIMEOUT_MS / 1000} s for ${repo}` : `GitHub could not be reached for ${repo}`);
  }
  if (!response.ok) {
    await response.text().catch(() => ""); // free the connection; GitHub's error text is not passed on
    if (!okStatuses.includes(response.status)) throw failureFor(repo, response);
    return { status: response.status, body: null, next: null };
  }
  try {
    return { status: response.status, body: await response.json(), next: nextLink(response.headers.get("link")) };
  } catch {
    throw new HttpError("UPSTREAM_ERROR", `GitHub returned invalid JSON for ${repo}`);
  }
}

/** GITHUB_TOKEN, or UPSTREAM_ERROR when it isn't set. */
export function loadGithubToken(env: NodeJS.ProcessEnv): string {
  const token = env.GITHUB_TOKEN?.trim() ?? "";
  if (!token) throw new HttpError("UPSTREAM_ERROR", "GITHUB_TOKEN is not configured");
  return token;
}
