import { HttpError, readJsonBody } from "@/lib/api/http";
import { deleteNoteByRef, upsertHermesNote } from "@/lib/dashboard/notes";
import { withHermesAuth } from "@/lib/hermes/auth";
import { parseNoteRefParam } from "@/lib/hermes/keys";
import { parseUpsertNote } from "@/lib/hermes/parse";

type RouteContext = { params: Promise<{ key: string }> };

// Hermes notes in the Notes panel. The key uses the alert format, <source>:<thing>.
export const PUT = withHermesAuth(async (request: Request, context: RouteContext) => {
  const ref = parseNoteRefParam((await context.params).key, "key", false);
  if (ref.kind !== "key") throw new HttpError("VALIDATION_ERROR", "PUT takes a key");
  const result = await upsertHermesNote(ref.key, parseUpsertNote(await readJsonBody(request)));
  return Response.json(result, { status: result.created ? 201 : 200 });
});

// A key deletes Hermes's own note; id:<uuid> deletes any note (Gerardo's, once it became a card).
export const DELETE = withHermesAuth(async (_request: Request, context: RouteContext) => {
  return Response.json(await deleteNoteByRef(parseNoteRefParam((await context.params).key, "key", true)));
});
