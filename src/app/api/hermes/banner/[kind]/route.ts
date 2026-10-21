import { readJsonBody } from "@/lib/api/http";
import { ROOT, invalid, isPlainObject, isoDateTime } from "@/lib/api/validate";
import { insertBannerSnapshot } from "@/lib/dashboard/banner";
import { parseHermesBannerKind } from "@/lib/dashboard/banner-payload";
import { withHermesAuth } from "@/lib/hermes/auth";

// Body: the snapshot payload for :kind plus capturedAt (ISO). Unknown fields are rejected.
// :kind is gmail, scan or stocks; orphans are written by the worker's own check.
export const PUT = withHermesAuth(async (request: Request, context: { params: Promise<{ kind: string }> }) => {
  const kind = parseHermesBannerKind((await context.params).kind);
  const body = await readJsonBody(request);
  if (!isPlainObject(body)) invalid(ROOT, "must be a JSON object");
  const { capturedAt, ...payload } = body;
  const result = await insertBannerSnapshot(kind, payload, new Date(isoDateTime(capturedAt, "capturedAt")), "hermes");
  return Response.json(result, { status: result.created ? 201 : 200 });
});
