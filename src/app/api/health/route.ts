import { databaseReachable } from "@/lib/db/ping";
import type { ApiError } from "@/types/contracts";

// Never prerender: the answer depends on the database being reachable right now.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// Liveness + readiness for the container healthcheck and uptime monitors, and the page's
// "Database unavailable" screen, which polls it to know when to reload.
// `status` and `service` are kept from the original hackathon response.
export async function GET(): Promise<Response> {
  if (!(await databaseReachable("health"))) {
    // Same envelope as src/lib/api/http.ts, but 503: errorResponse() maps INTERNAL_ERROR to 500,
    // and a "database is down" probe should read as "temporarily unavailable".
    const body: ApiError = {
      error: { code: "INTERNAL_ERROR", message: "Database is not reachable", details: { db: false } },
    };
    return Response.json(body, { status: 503, headers: NO_STORE });
  }
  return Response.json(
    { ok: true, db: true, status: "ok", service: "daily-intake", time: new Date().toISOString() },
    { headers: NO_STORE },
  );
}
