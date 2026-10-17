import { readJsonBody, withErrorHandling } from "@/lib/api/http";
import { createUserNote } from "@/lib/dashboard/notes";
import { parseCreateNote } from "@/lib/dashboard/user-parse";

export const POST = withErrorHandling(async (request: Request) => {
  return Response.json(await createUserNote(parseCreateNote(await readJsonBody(request))), { status: 201 });
});
