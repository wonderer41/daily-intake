// Client for Hermes's API server, Runs endpoints only: start a run, read its status, stop it.
// Server side only: HERMES_API_KEY gives full tool access to Hermes, terminal included.

export interface HermesApiConfig {
  /** e.g. http://172.17.0.1:8642/v1 (no trailing slash). */
  baseUrl: string;
  apiKey: string;
}

/** Null when HERMES_API_URL or HERMES_API_KEY is empty: scheduling is not set up on this server. */
export function loadHermesApiConfig(env: NodeJS.ProcessEnv = process.env): HermesApiConfig | null {
  const baseUrl = env.HERMES_API_URL?.trim().replace(/\/+$/, "") ?? "";
  const apiKey = env.HERMES_API_KEY?.trim() ?? "";
  return baseUrl && apiKey ? { baseUrl, apiKey } : null;
}

const REQUEST_TIMEOUT_MS = 15_000;

export type RunStatus = "running" | "stopping" | "unknown" | "completed" | "failed" | "cancelled" | "interrupted";
const TERMINAL: ReadonlySet<string> = new Set(["completed", "failed", "cancelled", "interrupted"]);

export function isTerminal(status: string): boolean {
  return TERMINAL.has(status);
}

/** A failed call to Hermes. `busy` = 429/503 (too many runs, or Hermes is restarting). */
export class HermesApiError extends Error {
  constructor(
    message: string,
    readonly busy = false,
  ) {
    super(message);
  }
}

async function call(config: HermesApiConfig, path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: { Accept: "application/json", Authorization: `Bearer ${config.apiKey}`, ...init.headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new HermesApiError("Hermes's API server could not be reached");
  }
  if (!response.ok) {
    throw new HermesApiError(`Hermes's API server answered ${response.status}`, response.status === 429 || response.status === 503);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new HermesApiError("Hermes's API server returned invalid JSON");
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new HermesApiError("Hermes's API server returned an unexpected body");
  return payload as Record<string, unknown>;
}

/**
 * POST /v1/runs. `idempotencyKey` (the ScheduleRequest id) makes a retry return the same run
 * instead of booking twice.
 */
export async function startRun(config: HermesApiConfig, input: string, idempotencyKey: string): Promise<string> {
  const payload = await call(config, "/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ input }),
  });
  if (typeof payload.run_id !== "string" || !payload.run_id) throw new HermesApiError("Hermes started a run without a run_id");
  return payload.run_id;
}

export interface RunState {
  status: RunStatus | string;
  output: string;
}

/** GET /v1/runs/{id}: the run's status and, once completed, its final answer. */
export async function getRun(config: HermesApiConfig, runId: string): Promise<RunState> {
  const payload = await call(config, `/runs/${encodeURIComponent(runId)}`);
  return {
    status: typeof payload.status === "string" ? payload.status : "unknown",
    output: typeof payload.output === "string" ? payload.output : "",
  };
}

/** POST /v1/runs/{id}/stop. Best effort: the request is settled either way. */
export async function stopRun(config: HermesApiConfig, runId: string): Promise<void> {
  await call(config, `/runs/${encodeURIComponent(runId)}/stop`, { method: "POST" }).catch(() => undefined);
}
