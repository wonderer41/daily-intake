import { readJsonBody, withErrorHandling } from "@/lib/api/http";
import { deleteNote, updateUserNote } from "@/lib/dashboard/notes";
import { parseUpdateNote, uuid } from "@/lib/dashboard/user-parse";

type RouteContext = { params: Promise<{ id: string }> };

// Only Gerardo's own notes can be edited; any note can be deleted.
export const PATCH = withErrorHandling(async (request: Request, { params }: RouteContext) => {
  const id = uuid((await params).id, "id");
  return Response.json(await updateUserNote(id, parseUpdateNote(await readJsonBody(request))));
});

export const DELETE = withErrorHandling(async (_request: Request, { params }: RouteContext) => {
  return Response.json(await deleteNote(uuid((await params).id, "id")));
});
